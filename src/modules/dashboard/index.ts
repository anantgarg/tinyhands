import { query, queryOne } from '../../db';
import { listAgents } from '../agents';
import { getRecentRuns } from '../execution';
import { config } from '../../config';
import type { DashboardMetrics, ModelAlias } from '../../types';
import { logger } from '../../utils/logger';
import { version } from '../../../package.json';

// ── Slack Home Tab Dashboard ──

export async function buildDashboardBlocks(_workspaceId: string): Promise<Record<string, any>[]> {
  const dashboardUrl = config.server.webDashboardUrl || config.oauth.redirectBaseUrl || `http://localhost:${config.server.port}`;

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `✋ TinyHands` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Manage your AI agents, tools, knowledge base, and more from the web dashboard.',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open Dashboard' },
          url: dashboardUrl,
          style: 'primary',
        },
      ],
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `v${version} • Send a DM to interact with your agents`,
      }],
    },
  ];
}

async function buildUsageSnapshotSection(workspaceId: string): Promise<Record<string, any>[]> {
  const metrics = await getMetrics(workspaceId, 30);

  const errorRate = (metrics.errorRate * 100).toFixed(1);
  const avgDuration = (metrics.avgDurationMs / 1000).toFixed(1);

  return [{
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Usage Snapshot (30 days)*\n` +
        `:chart_with_upwards_trend: *${metrics.totalRuns}* runs  |  :coin: *$${metrics.totalCostUsd.toFixed(2)}* spent  |  :zap: *${metrics.totalTokens.toLocaleString()}* tokens\n` +
        `:stopwatch: avg *${avgDuration}s*  |  :rotating_light: *${errorRate}%* error rate`,
    },
  }];
}

async function buildTopPowerUsersSection(workspaceId: string): Promise<Record<string, any>[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const rows = await query<any>(`
    SELECT r.slack_user_id, COUNT(*) as run_count,
      array_agg(DISTINCT a.name) as agent_names
    FROM run_history r
    JOIN agents a ON r.agent_id = a.id
    WHERE r.slack_user_id IS NOT NULL AND r.created_at >= $1 AND r.workspace_id = $2
    GROUP BY r.slack_user_id
    ORDER BY run_count DESC
    LIMIT 5
  `, [since, workspaceId]);

  const blocks: Record<string, any>[] = [];
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Top Power Users*' },
  });

  if (rows.length === 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_No user activity yet_' }],
    });
    return blocks;
  }

  const medals = [':first_place_medal:', ':second_place_medal:', ':third_place_medal:', ':star:', ':star:'];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const medal = medals[i];
    const agentList = (row.agent_names || []).join(', ');
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `${medal} <@${row.slack_user_id}> — *${row.run_count} runs* — uses ${agentList}`,
      }],
    });
  }

  return blocks;
}

async function buildTopAgentCreatorsSection(workspaceId: string): Promise<Record<string, any>[]> {
  const rows = await query<any>(`
    SELECT created_by, COUNT(*) as agent_count,
      array_agg(name ORDER BY created_at DESC) as agent_names
    FROM agents
    WHERE status != 'archived' AND workspace_id = $1
    GROUP BY created_by
    ORDER BY agent_count DESC
    LIMIT 5
  `, [workspaceId]);

  const blocks: Record<string, any>[] = [];
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Top Agent Creators*' },
  });

  if (rows.length === 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_No agents created yet_' }],
    });
    return blocks;
  }

  for (const row of rows) {
    const names: string[] = row.agent_names || [];
    let nameDisplay: string;
    if (names.length <= 3) {
      nameDisplay = names.join(', ');
    } else {
      nameDisplay = names.slice(0, 3).join(', ') + ` +${names.length - 3} more`;
    }
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `:hammer_and_wrench: <@${row.created_by}> — *${row.agent_count} agents* — ${nameDisplay}`,
      }],
    });
  }

  return blocks;
}

async function buildMostPopularAgentsSection(workspaceId: string): Promise<Record<string, any>[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const rows = await query<any>(`
    SELECT r.agent_id, a.name, a.avatar_emoji, COUNT(*) as run_count,
      COALESCE(SUM(r.estimated_cost_usd), 0) as total_cost
    FROM run_history r
    JOIN agents a ON r.agent_id = a.id
    WHERE r.created_at >= $1 AND r.workspace_id = $2
    GROUP BY r.agent_id, a.name, a.avatar_emoji
    ORDER BY run_count DESC
    LIMIT 5
  `, [since, workspaceId]);

  const blocks: Record<string, any>[] = [];
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Most Popular Agents*' },
  });

  if (rows.length === 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_No agent runs yet_' }],
    });
    return blocks;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prefix = i === 0 ? ':fire:' : ':chart_with_upwards_trend:';
    const cost = parseFloat(row.total_cost).toFixed(2);
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `${prefix} ${row.avatar_emoji} *${row.name}* — *${row.run_count} runs* — $${cost} spent`,
      }],
    });
  }

  return blocks;
}

async function buildAgentFleetSection(workspaceId: string): Promise<Record<string, any>[]> {
  const agents = await listAgents(workspaceId);
  const blocks: Record<string, any>[] = [];

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Agent Fleet* (${agents.length} agents)`,
    },
  });

  // Show first 10 agents, paginate rest
  const visible = agents.slice(0, 10);
  for (const agent of visible) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${agent.avatar_emoji} *${agent.name}* — <#${agent.channel_id}> — ${agent.status} — ${agent.model}`,
      },
    });
  }

  if (agents.length > 10) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `_...and ${agents.length - 10} more agents_`,
      }],
    });
  }

  return blocks;
}

async function buildRecentRunsSection(workspaceId: string): Promise<Record<string, any>[]> {
  const runs = await getRecentRuns(workspaceId, 10);
  const blocks: Record<string, any>[] = [];

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Recent Runs*' },
  });

  for (const run of runs) {
    const statusEmoji = run.status === 'completed' ? ':white_check_mark:'
      : run.status === 'failed' ? ':x:'
      : run.status === 'running' ? ':hourglass:'
      : ':clock1:';

    const duration = run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '-';
    const cost = run.estimated_cost_usd ? `$${run.estimated_cost_usd.toFixed(4)}` : '-';

    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `${statusEmoji} \`${run.trace_id.slice(0, 8)}\` — ${run.agent_id.slice(0, 8)} — ${duration} — ${cost} — ${run.model}`,
      }],
    });
  }

  if (runs.length === 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_No recent runs_' }],
    });
  }

  return blocks;
}

async function buildRecentActivitySection(workspaceId: string): Promise<Record<string, any>[]> {
  const blocks: Record<string, any>[] = [];
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Recent Activity*' } });

  try {
    const { getAuditLog } = await import('../audit');
    const entries = await getAuditLog(workspaceId, { limit: 10 });

    if (entries.length === 0) {
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_No recent activity_' }] });
      return blocks;
    }

    for (const entry of entries) {
      const agent = entry.agent_name ? ` on *${entry.agent_name}*` : '';
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `\`${entry.action_type}\` by <@${entry.actor_user_id}>${agent} — ${entry.status}` }],
      });
    }
  } catch {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_Audit log unavailable_' }] });
  }

  return blocks;
}

// ── Metrics ──

export async function getMetrics(workspaceId: string, days: number = 30): Promise<DashboardMetrics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const stats = await queryOne<any>(`
    SELECT
      COUNT(*) as total_runs,
      COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
      COALESCE(AVG(duration_ms), 0) as avg_duration,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed_runs
    FROM run_history
    WHERE created_at >= $1 AND workspace_id = $2
  `, [since, workspaceId]);

  // Percentiles
  const durations = await query<{ duration_ms: number }>(`
    SELECT duration_ms FROM run_history
    WHERE created_at >= $1 AND status = 'completed' AND workspace_id = $2
    ORDER BY duration_ms
  `, [since, workspaceId]);

  const p50 = percentile(durations.map(d => d.duration_ms), 50);
  const p95 = percentile(durations.map(d => d.duration_ms), 95);
  const p99 = percentile(durations.map(d => d.duration_ms), 99);

  // Tokens by agent
  const byAgent = await query<any>(`
    SELECT agent_id, SUM(input_tokens + output_tokens) as tokens
    FROM run_history WHERE created_at >= $1 AND workspace_id = $2
    GROUP BY agent_id ORDER BY tokens DESC
  `, [since, workspaceId]);

  // Tokens by model
  const byModel = await query<any>(`
    SELECT model, SUM(input_tokens + output_tokens) as tokens
    FROM run_history WHERE created_at >= $1 AND workspace_id = $2
    GROUP BY model
  `, [since, workspaceId]);

  // Runs by agent
  const runsByAgent = await query<any>(`
    SELECT agent_id, COUNT(*) as count
    FROM run_history WHERE created_at >= $1 AND workspace_id = $2
    GROUP BY agent_id ORDER BY count DESC
  `, [since, workspaceId]);

  // Queue wait percentiles
  const waits = await query<{ queue_wait_ms: number }>(`
    SELECT queue_wait_ms FROM run_history
    WHERE created_at >= $1 AND queue_wait_ms > 0 AND workspace_id = $2
    ORDER BY queue_wait_ms
  `, [since, workspaceId]);

  const totalRuns = parseInt(stats?.total_runs || '0', 10);
  const failedRuns = parseInt(stats?.failed_runs || '0', 10);

  return {
    totalRuns,
    totalTokens: parseInt(stats?.total_tokens || '0', 10),
    totalCostUsd: parseFloat(stats?.total_cost || '0'),
    errorRate: totalRuns > 0 ? failedRuns / totalRuns : 0,
    avgDurationMs: parseFloat(stats?.avg_duration || '0'),
    p50DurationMs: p50,
    p95DurationMs: p95,
    p99DurationMs: p99,
    queueWaitP50Ms: percentile(waits.map(w => w.queue_wait_ms), 50),
    queueWaitP95Ms: percentile(waits.map(w => w.queue_wait_ms), 95),
    tokensByAgent: Object.fromEntries(byAgent.map((r: any) => [r.agent_id, parseInt(r.tokens, 10)])),
    tokensByUser: {},
    tokensByModel: Object.fromEntries(byModel.map((r: any) => [r.model, parseInt(r.tokens, 10)])) as Record<ModelAlias, number>,
    runsByAgent: Object.fromEntries(runsByAgent.map((r: any) => [r.agent_id, parseInt(r.count, 10)])),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
