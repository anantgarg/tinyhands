import { v4 as uuid } from 'uuid';
import { Worker, Job } from 'bullmq';
import { getDb } from '../../db';
import { getRedisConnection, recordTokenUsage, checkRateLimit } from '../../queue';
import { createAgentContainer, startContainer, waitForContainer, removeContainer } from '../../docker';
import { getAgent } from '../agents';
import { retrieveContext } from '../sources';
import { retrieveMemories } from '../sources/memory';
import { getDisallowedTools } from '../permissions';
import { config } from '../../config';
import { estimateCost, getModelId } from '../../utils/costs';
import { logger, logRunEvent } from '../../utils/logger';
import type { JobData, RunRecord, RunStatus } from '../../types';

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

export async function executeAgentRun(job: Job<JobData>): Promise<string> {
  const { data } = job;
  const startTime = Date.now();
  const agent = getAgent(data.agentId);

  if (!agent) throw new Error(`Agent ${data.agentId} not found`);

  const runRecord = createRunRecord(data, job.id || '');

  // Check rate limit
  const rateCheck = await checkRateLimit();
  if (!rateCheck.allowed) {
    logger.warn('Rate limit near capacity, delaying job', {
      traceId: data.traceId,
      usage: rateCheck.usage,
    });
    throw new Error('Rate limit exceeded, job will be retried');
  }

  const queueWaitMs = Date.now() - new Date(runRecord.created_at).getTime();
  updateRunRecord(runRecord.id, { status: 'running', queue_wait_ms: queueWaitMs });

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

  // Retrieve context
  let contextBlock = '';
  let contextTokens = 0;
  try {
    const chunks = retrieveContext(agent.id, data.input);
    if (chunks.length > 0) {
      contextBlock = '\n\n## Relevant Context\n\n' +
        chunks.map(c => `### ${c.file_path}\n${c.content}`).join('\n\n');
      contextTokens = Math.ceil(contextBlock.length / 4); // rough estimate
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

  // Build task prompt
  const taskPrompt = contextBlock
    ? `${data.input}\n${contextBlock}`
    : data.input;

  // Get disallowed tools
  const disallowedTools = getDisallowedTools(agent.permission_level);
  const model = data.modelOverride || agent.model;

  // Create and run Docker container
  const workingDir = `/tmp/tinyjobs-workspaces/${agent.id}`;

  try {
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
      },
    });

    await startContainer(container);

    const timeoutMs = config.docker.defaultJobTimeoutMs;
    const { exitCode } = await waitForContainer(container, timeoutMs);

    const durationMs = Date.now() - startTime;

    // For now, simulate token counts from exit code
    // In production, the container writes structured output
    const inputTokens = contextTokens + Math.ceil(taskPrompt.length / 4);
    const outputTokens = 500; // placeholder — real implementation reads from container output
    const cost = estimateCost(model, inputTokens, outputTokens);

    await recordTokenUsage(inputTokens + outputTokens);

    const status: RunStatus = exitCode === 0 ? 'completed' : 'failed';
    const output = exitCode === 0
      ? 'Task completed successfully'
      : `Task failed with exit code ${exitCode}`;

    updateRunRecord(runRecord.id, {
      status,
      output,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: cost,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

    logRunEvent({
      trace_id: data.traceId,
      agent_id: data.agentId,
      job_id: job.id || '',
      event_type: 'done',
      timestamp: new Date().toISOString(),
      tokens_in: inputTokens,
      tokens_out: outputTokens,
      duration_ms: durationMs,
    });

    await removeContainer(container);

    return output;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;

    updateRunRecord(runRecord.id, {
      status: err.message?.includes('timed out') ? 'timeout' : 'failed',
      output: err.message || 'Unknown error',
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

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
  });

  return worker;
}
