import { v4 as uuid } from 'uuid';
import { Worker, Job } from 'bullmq';
import { query, queryOne, execute } from '../../db';
import { getRedisConnection, recordTokenUsage, checkRateLimit, checkRequestRate } from '../../queue';
import { createAgentContainer, startContainer, waitForContainer, removeContainer, followContainerOutput, runDirsFor, cleanupRunSecretsDir } from '../../docker';
import { getAnthropicApiKey, AnthropicKeyMissingError } from '../anthropic';
import { getAgent } from '../agents';
import { retrieveContext } from '../sources';
import { retrieveMemories, storeMemories } from '../sources/memory';
// Permissions module only handles integration access now (per-tool)
import { getAgentSkills } from '../skills';
import { listCustomTools } from '../tools';
import { getIntegration } from '../tools/integrations';
import { getToolExecutionScript, getMcpConfigs, getCodeArtifacts, recordToolRun } from '../self-authoring';
import { bufferEvent, cleanupStatusMessage } from '../../slack/buffer';
import { config } from '../../config';
import { estimateCost, getModelId } from '../../utils/costs';
import { logger, logRunEvent } from '../../utils/logger';
import type { JobData, RunRecord, RunStatus, ModelAlias, MemoryCategory } from '../../types';

// ── Run Record CRUD ──

export async function createRunRecord(workspaceId: string, data: JobData, jobId: string): Promise<RunRecord> {
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
    INSERT INTO run_history (id, workspace_id, agent_id, channel_id, thread_ts, input, output, status,
      input_tokens, output_tokens, estimated_cost_usd, duration_ms, queue_wait_ms,
      context_tokens_injected, tool_calls_count, trace_id, job_id, model, slack_user_id,
      created_at, completed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
  `, [
    record.id, workspaceId, record.agent_id, record.channel_id, record.thread_ts,
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
  'model', 'completed_at', 'conversation_trace',
]);

export async function updateRunRecord(workspaceId: string, id: string, updates: Partial<RunRecord>): Promise<void> {
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
  values.push(workspaceId, id);

  await execute(`UPDATE run_history SET ${fields.join(', ')} WHERE workspace_id = $${paramIdx++} AND id = $${paramIdx}`, values);
}

export async function getRunRecord(workspaceId: string, id: string): Promise<RunRecord | null> {
  const row = await queryOne<RunRecord>('SELECT * FROM run_history WHERE workspace_id = $1 AND id = $2', [workspaceId, id]);
  return row || null;
}

export async function getRunsByAgent(workspaceId: string, agentId: string, limit: number = 20): Promise<RunRecord[]> {
  return query<RunRecord>(
    'SELECT * FROM run_history WHERE workspace_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT $3',
    [workspaceId, agentId, limit]
  );
}

export async function getRecentRuns(workspaceId: string, limit: number = 20): Promise<RunRecord[]> {
  return query<RunRecord>(
    'SELECT * FROM run_history WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2',
    [workspaceId, limit]
  );
}

// ── Agent Execution ──

export async function executeAgentRun(job: Job<JobData>): Promise<string> {
  const { data } = job;
  const workspaceId = data.workspaceId;
  // Wrap the whole run in AsyncLocalStorage so every downstream Slack helper
  // call (postMessage, updateMessage, deleteMessage, etc.) uses this
  // workspace's bot token instead of falling through to getSystemSlackClient.
  const { runInSlackContext, getBotClient } = await import('../../slack');
  const scopedClient = await getBotClient(workspaceId).catch(() => null);
  if (!scopedClient) {
    // Workspace has no bot_token on file — very unlikely but surface clearly.
    throw new Error(`No Slack bot token for workspace ${workspaceId}`);
  }
  return runInSlackContext({ workspaceId, client: scopedClient }, () => executeAgentRunInner(job, data, workspaceId));
}

async function executeAgentRunInner(job: Job<JobData>, data: JobData, workspaceId: string): Promise<string> {
  const startTime = Date.now();
  const agent = await getAgent(workspaceId, data.agentId);

  if (!agent) throw new Error(`Agent ${data.agentId} not found`);

  const runRecord = await createRunRecord(workspaceId, data, job.id || '');

  // Resolve per-workspace Anthropic API key. Fail fast with an admin-friendly
  // Slack message if the workspace hasn't configured one.
  let anthropicApiKey: string;
  try {
    anthropicApiKey = await getAnthropicApiKey(workspaceId);
  } catch (err) {
    if (err instanceof AnthropicKeyMissingError) {
      await updateRunRecord(workspaceId, runRecord.id, {
        status: 'failed',
        output: err.message,
        completed_at: new Date().toISOString(),
      });
      if (data.channelId) {
        const { postMessage } = await import('../../slack');
        await postMessage(
          data.channelId,
          `:warning: *${agent.name}* can't run — ${err.message}`,
          data.threadTs,
        );
      }
      return err.message;
    }
    throw err;
  }

  // Check rate limit (TPM and RPM)
  const rateCheck = await checkRateLimit(workspaceId);
  if (!rateCheck.allowed) {
    logger.warn('Rate limit near capacity, delaying job', {
      traceId: data.traceId,
      usage: rateCheck.usage,
    });
    throw new Error('Rate limit exceeded, job will be retried');
  }

  const rpmAllowed = await checkRequestRate(workspaceId);
  if (!rpmAllowed) {
    throw new Error('RPM limit exceeded, job will be retried');
  }

  const queueWaitMs = Date.now() - new Date(runRecord.created_at).getTime();
  await updateRunRecord(workspaceId, runRecord.id, { status: 'running', queue_wait_ms: queueWaitMs });

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
    const chunks = await retrieveContext(workspaceId, agent.id, data.input);
    if (chunks.length > 0) {
      contextBlock = '\n\n## Relevant Context\n\n' +
        chunks.map(c => `### ${c.file_path}\n${c.content}`).join('\n\n');
      contextTokens = Math.ceil(contextBlock.length / 4);
    }

    if (agent.memory_enabled) {
      const memories = await retrieveMemories(workspaceId, agent.id, data.input);
      if (memories.length > 0) {
        contextBlock += '\n\n## Agent Memory\n\n' +
          memories.map(m => `- [${m.category}] ${m.fact}`).join('\n');
        contextTokens += Math.ceil(memories.reduce((s, m) => s + m.fact.length, 0) / 4);
      }
    }
  } catch (err) {
    logger.warn('Context retrieval failed', { traceId: data.traceId, error: String(err) });
  }

  await updateRunRecord(workspaceId, runRecord.id, { context_tokens_injected: contextTokens });

  // Build task prompt with system prompt + context
  const systemPrompt = agent.system_prompt || '';

  // Inject permission context into system prompt
  let permissionContext = '';
  try {
    const { getAgentRole } = await import('../access-control');
    if (data.userId) {
      const userRole = await getAgentRole(workspaceId, data.agentId, data.userId);
      permissionContext = `\n\n## Current User Context\nUser: <@${data.userId}>, access level: ${userRole}\nWrite policy: ${(agent as any).write_policy || 'auto'}`;
      if (userRole === 'viewer') {
        permissionContext += '\nNote: This user has viewer-level access. Write actions should explain the limitation and suggest requesting an upgrade.';
      }
    }
  } catch (err) {
    logger.warn('Failed to get user role for permission context', { error: String(err) });
  }

  const taskPrompt = contextBlock
    ? `<user_message>\n${data.input}\n</user_message>\n${contextBlock}`
    : `<user_message>\n${data.input}\n</user_message>`;

  // Write policy enforcement — determine which tools to block or gate
  const writePolicy = (agent as any).write_policy || 'auto';
  const disallowedTools: string[] = [];


  // Collect agent's skills and custom tools for injection
  let skillsConfig = '[]';
  let customToolsConfig = '[]';
  let codeArtifactsConfig = '[]';
  try {
    const skills = await getAgentSkills(workspaceId, agent.id);
    skillsConfig = JSON.stringify(skills.map(s => ({
      name: s.name,
      type: s.skill_type,
      config: JSON.parse(s.config_json),
      permission_level: s.permission_level,
    })));
    let customTools = await listCustomTools(workspaceId);
    // For viewer (read-only) runs, strip write tools so the agent can only read data
    let agentTools: string[] = agent.tools;
    if (data.readOnly) {
      agentTools = agentTools.filter((t: string) => !t.endsWith('-write'));
      logger.info('Read-only run: stripped write tools', { agentId: agent.id, userId: data.userId });
    }
    let agentCustomTools = customTools.filter(t => agentTools.includes(t.name));

    // Auto-recovery: if agent references tools not in custom_tools, try registering from integration manifests
    const missingTools = agentTools.filter((name: string) => !customTools.find(t => t.name === name));
    if (missingTools.length > 0) {
      try {
        const { getIntegrations, getIntegration: getInteg } = await import('../tools/integrations');
        for (const integ of getIntegrations()) {
          const integTools = (integ as any).tools || [];
          const needed = integTools.filter((t: any) => missingTools.includes(t.name));
          if (needed.length > 0 && integ.register) {
            await integ.register(workspaceId, data.userId || 'system', {});
            logger.info('Auto-registered integration tools', { integration: integ.id, tools: needed.map((t: any) => t.name) });
          }
        }
        // Re-fetch after registration
        customTools = await listCustomTools(workspaceId);
        agentCustomTools = customTools.filter(t => agentTools.includes(t.name));
      } catch (autoRegErr: any) {
        logger.warn('Auto-registration of missing tools failed', { error: autoRegErr.message, missingTools });
      }
    }
    const customToolEntries = [];
    const missingCredTools: { name: string; message: string }[] = [];
    for (const t of agentCustomTools) {
      const execScript = await getToolExecutionScript(workspaceId, t.name);

      // Resolve credentials via connection system — never fall back silently
      let toolConfig: Record<string, any> | null = null;
      try {
        const { resolveToolCredentials, getCredentialErrorContext } = await import('../connections');
        const { buildCredentialError } = await import('../connections/errors');
        const resolved = await resolveToolCredentials(workspaceId, agent.id, t.name, data.userId || undefined);

        if (!resolved) {
          const runnerId = data.userId || '';
          const errorCtx = await getCredentialErrorContext(workspaceId, agent.id, t.name, runnerId);
          const credError = buildCredentialError(errorCtx);
          missingCredTools.push({ name: t.name, message: credError.message });
          continue;
        }

        toolConfig = resolved;
      } catch (resolveErr) {
        logger.warn('Credential resolution failed, collecting for confirmation', { tool: t.name, error: String(resolveErr) });
        missingCredTools.push({ name: t.name, message: `Failed to load credentials for ${t.name}` });
        continue;
      }

      customToolEntries.push({
        name: t.name,
        schema: JSON.parse(t.schema_json),
        script_path: t.script_path,
        script_code: execScript,
        language: t.language,
        config: toolConfig,
      });
    }

    // Handle missing credential tools — ask user to continue without them
    if (missingCredTools.length > 0) {
      const { config: appConfig } = await import('../../config');

      // If ALL tools are missing, fail immediately
      if (customToolEntries.length === 0) {
        const toolList = missingCredTools.map(t => `• ${t.name} — ${t.message}`).join('\n');
        if (data.channelId) {
          const { postBlocks: postConnBlocks } = await import('../../slack');
          await postConnBlocks(data.channelId, [
            { type: 'section', text: { type: 'mrkdwn', text: `:warning: *${agent.name}* can't run — all tools have missing credentials:\n${toolList}` } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: `<${appConfig.server.webDashboardUrl}/connections|Open Connections in Dashboard>` }] },
          ], 'Missing credentials for all tools', data.threadTs);
        }
        await updateRunRecord(workspaceId, runRecord.id, {
          status: 'failed',
          output: 'All tools have missing credentials',
          completed_at: new Date().toISOString(),
        });
        return 'All tools have missing credentials';
      }

      // Some tools are valid — ask user if agent should continue without the missing ones
      const { v4: confirmUuid } = await import('uuid');
      const { setApprovalState, getApprovalState } = await import('../../queue');
      const requestId = confirmUuid();
      await setApprovalState(workspaceId, requestId, 'pending', 300); // 5-minute timeout

      const toolList = missingCredTools.map(t => `• ${t.name} — ${t.message}`).join('\n');
      if (data.channelId) {
        const { postBlocks: postConnBlocks } = await import('../../slack');
        await postConnBlocks(data.channelId, [
          { type: 'section', text: { type: 'mrkdwn', text: `:warning: *${agent.name}* needs these tools but they aren't configured:\n${toolList}\n\nShould I continue without them?` } },
          {
            type: 'actions',
            elements: [
              { type: 'button', text: { type: 'plain_text', text: ':white_check_mark: Continue' }, action_id: 'approve_skip_tools', value: JSON.stringify({ requestId }), style: 'primary' },
              { type: 'button', text: { type: 'plain_text', text: ':x: Cancel' }, action_id: 'deny_skip_tools', value: JSON.stringify({ requestId }), style: 'danger' },
            ],
          },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `<${appConfig.server.webDashboardUrl}/connections|Open Connections in Dashboard>` }] },
        ], 'Missing tool credentials', data.threadTs);
      }

      // Poll for approval (5 minutes max, check every 3 seconds)
      let approvalResult: string | null = 'pending';
      const pollStart = Date.now();
      const TIMEOUT_MS = 300_000;
      while (approvalResult === 'pending' && Date.now() - pollStart < TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        approvalResult = await getApprovalState(workspaceId, requestId);
      }

      if (approvalResult !== 'approved') {
        await updateRunRecord(workspaceId, runRecord.id, {
          status: 'failed',
          output: 'Run cancelled — missing tool credentials',
          completed_at: new Date().toISOString(),
        });
        if (data.channelId) {
          const { postMessage: postMsg } = await import('../../slack');
          await postMsg(data.channelId, approvalResult === 'denied' ? ':x: Run cancelled.' : ':hourglass: Run timed out waiting for confirmation.', data.threadTs);
        }
        return 'Run cancelled — missing tool credentials';
      }

      // User approved — continue without the missing tools
      if (data.channelId) {
        const { postMessage: postMsg } = await import('../../slack');
        await postMsg(data.channelId, `:white_check_mark: Continuing without: ${missingCredTools.map(t => t.name).join(', ')}`, data.threadTs);
      }
    }

    customToolsConfig = JSON.stringify(customToolEntries);

    // Collect DB-stored MCP configs
    const mcpConfigs = (await getMcpConfigs(workspaceId, agent.id)).filter(m => m.approved);
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
    const codeArtifacts = await getCodeArtifacts(workspaceId, agent.id);
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

  // Ensure workspace directory exists (per-workspace + per-run isolation)
  const workingDir = `/tmp/tinyhands-workspaces/${workspaceId}/${agent.id}/${runRecord.id}`;
  const runDirs = runDirsFor(workspaceId, agent.id, runRecord.id);

  try {
    // Create Docker container with full security config applied
    const container = await createAgentContainer({
      agent,
      workspaceId,
      runId: runRecord.id,
      traceId: data.traceId,
      anthropicApiKey,
      workingDir,
      envVars: {
        SYSTEM_PROMPT: systemPrompt + permissionContext,
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
        ...(writePolicy === 'confirm' || writePolicy === 'admin_confirm' ? {
          WRITE_APPROVAL_ENDPOINT: `http://host.docker.internal:${config.server.port}/internal/approval`,
          WRITE_APPROVAL_POLICY: writePolicy,
        } : {}),
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
    await recordTokenUsage(workspaceId, outputData.inputTokens + outputData.outputTokens);

    const trimmedOutput = outputData.output.trim();

    // Detect rate limit errors in container output — the SDK may exit 0 but output the 429 error
    const isRateLimitInOutput = exitCode === 0 && (
      trimmedOutput.includes('rate_limit_error') ||
      trimmedOutput.includes('Number of concurrent connections') ||
      (trimmedOutput.includes('429') && trimmedOutput.includes('rate limit'))
    );

    if (isRateLimitInOutput) {
      logger.warn('Rate limit detected in container output, will retry', {
        traceId: data.traceId, agentId: data.agentId, cost,
      });

      await updateRunRecord(workspaceId, runRecord.id, {
        status: 'failed',
        output: 'Rate limited — too many agents running at once. Retrying automatically.',
        input_tokens: outputData.inputTokens,
        output_tokens: outputData.outputTokens,
        estimated_cost_usd: cost,
        duration_ms: durationMs,
        tool_calls_count: outputData.toolCallsCount,
        completed_at: new Date().toISOString(),
        conversation_trace: allLogs || undefined,
      });

      // Set global rate limit flag so other workers back off
      const { handleRateLimitResponse } = await import('../../queue');
      await handleRateLimitResponse(workspaceId, 60);

      // Re-queue the job with a 60-second delay (new traceId to avoid jobId collision)
      try {
        const { enqueueRun } = await import('../../queue');
        const retryData = { ...data, traceId: uuid() };
        await enqueueRun(retryData, 'normal', 60000);
        logger.info('Rate-limited job re-queued with 60s delay', { traceId: data.traceId });
      } catch (requeueErr: any) {
        logger.error('Failed to re-queue rate-limited job', { error: requeueErr.message });
      }

      // Notify user in Slack
      if (data.channelId) {
        await cleanupStatusMessage(data.channelId, data.threadTs, data.agentId);
        const { postMessage: postMsg } = await import('../../slack');
        await postMsg(
          data.channelId,
          `:hourglass: Too many agents running at once — hit the API rate limit. This task will automatically retry in about a minute.`,
          data.threadTs,
        );
      }

      await removeContainer(container);
      return 'Rate limited — retrying automatically';
    }

    // Detect max turns exhaustion — agent ran out of steps before producing a response
    const hitMaxTurns = exitCode === 0 && allLogs.includes('"subtype":"error_max_turns"');

    const status: RunStatus = exitCode === 0 ? 'completed' : 'failed';
    // Claude Code CLI returns "(No output)" when the model has nothing to say — treat as empty
    const EMPTY_OUTPUT_PATTERNS = ['(No output)', 'No output', 'Agent completed but no structured result captured'];
    const isEmptyOutput = trimmedOutput.length === 0 || EMPTY_OUTPUT_PATTERNS.includes(trimmedOutput);
    const agentProducedOutput = exitCode === 0 && !isEmptyOutput;
    const output = exitCode === 0
      ? trimmedOutput || (hitMaxTurns ? 'Ran out of steps before finishing — try increasing the effort level or simplifying the task.' : 'Task completed successfully')
      : `Task failed (exit code ${exitCode}): ${outputData.output}`;

    await updateRunRecord(workspaceId, runRecord.id, {
      status,
      output,
      input_tokens: outputData.inputTokens,
      output_tokens: outputData.outputTokens,
      estimated_cost_usd: cost,
      duration_ms: durationMs,
      tool_calls_count: outputData.toolCallsCount,
      completed_at: new Date().toISOString(),
      conversation_trace: allLogs || undefined,
    });

    // Parse and store individual tool calls from the conversation trace
    parseAndStoreToolCalls(workspaceId, runRecord.id, allLogs).catch(err => {
      logger.warn('Failed to store tool calls', { traceId: data.traceId, error: String(err) });
    });

    // Fire-and-forget audit log for the run
    try {
      const { logAuditEvent } = await import('../audit');
      logAuditEvent({
        workspaceId,
        actorUserId: data.userId || 'system',
        actorRole: 'user',
        actionType: 'tool_invocation',
        agentId: data.agentId,
        agentName: agent.name,
        runId: runRecord.id,
        traceId: data.traceId,
        channelId: data.channelId,
        status: status === 'completed' ? 'success' : 'failure',
        details: {
          inputTokens: outputData.inputTokens,
          outputTokens: outputData.outputTokens,
          costUsd: cost,
          durationMs,
          toolCallsCount: outputData.toolCallsCount,
        },
      });
    } catch { /* audit logging is best-effort */ }

    // Extract and store 0-5 key facts as agent memory
    if (agent.memory_enabled && status === 'completed' && output) {
      try {
        await extractAndStoreMemories(workspaceId, agent.id, runRecord.id, data.input, output);
      } catch (memErr) {
        logger.warn('Memory extraction failed', { traceId: data.traceId, error: String(memErr) });
      }
    }

    // Stream done/error event to Slack
    if (data.channelId) {
      if (exitCode !== 0) {
        // Container failed — report the error to the user
        await cleanupStatusMessage(data.channelId, data.threadTs, data.agentId);
        const errorMessage = exitCode === 137
          ? `Task was interrupted after ${(durationMs / 1000 / 60).toFixed(0)} minutes — the agent ran out of time or resources. Try simplifying the request or breaking it into smaller steps.`
          : (outputData.output || 'Something went wrong while running this task. Please try again.');
        bufferEvent(
          data.channelId,
          data.threadTs,
          'error',
          errorMessage,
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
      } else if (hitMaxTurns) {
        // Agent ran out of turns before producing output — tell the user
        await cleanupStatusMessage(data.channelId, data.threadTs, data.agentId);
        bufferEvent(
          data.channelId,
          data.threadTs,
          'error',
          `Ran out of steps before finishing — the task needed more steps than the current effort level allows. Try increasing the effort level in the agent's settings, or simplify the task.`,
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

    await updateRunRecord(workspaceId, runRecord.id, {
      status: isTimeout ? 'timeout' : 'failed',
      output: err.message || 'Unknown error',
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

    // Clean up status message and stream error to Slack
    if (data.channelId) {
      await cleanupStatusMessage(data.channelId, data.threadTs, data.agentId);
      bufferEvent(
        data.channelId,
        data.threadTs,
        'error',
        isTimeout
          ? `Task timed out after ${(durationMs / 1000).toFixed(0)}s`
          : 'Something went wrong while running this task. Please try again.',
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
  } finally {
    // Always remove per-run secrets dir — success, failure, or timeout.
    cleanupRunSecretsDir(runDirs.runSecretsDir);
  }
}

// ── Tool Call Parsing & Trace Helpers ──

interface ParsedToolCall {
  name: string;
  input: Record<string, unknown> | null;
  output: string | null;
  error: string | null;
  sequence: number;
}

async function parseAndStoreToolCalls(workspaceId: string, runId: string, allLogs: string): Promise<void> {
  if (!allLogs) return;

  const toolCalls: ParsedToolCall[] = [];
  let sequence = 0;
  let pendingToolUse: { name: string; input: Record<string, unknown> | null } | null = null;

  for (const line of allLogs.split('\n')) {
    try {
      const event = JSON.parse(line);

      // Format 1: Complete assistant messages
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use') {
            pendingToolUse = { name: block.name || 'unknown', input: block.input || null };
          }
        }
      }

      // Format 2: Granular stream events
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        pendingToolUse = { name: event.content_block.name || 'unknown', input: event.content_block.input || null };
      }

      // Tool result (appears after tool_use in both formats)
      if (event.type === 'tool' && event.message?.content) {
        const resultText = Array.isArray(event.message.content)
          ? event.message.content.map((b: any) => b.text || b.content || '').join('\n')
          : String(event.message.content);
        const isError = event.message.is_error === true || resultText.toLowerCase().startsWith('error');
        toolCalls.push({
          name: pendingToolUse?.name || 'unknown',
          input: pendingToolUse?.input || null,
          output: isError ? null : resultText.slice(0, 4000),
          error: isError ? resultText.slice(0, 2000) : null,
          sequence: sequence++,
        });
        pendingToolUse = null;
      }
    } catch {
      // Not JSON — skip
    }
  }

  // If we found a pending tool_use without a result, record it
  if (pendingToolUse) {
    toolCalls.push({
      name: pendingToolUse.name,
      input: pendingToolUse.input,
      output: null,
      error: 'No result received (possible timeout)',
      sequence: sequence++,
    });
  }

  if (toolCalls.length === 0) return;

  // Batch insert tool calls
  for (const tc of toolCalls) {
    await execute(
      `INSERT INTO tool_calls (id, run_id, workspace_id, tool_name, tool_input, tool_output, error, duration_ms, sequence_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [uuid(), runId, workspaceId, tc.name, tc.input ? JSON.stringify(tc.input) : null, tc.output, tc.error, 0, tc.sequence]
    );
  }
}

export async function getRunToolCalls(workspaceId: string, runId: string): Promise<import('../../types').ToolCallRecord[]> {
  return query<import('../../types').ToolCallRecord>(
    'SELECT * FROM tool_calls WHERE workspace_id = $1 AND run_id = $2 ORDER BY sequence_number ASC',
    [workspaceId, runId]
  );
}

export async function getRunTrace(workspaceId: string, runId: string): Promise<string | null> {
  const row = await queryOne<{ conversation_trace: string | null }>(
    'SELECT conversation_trace FROM run_history WHERE workspace_id = $1 AND id = $2',
    [workspaceId, runId]
  );
  return row?.conversation_trace || null;
}

// ── Memory Extraction ──

async function extractAndStoreMemories(
  workspaceId: string,
  agentId: string,
  runId: string,
  input: string,
  output: string
): Promise<void> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const apiKey = await getAnthropicApiKey(workspaceId);
    const client = new Anthropic({ apiKey });

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

    let text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    // Strip markdown code fences if present (e.g. ```json ... ```)
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) text = fenceMatch[1].trim();

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
        await storeMemories(workspaceId, agentId, runId, validFacts);
        logger.info('Memories extracted from run', { agentId, runId, count: validFacts.length });
      }
    }
  } catch (err: any) {
    logger.warn('AI memory extraction failed', { error: err.message });
  }
}

// ── Worker ──

export function createWorker(): Worker<JobData> {
  // Per-process concurrency is env-driven so operators can scale as tenants
  // are added without deploying code. PM2 runs multiple worker processes; each
  // picks up `WORKER_CONCURRENCY` jobs in parallel.
  const concurrency = Math.max(1, parseInt(process.env.WORKER_CONCURRENCY || '1', 10));

  const worker = new Worker<JobData>(
    'tinyhands-runs',
    async (job) => {
      return executeAgentRun(job);
    },
    {
      connection: getRedisConnection() as any,
      concurrency,
      lockDuration: 600000,          // 10 minutes — long enough for any agent turn
      stalledInterval: 120000,       // Check every 2 minutes
      maxStalledCount: 3,            // Allow 3 stalls before failing
      limiter: {
        max: concurrency,
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
