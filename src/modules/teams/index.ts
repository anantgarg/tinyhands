import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
import { getAgent } from '../agents';
import { enqueueRun } from '../../queue';
import type { TeamRun, SubAgentRun, RunStatus, JobData } from '../../types';
import { logger } from '../../utils/logger';

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_DEPTH = 2;

// ── Team Management ──

export function createTeamRun(
  leadAgentId: string,
  leadRunId: string,
  maxConcurrent?: number,
  maxDepth?: number
): TeamRun {
  const db = getDb();
  const agent = getAgent(leadAgentId);
  if (!agent) throw new Error(`Agent ${leadAgentId} not found`);

  if (agent.permission_level !== 'full') {
    throw new Error('Agent teams require full permission level');
  }

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

  db.prepare(`
    INSERT INTO team_runs (id, lead_agent_id, lead_run_id, max_concurrent, max_depth, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(teamRun.id, teamRun.lead_agent_id, teamRun.lead_run_id,
    teamRun.max_concurrent, teamRun.max_depth, teamRun.created_at);

  logger.info('Team run created', { teamRunId: id, leadAgentId });
  return teamRun;
}

export function getTeamRun(id: string): TeamRun | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM team_runs WHERE id = ?').get(id) as any;
  if (!row) return null;

  const subAgents = db.prepare(
    'SELECT * FROM sub_agent_runs WHERE team_run_id = ?'
  ).all(id) as SubAgentRun[];

  return { ...row, sub_agents: subAgents };
}

// ── Sub-Agent Spawning ──

export async function spawnSubAgent(
  teamRunId: string,
  agentId: string,
  task: string,
  depth: number = 1
): Promise<SubAgentRun> {
  const db = getDb();
  const teamRun = getTeamRun(teamRunId);
  if (!teamRun) throw new Error(`Team run ${teamRunId} not found`);

  // Check depth limit
  if (depth > teamRun.max_depth) {
    throw new Error(`Max spawn depth (${teamRun.max_depth}) exceeded. Cannot spawn at depth ${depth}.`);
  }

  // Check concurrent limit
  const activeCount = db.prepare(
    'SELECT COUNT(*) as count FROM sub_agent_runs WHERE team_run_id = ? AND status IN (?, ?)'
  ).get(teamRunId, 'queued', 'running') as any;

  if (activeCount.count >= teamRun.max_concurrent) {
    throw new Error(`Max concurrent sub-agents (${teamRun.max_concurrent}) reached`);
  }

  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // Sub-agents inherit lead's permissions but cannot elevate
  const leadAgent = getAgent(teamRun.lead_agent_id);
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

  db.prepare(`
    INSERT INTO sub_agent_runs (id, team_run_id, agent_id, run_id, depth, status, task, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(subAgentRun.id, subAgentRun.team_run_id, subAgentRun.agent_id,
    subAgentRun.run_id, subAgentRun.depth, subAgentRun.status, subAgentRun.task);

  // Enqueue the sub-agent's run
  const jobData: JobData = {
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
  subAgentRunId: string,
  status: RunStatus,
  result: string
): Promise<void> {
  const db = getDb();
  db.prepare(
    'UPDATE sub_agent_runs SET status = ?, result = ? WHERE id = ?'
  ).run(status, result, subAgentRunId);

  const subRun = db.prepare('SELECT * FROM sub_agent_runs WHERE id = ?').get(subAgentRunId) as SubAgentRun;
  if (!subRun) return;

  logger.info('Sub-agent completed', {
    subAgentRunId,
    teamRunId: subRun.team_run_id,
    status,
  });

  // Check if all sub-agents are done — post results to Slack
  await checkTeamCompletion(subRun.team_run_id);
}

async function checkTeamCompletion(teamRunId: string): Promise<boolean> {
  const db = getDb();
  const pending = db.prepare(
    'SELECT COUNT(*) as count FROM sub_agent_runs WHERE team_run_id = ? AND status IN (?, ?)'
  ).get(teamRunId, 'queued', 'running') as any;

  if (pending.count === 0) {
    // All sub-agents done — post aggregated results to lead agent's thread
    const teamRun = getTeamRun(teamRunId);
    if (teamRun) {
      const leadRun = db.prepare('SELECT * FROM run_history WHERE id = ?').get(teamRun.lead_run_id) as any;
      if (leadRun?.channel_id && leadRun?.thread_ts) {
        try {
          const { postMessage } = await import('../../slack');
          const results = getTeamResults(teamRunId);
          const cost = getTeamCost(teamRunId);

          let summary = `:checkered_flag: *Team run complete*\n`;
          summary += `Completed: ${results.completed.length} | Failed: ${results.failed.length} | Cost: $${cost.toFixed(4)}\n\n`;

          for (const sub of results.completed) {
            summary += `:white_check_mark: *${sub.agent_id.slice(0, 8)}*: ${(sub.result || '').slice(0, 200)}\n`;
          }
          for (const sub of results.failed) {
            summary += `:x: *${sub.agent_id.slice(0, 8)}*: ${(sub.result || 'Failed').slice(0, 200)}\n`;
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

export function getTeamResults(teamRunId: string): {
  completed: SubAgentRun[];
  failed: SubAgentRun[];
  allDone: boolean;
} {
  const db = getDb();
  const subRuns = db.prepare(
    'SELECT * FROM sub_agent_runs WHERE team_run_id = ?'
  ).all(teamRunId) as SubAgentRun[];

  return {
    completed: subRuns.filter(r => r.status === 'completed'),
    failed: subRuns.filter(r => r.status === 'failed'),
    allDone: subRuns.every(r => r.status === 'completed' || r.status === 'failed'),
  };
}

// ── Team Cost Attribution ──

export function getTeamCost(teamRunId: string): number {
  const db = getDb();
  const result = db.prepare(`
    SELECT COALESCE(SUM(rh.estimated_cost_usd), 0) as total_cost
    FROM sub_agent_runs sar
    JOIN run_history rh ON sar.run_id = rh.id
    WHERE sar.team_run_id = ?
  `).get(teamRunId) as any;

  return result.total_cost;
}

// ── Slack Presentation ──

export function formatTeamProgress(teamRunId: string): string {
  const teamRun = getTeamRun(teamRunId);
  if (!teamRun) return 'Team run not found';

  const subAgents = teamRun.sub_agents;
  if (subAgents.length === 0) return 'No sub-agents spawned yet';

  const lines: string[] = ['*Team Progress:*'];
  for (const sub of subAgents) {
    const statusEmoji = sub.status === 'completed' ? ':white_check_mark:'
      : sub.status === 'failed' ? ':x:'
      : sub.status === 'running' ? ':hourglass:'
      : ':clock1:';

    lines.push(`${statusEmoji} *${sub.agent_id.slice(0, 8)}* (depth ${sub.depth}): ${sub.task.slice(0, 60)}`);

    if (sub.result) {
      lines.push(`  _Result: ${sub.result.slice(0, 100)}_`);
    }
  }

  return lines.join('\n');
}
