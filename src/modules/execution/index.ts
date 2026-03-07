import { v4 as uuid } from 'uuid';
import { Worker, Job } from 'bullmq';
import { getDb } from '../../db';
import { getRedisConnection, recordTokenUsage, checkRateLimit, checkRequestRate } from '../../queue';
import { createAgentContainer, startContainer, waitForContainer, removeContainer } from '../../docker';
import { getAgent } from '../agents';
import { retrieveContext } from '../sources';
import { retrieveMemories } from '../sources/memory';
import { getDisallowedTools, getDockerSecurityConfig } from '../permissions';
import { bufferEvent } from '../../slack/buffer';
import { config } from '../../config';
import { estimateCost, getModelId } from '../../utils/costs';
import { logger, logRunEvent } from '../../utils/logger';
import type { JobData, RunRecord, RunStatus, ModelAlias } from '../../types';

// ── Run Record CRUD ──

export function createRunRecord(data: JobData, jobId: string): RunRecord {
  const db = getDb();
  const record: RunRecord = {
    id: uuid(),
    agent_id: data.agentId,
    channel_id: data.channelId,
    thread_ts: data.threadTs,
    input: data.input,
    output: '',
    status: 'queued',
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
    duration_ms: 0,
    queue_wait_ms: 0,
    context_tokens_injected: 0,
    tool_calls_count: 0,
    trace_id: data.traceId,
    job_id: jobId,
    model: data.modelOverride || 'sonnet',
    slack_user_id: data.userId,
    created_at: new Date().toISOString(),
    completed_at: null,
  };

  db.prepare(`
    INSERT INTO run_history (id, agent_id, channel_id, thread_ts, input, output, status,
      input_tokens, output_tokens, estimated_cost_usd, duration_ms, queue_wait_ms,
      context_tokens_injected, tool_calls_count, trace_id, job_id, model, slack_user_id,
      created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, record.agent_id, record.channel_id, record.thread_ts,
    record.input, record.output, record.status, record.input_tokens,
    record.output_tokens, record.estimated_cost_usd, record.duration_ms,
    record.queue_wait_ms, record.context_tokens_injected, record.tool_calls_count,
    record.trace_id, record.job_id, record.model, record.slack_user_id,
    record.created_at, record.completed_at
  );

  return record;
}

export function updateRunRecord(id: string, updates: Partial<RunRecord>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) return;
  values.push(id);

  db.prepare(`UPDATE run_history SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getRunRecord(id: string): RunRecord | null {
  const db = getDb();
  return db.prepare('SELECT * FROM run_history WHERE id = ?').get(id) as RunRecord | null;
}

export function getRunsByAgent(agentId: string, limit: number = 20): RunRecord[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM run_history WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(agentId, limit) as RunRecord[];
}

export function getRecentRuns(limit: number = 20): RunRecord[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM run_history ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as RunRecord[];
}

// ── Agent Execution ──

export async function executeAgentRun(job: Job<JobData>): Promise<string> {
  const { data } = job;
  const startTime = Date.now();
  const agent = getAgent(data.agentId);

  if (!agent) throw new Error(`Agent ${data.agentId} not found`);

  const runRecord = createRunRecord(data, job.id || '');

  // Check rate limit (TPM and RPM)
  const rateCheck = await checkRateLimit();
  if (!rateCheck.allowed) {
    logger.warn('Rate limit near capacity, delaying job', {
      traceId: data.traceId,
      usage: rateCheck.usage,
    });
    throw new Error('Rate limit exceeded, job will be retried');
  }

  const rpmAllowed = await checkRequestRate();
  if (!rpmAllowed) {
    throw new Error('RPM limit exceeded, job will be retried');
  }

  const queueWaitMs = Date.now() - new Date(runRecord.created_at).getTime();
  updateRunRecord(runRecord.id, { status: 'running', queue_wait_ms: queueWaitMs });

  const model: ModelAlias = data.modelOverride || agent.model;
  const suppressThinking = model === 'haiku'; // Haiku: no thinking traces

  // Stream initial thinking event to Slack
  if (data.channelId) {
    bufferEvent(
      data.channelId,
      data.threadTs,
      'thinking',
      'Analyzing task...',
      agent.name,
      agent.avatar_emoji,
      suppressThinking
    );
  }

  logRunEvent({
    trace_id: data.traceId,
    agent_id: data.agentId,
    job_id: job.id || '',
    event_type: 'thinking',
    timestamp: new Date().toISOString(),
    tokens_in: 0,
    tokens_out: 0,
    duration_ms: 0,
  });

  // Retrieve context (sources + memory)
  let contextBlock = '';
  let contextTokens = 0;
  try {
    const chunks = retrieveContext(agent.id, data.input);
    if (chunks.length > 0) {
      contextBlock = '\n\n## Relevant Context\n\n' +
        chunks.map(c => `### ${c.file_path}\n${c.content}`).join('\n\n');
      contextTokens = Math.ceil(contextBlock.length / 4);
    }

    if (agent.memory_enabled) {
      const memories = retrieveMemories(agent.id, data.input);
      if (memories.length > 0) {
        contextBlock += '\n\n## Agent Memory\n\n' +
          memories.map(m => `- [${m.category}] ${m.fact}`).join('\n');
        contextTokens += Math.ceil(memories.reduce((s, m) => s + m.fact.length, 0) / 4);
      }
    }
  } catch (err) {
    logger.warn('Context retrieval failed', { traceId: data.traceId, error: String(err) });
  }

  updateRunRecord(runRecord.id, { context_tokens_injected: contextTokens });

  // Build task prompt with context
  const taskPrompt = contextBlock
    ? `${data.input}\n${contextBlock}`
    : data.input;

  // Get permission config
  const disallowedTools = getDisallowedTools(agent.permission_level);
  const securityConfig = getDockerSecurityConfig(agent.permission_level);

  // Ensure workspace directory exists
  const workingDir = `/tmp/tinyjobs-workspaces/${agent.id}`;
  const sourcesCacheDir = `/tmp/tinyjobs-sources-cache/${agent.id}`;
  const memoryDir = `/tmp/tinyjobs-memory/${agent.id}`;

  try {
    // Create Docker container with full security config applied
    const container = await createAgentContainer({
      agent,
      traceId: data.traceId,
      workingDir,
      envVars: {
        TASK_PROMPT: taskPrompt,
        MODEL: getModelId(model),
        MAX_TURNS: String(agent.max_turns),
        DISALLOWED_TOOLS: JSON.stringify(disallowedTools),
        STREAMING_DETAIL: agent.streaming_detail ? '1' : '0',
        TRACE_ID: data.traceId,
        AGENT_ID: agent.id,
        PERMISSION_MODE: 'bypassPermissions',
      },
      networkAllowlist: securityConfig.networkMode === 'bridge' ? ['*'] : undefined,
    });

    await startContainer(container);

    const timeoutMs = config.docker.defaultJobTimeoutMs;

    // SDK Watchdog: if no events for 60s, kill container
    let lastEventTime = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastEventTime > 60000) {
        logger.warn('SDK watchdog triggered — no events for 60s', { traceId: data.traceId });
        container.kill().catch(() => {});
        clearInterval(watchdog);
      }
    }, 10000);

    const { exitCode } = await waitForContainer(container, timeoutMs);
    clearInterval(watchdog);

    const durationMs = Date.now() - startTime;

    // Read structured output from container (written to /workspace/.tinyjobs-output.json)
    let outputData = { output: '', inputTokens: 0, outputTokens: 0, toolCallsCount: 0 };
    try {
      const logs = await import('../../docker').then(d => d.getContainerLogs(container));
      // Parse structured output from logs
      const jsonMatch = logs.match(/TINYJOBS_OUTPUT:({.*})/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        outputData = {
          output: parsed.output || '',
          inputTokens: parsed.input_tokens || 0,
          outputTokens: parsed.output_tokens || 0,
          toolCallsCount: parsed.tool_calls_count || 0,
        };
      } else {
        // Fallback: estimate from task
        outputData.inputTokens = contextTokens + Math.ceil(taskPrompt.length / 4);
        outputData.outputTokens = Math.ceil(logs.length / 4);
        outputData.output = logs.slice(-2000); // Last 2KB of logs
      }
    } catch {
      outputData.inputTokens = contextTokens + Math.ceil(taskPrompt.length / 4);
      outputData.outputTokens = 200;
    }

    const cost = estimateCost(model, outputData.inputTokens, outputData.outputTokens);
    await recordTokenUsage(outputData.inputTokens + outputData.outputTokens);

    const status: RunStatus = exitCode === 0 ? 'completed' : 'failed';
    const output = exitCode === 0
      ? outputData.output || 'Task completed successfully'
      : `Task failed with exit code ${exitCode}: ${outputData.output}`;

    updateRunRecord(runRecord.id, {
      status,
      output,
      input_tokens: outputData.inputTokens,
      output_tokens: outputData.outputTokens,
      estimated_cost_usd: cost,
      duration_ms: durationMs,
      tool_calls_count: outputData.toolCallsCount,
      completed_at: new Date().toISOString(),
    });

    // Stream done event to Slack
    if (data.channelId) {
      bufferEvent(
        data.channelId,
        data.threadTs,
        'done',
        output,
        agent.name,
        agent.avatar_emoji
      );
    }

    logRunEvent({
      trace_id: data.traceId,
      agent_id: data.agentId,
      job_id: job.id || '',
      event_type: 'done',
      timestamp: new Date().toISOString(),
      tokens_in: outputData.inputTokens,
      tokens_out: outputData.outputTokens,
      duration_ms: durationMs,
    });

    await removeContainer(container);

    return output;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err.message?.includes('timed out');

    updateRunRecord(runRecord.id, {
      status: isTimeout ? 'timeout' : 'failed',
      output: err.message || 'Unknown error',
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

    // Stream error to Slack
    if (data.channelId) {
      bufferEvent(
        data.channelId,
        data.threadTs,
        'error',
        isTimeout
          ? `Task timed out after ${(durationMs / 1000).toFixed(0)}s`
          : err.message,
        agent.name,
        agent.avatar_emoji
      );
    }

    logRunEvent({
      trace_id: data.traceId,
      agent_id: data.agentId,
      job_id: job.id || '',
      event_type: 'error',
      timestamp: new Date().toISOString(),
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: durationMs,
      error: err.message,
    });

    throw err;
  }
}

// ── Worker ──

export function createWorker(): Worker<JobData> {
  const worker = new Worker<JobData>(
    'tinyjobs-runs',
    async (job) => {
      return executeAgentRun(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 1000,
      },
    }
  );

  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id, traceId: job.data.traceId });
  });

  worker.on('failed', (job, err) => {
    logger.error('Job failed', { jobId: job?.id, error: err.message });

    // Handle Anthropic 429: pause worker for retry-after duration
    if (err.message?.includes('429') || err.message?.includes('rate limit')) {
      const retryAfter = 60; // default 60s
      logger.warn('Anthropic 429 detected, pausing worker', { retryAfter });
      worker.pause().then(() => {
        setTimeout(() => worker.resume(), retryAfter * 1000);
      });
    }
  });

  return worker;
}
