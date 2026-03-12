import { v4 as uuid } from 'uuid';
import { Worker, Job } from 'bullmq';
import { query, queryOne, execute } from '../../db';
import { getRedisConnection, recordTokenUsage, checkRateLimit, checkRequestRate } from '../../queue';
import { createAgentContainer, startContainer, waitForContainer, removeContainer, followContainerOutput } from '../../docker';
import { getAgent } from '../agents';
import { retrieveContext } from '../sources';
import { retrieveMemories, storeMemories } from '../sources/memory';
// Permissions module only handles integration access now (per-tool)
import { getAgentSkills } from '../skills';
import { listCustomTools } from '../tools';
import { getToolExecutionScript, getMcpConfigs, getCodeArtifacts, recordToolRun } from '../self-authoring';
import { bufferEvent, cleanupStatusMessage } from '../../slack/buffer';
import { config } from '../../config';
import { estimateCost, getModelId } from '../../utils/costs';
import { logger, logRunEvent } from '../../utils/logger';
import type { JobData, RunRecord, RunStatus, ModelAlias, MemoryCategory } from '../../types';

// ── Run Record CRUD ──

export async function createRunRecord(data: JobData, jobId: string): Promise<RunRecord> {
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

  await execute(`
    INSERT INTO run_history (id, agent_id, channel_id, thread_ts, input, output, status,
      input_tokens, output_tokens, estimated_cost_usd, duration_ms, queue_wait_ms,
      context_tokens_injected, tool_calls_count, trace_id, job_id, model, slack_user_id,
      created_at, completed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
  `, [
    record.id, record.agent_id, record.channel_id, record.thread_ts,
    record.input, record.output, record.status, record.input_tokens,
    record.output_tokens, record.estimated_cost_usd, record.duration_ms,
    record.queue_wait_ms, record.context_tokens_injected, record.tool_calls_count,
    record.trace_id, record.job_id, record.model, record.slack_user_id,
    record.created_at, record.completed_at
  ]);

  return record;
}

const ALLOWED_RUN_RECORD_COLUMNS = new Set([
  'output', 'status', 'input_tokens', 'output_tokens', 'estimated_cost_usd',
  'duration_ms', 'queue_wait_ms', 'context_tokens_injected', 'tool_calls_count',
  'model', 'completed_at',
]);

export async function updateRunRecord(id: string, updates: Partial<RunRecord>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_RUN_RECORD_COLUMNS.has(key)) {
      throw new Error(`Invalid column for run record update: ${key}`);
    }
    fields.push(`${key} = $${paramIdx++}`);
    values.push(value);
  }

  if (fields.length === 0) return;
  values.push(id);

  await execute(`UPDATE run_history SET ${fields.join(', ')} WHERE id = $${paramIdx}`, values);
}

export async function getRunRecord(id: string): Promise<RunRecord | null> {
  const row = await queryOne<RunRecord>('SELECT * FROM run_history WHERE id = $1', [id]);
  return row || null;
}

export async function getRunsByAgent(agentId: string, limit: number = 20): Promise<RunRecord[]> {
  return query<RunRecord>(
    'SELECT * FROM run_history WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2',
    [agentId, limit]
  );
}

export async function getRecentRuns(limit: number = 20): Promise<RunRecord[]> {
  return query<RunRecord>(
    'SELECT * FROM run_history ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
}

// ── Agent Execution ──

export async function executeAgentRun(job: Job<JobData>): Promise<string> {
  const { data } = job;
  const startTime = Date.now();
  const agent = await getAgent(data.agentId);

  if (!agent) throw new Error(`Agent ${data.agentId} not found`);

  const runRecord = await createRunRecord(data, job.id || '');

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
  await updateRunRecord(runRecord.id, { status: 'running', queue_wait_ms: queueWaitMs });

  const model: ModelAlias = data.modelOverride || agent.model;
  const suppressThinking = model === 'haiku'; // Haiku: no thinking traces

  // Update temporary status message with thinking state
  if (data.channelId) {
    // Pass the status message TS from the job data so the worker can delete it when done
    if (data.statusMessageTs) {
      const { setStatusMessageTs } = await import('../../slack/buffer');
      setStatusMessageTs(data.channelId, data.threadTs, data.statusMessageTs, data.agentId);
    }

    // Status updates should never be suppressed — only raw thinking content should be
    bufferEvent(
      data.channelId,
      data.threadTs,
      'thinking',
      'Thinking...',
      agent.name,
      agent.avatar_emoji,
      false,
      data.agentId,
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
    const chunks = await retrieveContext(agent.id, data.input);
    if (chunks.length > 0) {
      contextBlock = '\n\n## Relevant Context\n\n' +
        chunks.map(c => `### ${c.file_path}\n${c.content}`).join('\n\n');
      contextTokens = Math.ceil(contextBlock.length / 4);
    }

    if (agent.memory_enabled) {
      const memories = await retrieveMemories(agent.id, data.input);
      if (memories.length > 0) {
        contextBlock += '\n\n## Agent Memory\n\n' +
          memories.map(m => `- [${m.category}] ${m.fact}`).join('\n');
        contextTokens += Math.ceil(memories.reduce((s, m) => s + m.fact.length, 0) / 4);
      }
    }
  } catch (err) {
    logger.warn('Context retrieval failed', { traceId: data.traceId, error: String(err) });
  }

  await updateRunRecord(runRecord.id, { context_tokens_injected: contextTokens });

  // Build task prompt with system prompt + context
  const systemPrompt = agent.system_prompt || '';
  const taskPrompt = contextBlock
    ? `<user_message>\n${data.input}\n</user_message>\n${contextBlock}`
    : `<user_message>\n${data.input}\n</user_message>`;

  // All agents use the same standard security config — access control is per-tool
  const disallowedTools: string[] = [];

  // Collect agent's skills and custom tools for injection
  let skillsConfig = '[]';
  let customToolsConfig = '[]';
  let codeArtifactsConfig = '[]';
  try {
    const skills = await getAgentSkills(agent.id);
    skillsConfig = JSON.stringify(skills.map(s => ({
      name: s.name,
      type: s.skill_type,
      config: JSON.parse(s.config_json),
      permission_level: s.permission_level,
    })));
    const customTools = await listCustomTools();
    const agentCustomTools = customTools.filter(t => agent.tools.includes(t.name));
    const customToolEntries = [];
    for (const t of agentCustomTools) {
      const execScript = await getToolExecutionScript(t.name);
      customToolEntries.push({
        name: t.name,
        schema: JSON.parse(t.schema_json),
        script_path: t.script_path,
        script_code: execScript,
        language: t.language,
        config: JSON.parse(t.config_json || '{}'),
      });
    }
    customToolsConfig = JSON.stringify(customToolEntries);

    // If agent has custom tools, ensure Bash is allowed (needed to execute tool scripts)
    if (customToolEntries.length > 0) {
      const bashIdx = disallowedTools.indexOf('Bash');
      if (bashIdx !== -1) {
        disallowedTools.splice(bashIdx, 1);
        logger.info('Auto-allowed Bash for agent with custom tools', { agentId: agent.id, toolCount: customToolEntries.length });
      }
    }

    // Collect DB-stored MCP configs
    const mcpConfigs = (await getMcpConfigs(agent.id)).filter(m => m.approved);
    if (mcpConfigs.length > 0) {
      const mcpSkillEntries = mcpConfigs.map(m => ({
        name: m.name,
        type: 'mcp',
        config: JSON.parse(m.config_json),
        permission_level: 'write',
      }));
      const existingSkills = JSON.parse(skillsConfig);
      skillsConfig = JSON.stringify([...existingSkills, ...mcpSkillEntries]);
    }

    // Collect DB-stored code artifacts for workspace injection
    const codeArtifacts = await getCodeArtifacts(agent.id);
    if (codeArtifacts.length > 0) {
      codeArtifactsConfig = JSON.stringify(codeArtifacts.map(a => ({
        file_path: a.file_path,
        content: a.content,
        language: a.language,
      })));
    }
  } catch (err) {
    logger.warn('Failed to load skills/tools for agent', { agentId: agent.id, error: String(err) });
  }

  // Ensure workspace directory exists
  const workingDir = `/tmp/tinyhands-workspaces/${agent.id}`;
  const sourcesCacheDir = `/tmp/tinyhands-sources-cache/${agent.id}`;
  const memoryDir = `/tmp/tinyhands-memory/${agent.id}`;

  try {
    // Create Docker container with full security config applied
    const container = await createAgentContainer({
      agent,
      traceId: data.traceId,
      workingDir,
      envVars: {
        SYSTEM_PROMPT: systemPrompt,
        TASK_PROMPT: taskPrompt,
        MODEL: getModelId(model),
        MAX_TURNS: String(agent.max_turns),
        DISALLOWED_TOOLS: JSON.stringify(disallowedTools),
        STREAMING_DETAIL: agent.streaming_detail ? '1' : '0',
        TRACE_ID: data.traceId,
        AGENT_ID: agent.id,
        PERMISSION_MODE: 'bypassPermissions',
        SKILLS_CONFIG: skillsConfig,
        CUSTOM_TOOLS_CONFIG: customToolsConfig,
        CODE_ARTIFACTS_CONFIG: codeArtifactsConfig,
        MEMORY_ENABLED: agent.memory_enabled ? '1' : '0',
      },
      networkAllowlist: ['*'],
    });

    // followContainerOutput attaches before starting for real-time streaming
    const timeoutMs = config.docker.defaultJobTimeoutMs;

    // Stream container output in real-time for live status updates
    let outputData = { output: '', inputTokens: 0, outputTokens: 0, toolCallsCount: 0, costUsd: 0 };
    let lastStreamEventType = '';

    const { exitCode, allLogs } = await followContainerOutput(
      container,
      (line) => {
        // Parse JSONL events from Claude's stream-json output for live status updates
        // Claude Code emits two formats depending on flags:
        //   Without --include-partial-messages: complete "assistant"/"user" messages per turn
        //   With --include-partial-messages: granular "content_block_start" stream events
        // We handle both so status updates work either way.
        try {
          const event = JSON.parse(line);

          // ── Format 1: Complete assistant messages (default stream-json) ──
          if (event.type === 'assistant' && event.message?.content) {
            const contentBlocks = event.message.content as any[];
            for (const block of contentBlocks) {
              if (block.type === 'tool_use') {
                const toolName = block.name || 'tool';
                if (data.channelId) {
                  bufferEvent(data.channelId, data.threadTs, 'tool_use', toolName, agent.name, agent.avatar_emoji, false, data.agentId);
                }
                lastStreamEventType = 'tool_use';
              } else if (block.type === 'thinking' && lastStreamEventType !== 'thinking') {
                if (data.channelId) {
                  bufferEvent(data.channelId, data.threadTs, 'thinking', 'Thinking...', agent.name, agent.avatar_emoji, suppressThinking, data.agentId);
                }
                lastStreamEventType = 'thinking';
              } else if (block.type === 'text') {
                if (data.channelId) {
                  bufferEvent(data.channelId, data.threadTs, 'thinking', 'Writing response...', agent.name, agent.avatar_emoji, false, data.agentId);
                }
                lastStreamEventType = 'text';
              }
            }
          }

          // ── Format 2: Granular stream events (with --include-partial-messages) ──
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            const toolName = event.content_block.name || 'tool';
            if (data.channelId) {
              bufferEvent(data.channelId, data.threadTs, 'tool_use', toolName, agent.name, agent.avatar_emoji, false, data.agentId);
            }
            lastStreamEventType = 'tool_use';
          }
          if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
            if (data.channelId && lastStreamEventType !== 'thinking') {
              bufferEvent(data.channelId, data.threadTs, 'thinking', 'Thinking...', agent.name, agent.avatar_emoji, suppressThinking, data.agentId);
            }
            lastStreamEventType = 'thinking';
          }
          if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
            if (data.channelId) {
              bufferEvent(data.channelId, data.threadTs, 'thinking', 'Writing response...', agent.name, agent.avatar_emoji, false, data.agentId);
            }
            lastStreamEventType = 'text';
          }
        } catch {
          // Not JSON or parse error — ignore (could be TINYHANDS_OUTPUT or stderr)
        }
      },
      timeoutMs,
    );

    const durationMs = Date.now() - startTime;

    // Parse structured output from collected logs
    try {
      logger.info('Container logs', { traceId: data.traceId, logsLength: allLogs.length, logsTail: allLogs.slice(-500) });
      await removeContainer(container);

      // Parse TINYHANDS_OUTPUT from logs
      const jsonMatch = allLogs.match(/TINYHANDS_OUTPUT:({.*})/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        outputData = {
          output: parsed.output || '',
          inputTokens: parsed.input_tokens || 0,
          outputTokens: parsed.output_tokens || 0,
          toolCallsCount: parsed.tool_calls_count || 0,
          costUsd: parsed.cost_usd || 0,
        };
      } else {
        // Fallback: try to extract result from stream-json result event
        const resultMatch = allLogs.match(/"type":"result".*?"result":"(.*?)"/s);
        if (resultMatch) {
          outputData.output = resultMatch[1];
        } else {
          logger.warn('No TINYHANDS_OUTPUT found in logs', { traceId: data.traceId, logsTail: allLogs.slice(-500) });
          outputData.inputTokens = contextTokens + Math.ceil(taskPrompt.length / 4);
          outputData.outputTokens = Math.ceil(allLogs.length / 4);
          outputData.output = allLogs.slice(-2000);
        }
      }
    } catch (logErr) {
      logger.error('Failed to parse container logs', { traceId: data.traceId, error: String(logErr) });
      outputData.inputTokens = contextTokens + Math.ceil(taskPrompt.length / 4);
      outputData.outputTokens = 200;
      // Best-effort container cleanup
      removeContainer(container).catch(() => {});
    }

    const cost = outputData.costUsd > 0 ? outputData.costUsd : estimateCost(model, outputData.inputTokens, outputData.outputTokens);
    await recordTokenUsage(outputData.inputTokens + outputData.outputTokens);

    const status: RunStatus = exitCode === 0 ? 'completed' : 'failed';
    const trimmedOutput = outputData.output.trim();
    // Claude Code CLI returns "(No output)" when the model has nothing to say — treat as empty
    const EMPTY_OUTPUT_PATTERNS = ['(No output)', 'No output', 'Agent completed but no structured result captured'];
    const isEmptyOutput = trimmedOutput.length === 0 || EMPTY_OUTPUT_PATTERNS.includes(trimmedOutput);
    const agentProducedOutput = exitCode === 0 && !isEmptyOutput;
    const output = exitCode === 0
      ? trimmedOutput || 'Task completed successfully'
      : `Task failed with exit code ${exitCode}: ${outputData.output}`;

    await updateRunRecord(runRecord.id, {
      status,
      output,
      input_tokens: outputData.inputTokens,
      output_tokens: outputData.outputTokens,
      estimated_cost_usd: cost,
      duration_ms: durationMs,
      tool_calls_count: outputData.toolCallsCount,
      completed_at: new Date().toISOString(),
    });

    // Extract and store 0-5 key facts as agent memory
    if (agent.memory_enabled && status === 'completed' && output) {
      try {
        await extractAndStoreMemories(agent.id, runRecord.id, data.input, output);
      } catch (memErr) {
        logger.warn('Memory extraction failed', { traceId: data.traceId, error: String(memErr) });
      }
    }

    // Stream done/error event to Slack
    if (data.channelId) {
      if (exitCode !== 0) {
        // Container failed — report the error to the user
        cleanupStatusMessage(data.channelId, data.threadTs, data.agentId);
        bufferEvent(
          data.channelId,
          data.threadTs,
          'error',
          outputData.output || `Task failed with exit code ${exitCode}`,
          agent.name,
          agent.avatar_emoji,
          false,
          data.agentId,
        );
      } else if (agentProducedOutput) {
        bufferEvent(
          data.channelId,
          data.threadTs,
          'done',
          output,
          agent.name,
          agent.avatar_emoji,
          false,
          data.agentId,
        );
      } else {
        // Agent chose not to respond — silently clean up status message
        cleanupStatusMessage(data.channelId, data.threadTs, data.agentId);
      }
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

    await updateRunRecord(runRecord.id, {
      status: isTimeout ? 'timeout' : 'failed',
      output: err.message || 'Unknown error',
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

    // Clean up status message and stream error to Slack
    if (data.channelId) {
      cleanupStatusMessage(data.channelId, data.threadTs, data.agentId);
      bufferEvent(
        data.channelId,
        data.threadTs,
        'error',
        isTimeout
          ? `Task timed out after ${(durationMs / 1000).toFixed(0)}s`
          : err.message,
        agent.name,
        agent.avatar_emoji,
        false,
        data.agentId,
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

// ── Memory Extraction ──

async function extractAndStoreMemories(
  agentId: string,
  runId: string,
  input: string,
  output: string
): Promise<void> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `Extract 0-5 key facts worth remembering from this agent interaction.
Return ONLY a JSON array of objects: [{"fact": "...", "category": "preference|procedure|correction|context|entity"}]
If nothing is worth remembering, return an empty array [].
Focus on: user preferences, corrections, entities mentioned, procedures learned.`,
      messages: [{
        role: 'user',
        content: `Task: ${input.slice(0, 500)}\n\nOutput: ${output.slice(0, 1500)}`,
      }],
    });

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    const facts = JSON.parse(text) as Array<{ fact: string; category: string }>;
    if (Array.isArray(facts) && facts.length > 0) {
      const validCategories = ['preference', 'procedure', 'correction', 'context', 'entity'];
      const validFacts = facts
        .filter(f => f.fact && f.category)
        .slice(0, 5)
        .map(f => ({
          fact: f.fact,
          category: (validCategories.includes(f.category) ? f.category : 'context') as MemoryCategory,
        }));

      if (validFacts.length > 0) {
        await storeMemories(agentId, runId, validFacts);
        logger.info('Memories extracted from run', { agentId, runId, count: validFacts.length });
      }
    }
  } catch (err: any) {
    logger.warn('AI memory extraction failed', { error: err.message });
  }
}

// ── Worker ──

export function createWorker(): Worker<JobData> {
  const worker = new Worker<JobData>(
    'tinyhands-runs',
    async (job) => {
      return executeAgentRun(job);
    },
    {
      connection: getRedisConnection() as any,
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
