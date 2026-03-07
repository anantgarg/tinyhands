import { getDb } from '../../db';
import { listAgents } from '../agents';
import { getRecentRuns } from '../execution';
import type { DashboardMetrics, ModelAlias } from '../../types';
import { logger } from '../../utils/logger';

// ── Slack Home Tab Dashboard ──

export function buildDashboardBlocks(): Record<string, any>[] {
  const blocks: Record<string, any>[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'TinyJobs Dashboard' },
  });

  blocks.push({ type: 'divider' });

  // Agent Fleet
  blocks.push(...buildAgentFleetSection());
  blocks.push({ type: 'divider' });

  // Recent Runs
  blocks.push(...buildRecentRunsSection());
  blocks.push({ type: 'divider' });

  // Source Sync Health
  blocks.push(...buildSourceHealthSection());
  blocks.push({ type: 'divider' });

  // Queue Health
  blocks.push(...buildQueueHealthSection());
  blocks.push({ type: 'divider' });

  // Usage Overview
  blocks.push(...buildUsageOverviewSection());

  // Ensure under 50KB Block Kit limit
  const json = JSON.stringify(blocks);
  if (json.length > 48000) {
    logger.warn('Dashboard exceeds 48KB, truncating', { size: json.length });
    return blocks.slice(0, 20); // Truncate to fit
  }

  return blocks;
}

function buildAgentFleetSection(): Record<string, any>[] {
  const agents = listAgents();
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
        text: `${agent.avatar_emoji} *${agent.name}* — <#${agent.channel_id}> — ${agent.status} — ${agent.permission_level} — ${agent.model}`,
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

function buildRecentRunsSection(): Record<string, any>[] {
  const runs = getRecentRuns(10);
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

function buildSourceHealthSection(): Record<string, any>[] {
  const db = getDb();
  const sources = db.prepare(`
    SELECT s.*, a.name as agent_name
    FROM sources s
    JOIN agents a ON s.agent_id = a.id
    ORDER BY s.last_sync_at DESC
    LIMIT 10
  `).all() as any[];

  const blocks: Record<string, any>[] = [];
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Source Sync Health*' },
  });

  for (const source of sources) {
    const statusEmoji = source.status === 'active' ? ':white_check_mark:'
      : source.status === 'error' ? ':warning:'
      : ':arrows_counterclockwise:';

    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `${statusEmoji} *${source.label}* (${source.source_type}) — ${source.agent_name} — ${source.chunk_count} chunks — last sync: ${source.last_sync_at || 'never'}`,
      }],
    });
  }

  if (sources.length === 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_No source connections_' }],
    });
  }

  return blocks;
}

function buildQueueHealthSection(): Record<string, any>[] {
  // Queue metrics would come from Redis in production
  return [{
    type: 'section',
    text: { type: 'mrkdwn', text: '*Queue Health*\n_Connect to Redis for live queue metrics_' },
  }];
}

function buildUsageOverviewSection(): Record<string, any>[] {
  const metrics = getMetrics(30);

  return [{
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Usage Overview (30 days)*\n` +
        `Total runs: ${metrics.totalRuns}\n` +
        `Total tokens: ${metrics.totalTokens.toLocaleString()}\n` +
        `Total cost: $${metrics.totalCostUsd.toFixed(2)}\n` +
        `Error rate: ${(metrics.errorRate * 100).toFixed(1)}%\n` +
        `Avg duration: ${(metrics.avgDurationMs / 1000).toFixed(1)}s`,
    },
  }];
}

// ── Metrics ──

export function getMetrics(days: number = 30): DashboardMetrics {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_runs,
      COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
      COALESCE(AVG(duration_ms), 0) as avg_duration,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed_runs
    FROM run_history
    WHERE created_at >= ?
  `).get(since) as any;

  // Percentiles
  const durations = db.prepare(`
    SELECT duration_ms FROM run_history
    WHERE created_at >= ? AND status = 'completed'
    ORDER BY duration_ms
  `).all(since) as { duration_ms: number }[];

  const p50 = percentile(durations.map(d => d.duration_ms), 50);
  const p95 = percentile(durations.map(d => d.duration_ms), 95);
  const p99 = percentile(durations.map(d => d.duration_ms), 99);

  // Tokens by agent
  const byAgent = db.prepare(`
    SELECT agent_id, SUM(input_tokens + output_tokens) as tokens
    FROM run_history WHERE created_at >= ?
    GROUP BY agent_id ORDER BY tokens DESC
  `).all(since) as any[];

  // Tokens by model
  const byModel = db.prepare(`
    SELECT model, SUM(input_tokens + output_tokens) as tokens
    FROM run_history WHERE created_at >= ?
    GROUP BY model
  `).all(since) as any[];

  // Runs by agent
  const runsByAgent = db.prepare(`
    SELECT agent_id, COUNT(*) as count
    FROM run_history WHERE created_at >= ?
    GROUP BY agent_id ORDER BY count DESC
  `).all(since) as any[];

  // Queue wait percentiles
  const waits = db.prepare(`
    SELECT queue_wait_ms FROM run_history
    WHERE created_at >= ? AND queue_wait_ms > 0
    ORDER BY queue_wait_ms
  `).all(since) as { queue_wait_ms: number }[];

  return {
    totalRuns: stats.total_runs,
    totalTokens: stats.total_tokens,
    totalCostUsd: stats.total_cost,
    errorRate: stats.total_runs > 0 ? stats.failed_runs / stats.total_runs : 0,
    avgDurationMs: stats.avg_duration,
    p50DurationMs: p50,
    p95DurationMs: p95,
    p99DurationMs: p99,
    queueWaitP50Ms: percentile(waits.map(w => w.queue_wait_ms), 50),
    queueWaitP95Ms: percentile(waits.map(w => w.queue_wait_ms), 95),
    tokensByAgent: Object.fromEntries(byAgent.map(r => [r.agent_id, r.tokens])),
    tokensByUser: {},
    tokensByModel: Object.fromEntries(byModel.map(r => [r.model, r.tokens])) as Record<ModelAlias, number>,
    runsByAgent: Object.fromEntries(runsByAgent.map(r => [r.agent_id, r.count])),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
