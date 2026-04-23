import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { getAgent } from '../agents';
import { enqueueRun } from '../../queue';
import type { TeamRun, SubAgentRun, RunStatus, JobData } from '../../types';
import { logger } from '../../utils/logger';

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_DEPTH = 2;

async function resolveAgentName(workspaceId: string, agentId: string): Promise<string> {
  try {
    const a = await getAgent(workspaceId, agentId);
    return a?.name || 'Unknown agent';
  } catch {
    return 'Unknown agent';
  }
}

// ── Team Management ──

export async function createTeamRun(
  workspaceId: string,
  leadAgentId: string,
  leadRunId: string,
  maxConcurrent?: number,
  maxDepth?: number
): Promise<TeamRun> {
  const agent = await getAgent(workspaceId, leadAgentId);
  if (!agent) throw new Error(`Agent ${leadAgentId} not found`);

  const id = uuid();
  const teamRun: TeamRun = {
    id,
    lead_agent_id: leadAgentId,
    lead_run_id: leadRunId,
    sub_agents: [],
    max_concurrent: maxConcurrent || DEFAULT_MAX_CONCURRENT,
    max_depth: maxDepth || DEFAULT_MAX_DEPTH,
    created_at: new Date().toISOString(),
  };

  await execute(`
    INSERT INTO team_runs (id, workspace_id, lead_agent_id, lead_run_id, max_concurrent, max_depth, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [teamRun.id, workspaceId, teamRun.lead_agent_id, teamRun.lead_run_id,
    teamRun.max_concurrent, teamRun.max_depth, teamRun.created_at]);

  logger.info('Team run created', { teamRunId: id, leadAgentId });
  return teamRun;
}

export async function getTeamRun(workspaceId: string, id: string): Promise<TeamRun | null> {
  const row = await queryOne<any>('SELECT * FROM team_runs WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  if (!row) return null;

  const subAgents = await query<SubAgentRun>(
    'SELECT * FROM sub_agent_runs WHERE team_run_id = $1 AND workspace_id = $2',
    [id, workspaceId]
  );

  return { ...row, sub_agents: subAgents };
}

// ── Sub-Agent Spawning ──

export async function spawnSubAgent(
  workspaceId: string,
  teamRunId: string,
  agentId: string,
  task: string,
  depth: number = 1
): Promise<SubAgentRun> {
  const teamRun = await getTeamRun(workspaceId, teamRunId);
  if (!teamRun) throw new Error(`Team run ${teamRunId} not found`);

  // Check depth limit
  if (depth > teamRun.max_depth) {
    throw new Error(`Max spawn depth (${teamRun.max_depth}) exceeded. Cannot spawn at depth ${depth}.`);
  }

  // Check concurrent limit
  const activeCount = await queryOne<any>(
    'SELECT COUNT(*) as count FROM sub_agent_runs WHERE team_run_id = $1 AND status IN ($2, $3) AND workspace_id = $4',
    [teamRunId, 'queued', 'running', workspaceId]
  );

  if (parseInt(activeCount?.count || '0', 10) >= teamRun.max_concurrent) {
    throw new Error(`Max concurrent sub-agents (${teamRun.max_concurrent}) reached`);
  }

  const agent = await getAgent(workspaceId, agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // Sub-agents inherit lead's permissions but cannot elevate
  const leadAgent = await getAgent(workspaceId, teamRun.lead_agent_id);
  if (!leadAgent) throw new Error(`Lead agent not found`);

  const id = uuid();
  const runId = uuid();
  const traceId = uuid();

  const subAgentRun: SubAgentRun = {
    id,
    team_run_id: teamRunId,
    agent_id: agentId,
    run_id: runId,
    depth,
    status: 'queued',
    task,
    result: null,
  };

  await execute(`
    INSERT INTO sub_agent_runs (id, workspace_id, team_run_id, agent_id, run_id, depth, status, task, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
  `, [subAgentRun.id, workspaceId, subAgentRun.team_run_id, subAgentRun.agent_id,
    subAgentRun.run_id, subAgentRun.depth, subAgentRun.status, subAgentRun.task]);

  // Enqueue the sub-agent's run
  const jobData: JobData = {
    workspaceId,
    agentId,
    channelId: '', // Sub-agent output collected by lead
    threadTs: '',
    input: task,
    userId: null,
    traceId,
  };

  await enqueueRun(jobData, 'normal');

  logger.info('Sub-agent spawned', {
    teamRunId,
    subAgentId: agentId,
    depth,
    traceId,
  });

  return subAgentRun;
}

// ── Sub-Agent Completion ──

export async function completeSubAgent(
  workspaceId: string,
  subAgentRunId: string,
  status: RunStatus,
  result: string
): Promise<void> {
  await execute(
    'UPDATE sub_agent_runs SET status = $1, result = $2 WHERE id = $3 AND workspace_id = $4',
    [status, result, subAgentRunId, workspaceId]
  );

  const subRun = await queryOne<SubAgentRun>('SELECT * FROM sub_agent_runs WHERE id = $1 AND workspace_id = $2', [subAgentRunId, workspaceId]);
  if (!subRun) return;

  logger.info('Sub-agent completed', {
    subAgentRunId,
    teamRunId: subRun.team_run_id,
    status,
  });

  // Check if all sub-agents are done — post results to Slack
  await checkTeamCompletion(workspaceId, subRun.team_run_id);
}

async function checkTeamCompletion(workspaceId: string, teamRunId: string): Promise<boolean> {
  const pending = await queryOne<any>(
    'SELECT COUNT(*) as count FROM sub_agent_runs WHERE team_run_id = $1 AND status IN ($2, $3) AND workspace_id = $4',
    [teamRunId, 'queued', 'running', workspaceId]
  );

  if (parseInt(pending?.count || '0', 10) === 0) {
    // All sub-agents done — post aggregated results to lead agent's thread
    const teamRun = await getTeamRun(workspaceId, teamRunId);
    if (teamRun) {
      const leadRun = await queryOne<any>('SELECT * FROM run_history WHERE id = $1 AND workspace_id = $2', [teamRun.lead_run_id, workspaceId]);
      if (leadRun?.channel_id && leadRun?.thread_ts) {
        try {
          const { postMessage } = await import('../../slack');
          const results = await getTeamResults(workspaceId, teamRunId);
          const cost = await getTeamCost(workspaceId, teamRunId);

          let summary = `:checkered_flag: *Team run complete*\n`;
          summary += `Completed: ${results.completed.length} | Failed: ${results.failed.length} | Cost: $${cost.toFixed(4)}\n\n`;

          const allSubs = [...results.completed, ...results.failed];
          const nameBySubAgentId = new Map<string, string>();
          for (const sub of allSubs) {
            if (nameBySubAgentId.has(sub.agent_id)) continue;
            const a = await resolveAgentName(workspaceId, sub.agent_id);
            nameBySubAgentId.set(sub.agent_id, a);
          }

          for (const sub of results.completed) {
            summary += `:white_check_mark: *${nameBySubAgentId.get(sub.agent_id)}*: ${(sub.result || '').slice(0, 200)}\n`;
          }
          for (const sub of results.failed) {
            summary += `:x: *${nameBySubAgentId.get(sub.agent_id)}*: ${(sub.result || 'Failed').slice(0, 200)}\n`;
          }

          await postMessage(leadRun.channel_id, summary, leadRun.thread_ts);
        } catch (err: any) {
          logger.warn('Failed to post team results to Slack', { error: err.message });
        }
      }
    }
    return true;
  }

  return false;
}

// ── Results Aggregation ──

export async function getTeamResults(workspaceId: string, teamRunId: string): Promise<{
  completed: SubAgentRun[];
  failed: SubAgentRun[];
  allDone: boolean;
}> {
  const subRuns = await query<SubAgentRun>(
    'SELECT * FROM sub_agent_runs WHERE team_run_id = $1 AND workspace_id = $2',
    [teamRunId, workspaceId]
  );

  return {
    completed: subRuns.filter(r => r.status === 'completed'),
    failed: subRuns.filter(r => r.status === 'failed'),
    allDone: subRuns.every(r => r.status === 'completed' || r.status === 'failed'),
  };
}

// ── Team Cost Attribution ──

export async function getTeamCost(workspaceId: string, teamRunId: string): Promise<number> {
  const result = await queryOne<any>(`
    SELECT COALESCE(SUM(rh.estimated_cost_usd), 0) as total_cost
    FROM sub_agent_runs sar
    JOIN run_history rh ON sar.run_id = rh.id
    WHERE sar.team_run_id = $1 AND sar.workspace_id = $2
  `, [teamRunId, workspaceId]);

  return parseFloat(result?.total_cost || '0');
}

// ── Slack Presentation ──

export async function formatTeamProgress(workspaceId: string, teamRunId: string): Promise<string> {
  const teamRun = await getTeamRun(workspaceId, teamRunId);
  if (!teamRun) return 'Team run not found';

  const subAgents = teamRun.sub_agents;
  if (subAgents.length === 0) return 'No sub-agents spawned yet';

  const lines: string[] = ['*Team Progress:*'];
  for (const sub of subAgents) {
    const statusEmoji = sub.status === 'completed' ? ':white_check_mark:'
      : sub.status === 'failed' ? ':x:'
      : sub.status === 'running' ? ':hourglass:'
      : ':clock1:';

    const agentName = await resolveAgentName(workspaceId, sub.agent_id);
    lines.push(`${statusEmoji} *${agentName}* (depth ${sub.depth}): ${sub.task.slice(0, 60)}`);

    if (sub.result) {
      lines.push(`  _Result: ${sub.result.slice(0, 100)}_`);
    }
  }

  return lines.join('\n');
}
