import { query } from '../../db';
import { getMetrics } from '../dashboard';
import { listAgents } from '../agents';
import { config } from '../../config';
import type { AlertCondition, AlertRule, StructuredLog } from '../../types';
import { logger } from '../../utils/logger';

// ── Alert Rules ──

const DEFAULT_ALERT_RULES: AlertRule[] = [
  { condition: 'error_rate', threshold: 0.10, action: 'Alert to #tinyjobs with recent errors' },
  { condition: 'single_run_cost', threshold: 5.0, action: 'Warning to agent channel + #tinyjobs' },
  { condition: 'daily_spend', threshold: config.observability.dailyBudgetUsd, action: 'Pause non-critical triggers. Alert.' },
  { condition: 'queue_depth', threshold: 50, action: 'Alert. Suggest scaling workers.' },
  { condition: 'run_duration', threshold: 600000, action: 'Alert to channel. Job not killed.' },
];

export function getAlertRules(): AlertRule[] {
  return [...DEFAULT_ALERT_RULES];
}

// ── Alert Checking ──

export interface AlertResult {
  triggered: boolean;
  condition: AlertCondition;
  value: number;
  threshold: number;
  message: string;
}

export async function checkAlerts(): Promise<AlertResult[]> {
  const results: AlertResult[] = [];

  // Error rate (rolling 1hr)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { rows: hourStatsRows } = await query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM run_history WHERE created_at >= $1
  `, [oneHourAgo]);

  const hourStats = hourStatsRows[0];
  const total = parseInt(hourStats.total);

  if (total > 0) {
    const errorRate = parseInt(hourStats.failed) / total;
    results.push({
      triggered: errorRate > 0.10,
      condition: 'error_rate',
      value: errorRate,
      threshold: 0.10,
      message: `Error rate: ${(errorRate * 100).toFixed(1)}% (${hourStats.failed}/${total} in last hour)`,
    });
  }

  // Single run cost
  const { rows: expensiveRows } = await query(`
    SELECT id, agent_id, estimated_cost_usd
    FROM run_history
    WHERE estimated_cost_usd > $1 AND created_at >= $2
    ORDER BY estimated_cost_usd DESC LIMIT 1
  `, [5.0, oneHourAgo]);

  if (expensiveRows.length > 0) {
    const expensiveRun = expensiveRows[0];
    results.push({
      triggered: true,
      condition: 'single_run_cost',
      value: expensiveRun.estimated_cost_usd,
      threshold: 5.0,
      message: `Run ${expensiveRun.id.slice(0, 8)} cost $${parseFloat(expensiveRun.estimated_cost_usd).toFixed(2)}`,
    });
  }

  // Daily spend
  const today = new Date().toISOString().split('T')[0];
  const { rows: dailyRows } = await query(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
    FROM run_history WHERE created_at >= $1
  `, [today]);

  const dailyTotal = parseFloat(dailyRows[0].total);
  results.push({
    triggered: dailyTotal > config.observability.dailyBudgetUsd,
    condition: 'daily_spend',
    value: dailyTotal,
    threshold: config.observability.dailyBudgetUsd,
    message: `Daily spend: $${dailyTotal.toFixed(2)} / $${config.observability.dailyBudgetUsd}`,
  });

  // Long running tasks
  const { rows: longRows } = await query(`
    SELECT id, agent_id, duration_ms
    FROM run_history
    WHERE duration_ms > $1 AND created_at >= $2
    ORDER BY duration_ms DESC LIMIT 1
  `, [600000, oneHourAgo]);

  if (longRows.length > 0) {
    const longRun = longRows[0];
    results.push({
      triggered: true,
      condition: 'run_duration',
      value: longRun.duration_ms,
      threshold: 600000,
      message: `Run ${longRun.id.slice(0, 8)} took ${(longRun.duration_ms / 1000).toFixed(0)}s`,
    });
  }

  return results.filter(r => r.triggered);
}

// ── Per-Agent Error Rate ──

export async function getAgentErrorRates(): Promise<Array<{ agentId: string; name: string; errorRate: number; total: number }>> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { rows } = await query(`
    SELECT
      rh.agent_id,
      a.name,
      COUNT(*) as total,
      SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM run_history rh
    JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= $1
    GROUP BY rh.agent_id, a.name
    HAVING COUNT(*) > 0
    ORDER BY (CAST(SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) DESC
  `, [oneHourAgo]);

  return rows.map((r: any) => ({
    agentId: r.agent_id,
    name: r.name,
    errorRate: parseInt(r.failed) / parseInt(r.total),
    total: parseInt(r.total),
  }));
}

// ── Daily Digest ──

export async function generateDailyDigest(): Promise<string> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];

  const { rows: statsRows } = await query(`
    SELECT
      COUNT(*) as run_count,
      COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
      COALESCE(SUM(estimated_cost_usd), 0) as cost,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failures
    FROM run_history
    WHERE created_at >= $1 AND created_at < $2
  `, [yesterday, today]);
  const stats = statsRows[0];

  // Top agent by runs
  const { rows: topAgentRows } = await query(`
    SELECT a.name, COUNT(*) as runs
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= $1 AND rh.created_at < $2
    GROUP BY rh.agent_id, a.name ORDER BY runs DESC LIMIT 1
  `, [yesterday, today]);
  const topAgent = topAgentRows[0];

  // Top user
  const { rows: topUserRows } = await query(`
    SELECT slack_user_id, COUNT(*) as runs
    FROM run_history
    WHERE created_at >= $1 AND created_at < $2 AND slack_user_id IS NOT NULL
    GROUP BY slack_user_id ORDER BY runs DESC LIMIT 1
  `, [yesterday, today]);
  const topUser = topUserRows[0];

  // Agents with high error rates
  const { rows: errorAgents } = await query(`
    SELECT a.name,
      COUNT(*) as total,
      SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= $1 AND rh.created_at < $2
    GROUP BY rh.agent_id, a.name
    HAVING CAST(SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) > 0.1 AND COUNT(*) >= 3
  `, [yesterday, today]);

  // Anomalous cost agents (>2x 7-day average)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { rows: anomalous } = await query(`
    SELECT a.name,
      SUM(CASE WHEN rh.created_at >= $1 THEN rh.estimated_cost_usd ELSE 0 END) as yesterday_cost,
      AVG(rh.estimated_cost_usd) * COUNT(DISTINCT date(rh.created_at::timestamp)) / 7.0 as avg_daily_cost
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= $2
    GROUP BY rh.agent_id, a.name
    HAVING SUM(CASE WHEN rh.created_at >= $1 THEN rh.estimated_cost_usd ELSE 0 END) > AVG(rh.estimated_cost_usd) * COUNT(DISTINCT date(rh.created_at::timestamp)) / 7.0 * 2
      AND SUM(CASE WHEN rh.created_at >= $1 THEN rh.estimated_cost_usd ELSE 0 END) > 1
  `, [yesterday, sevenDaysAgo]);

  let digest = `*TinyJobs Daily Digest — ${yesterday}*\n\n`;
  digest += `Runs: *${stats.run_count}* | Tokens: *${parseInt(stats.tokens).toLocaleString()}* | Cost: *$${parseFloat(stats.cost).toFixed(2)}*\n`;

  if (topAgent) digest += `Top agent: *${topAgent.name}* (${topAgent.runs} runs)\n`;
  if (topUser) digest += `Top user: <@${topUser.slack_user_id}> (${topUser.runs} runs)\n`;

  if (errorAgents.length > 0) {
    digest += '\n:warning: *High error rate agents:*\n';
    for (const a of errorAgents) {
      digest += `  - ${a.name}: ${((parseInt(a.failed) / parseInt(a.total)) * 100).toFixed(0)}% error rate (${a.failed}/${a.total})\n`;
    }
  }

  if (anomalous.length > 0) {
    digest += '\n:moneybag: *Anomalous cost agents:*\n';
    for (const a of anomalous) {
      digest += `  - ${a.name}: $${parseFloat(a.yesterday_cost).toFixed(2)} yesterday (2x+ avg)\n`;
    }
  }

  return digest;
}

// ── Trace ID Correlation ──

export async function getRunByTraceId(traceId: string): Promise<any> {
  const { rows } = await query('SELECT * FROM run_history WHERE trace_id = $1', [traceId]);
  return rows[0] ?? null;
}
