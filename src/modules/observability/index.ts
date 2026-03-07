import { getDb } from '../../db';
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

export function checkAlerts(): AlertResult[] {
  const results: AlertResult[] = [];
  const db = getDb();

  // Error rate (rolling 1hr)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const hourStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM run_history WHERE created_at >= ?
  `).get(oneHourAgo) as any;

  if (hourStats.total > 0) {
    const errorRate = hourStats.failed / hourStats.total;
    results.push({
      triggered: errorRate > 0.10,
      condition: 'error_rate',
      value: errorRate,
      threshold: 0.10,
      message: `Error rate: ${(errorRate * 100).toFixed(1)}% (${hourStats.failed}/${hourStats.total} in last hour)`,
    });
  }

  // Single run cost
  const expensiveRun = db.prepare(`
    SELECT id, agent_id, estimated_cost_usd
    FROM run_history
    WHERE estimated_cost_usd > ? AND created_at >= ?
    ORDER BY estimated_cost_usd DESC LIMIT 1
  `).get(5.0, oneHourAgo) as any;

  if (expensiveRun) {
    results.push({
      triggered: true,
      condition: 'single_run_cost',
      value: expensiveRun.estimated_cost_usd,
      threshold: 5.0,
      message: `Run ${expensiveRun.id.slice(0, 8)} cost $${expensiveRun.estimated_cost_usd.toFixed(2)}`,
    });
  }

  // Daily spend
  const today = new Date().toISOString().split('T')[0];
  const dailySpend = db.prepare(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
    FROM run_history WHERE created_at >= ?
  `).get(today) as any;

  results.push({
    triggered: dailySpend.total > config.observability.dailyBudgetUsd,
    condition: 'daily_spend',
    value: dailySpend.total,
    threshold: config.observability.dailyBudgetUsd,
    message: `Daily spend: $${dailySpend.total.toFixed(2)} / $${config.observability.dailyBudgetUsd}`,
  });

  // Long running tasks
  const longRun = db.prepare(`
    SELECT id, agent_id, duration_ms
    FROM run_history
    WHERE duration_ms > ? AND created_at >= ?
    ORDER BY duration_ms DESC LIMIT 1
  `).get(600000, oneHourAgo) as any;

  if (longRun) {
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

export function getAgentErrorRates(): Array<{ agentId: string; name: string; errorRate: number; total: number }> {
  const db = getDb();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  return db.prepare(`
    SELECT
      rh.agent_id,
      a.name,
      COUNT(*) as total,
      SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM run_history rh
    JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= ?
    GROUP BY rh.agent_id
    HAVING total > 0
    ORDER BY (CAST(failed AS REAL) / total) DESC
  `).all(oneHourAgo).map((r: any) => ({
    agentId: r.agent_id,
    name: r.name,
    errorRate: r.failed / r.total,
    total: r.total,
  }));
}

// ── Daily Digest ──

export function generateDailyDigest(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];

  const db = getDb();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as run_count,
      COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
      COALESCE(SUM(estimated_cost_usd), 0) as cost,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failures
    FROM run_history
    WHERE created_at >= ? AND created_at < ?
  `).get(yesterday, today) as any;

  // Top agent by runs
  const topAgent = db.prepare(`
    SELECT a.name, COUNT(*) as runs
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= ? AND rh.created_at < ?
    GROUP BY rh.agent_id ORDER BY runs DESC LIMIT 1
  `).get(yesterday, today) as any;

  // Top user
  const topUser = db.prepare(`
    SELECT slack_user_id, COUNT(*) as runs
    FROM run_history
    WHERE created_at >= ? AND created_at < ? AND slack_user_id IS NOT NULL
    GROUP BY slack_user_id ORDER BY runs DESC LIMIT 1
  `).get(yesterday, today) as any;

  // Agents with high error rates
  const errorAgents = db.prepare(`
    SELECT a.name,
      COUNT(*) as total,
      SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= ? AND rh.created_at < ?
    GROUP BY rh.agent_id
    HAVING CAST(failed AS REAL) / total > 0.1 AND total >= 3
  `).all(yesterday, today) as any[];

  // Anomalous cost agents (>2x 7-day average)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const anomalous = db.prepare(`
    SELECT a.name,
      SUM(CASE WHEN rh.created_at >= ? THEN rh.estimated_cost_usd ELSE 0 END) as yesterday_cost,
      AVG(rh.estimated_cost_usd) * COUNT(DISTINCT date(rh.created_at)) / 7.0 as avg_daily_cost
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= ?
    GROUP BY rh.agent_id
    HAVING yesterday_cost > avg_daily_cost * 2 AND yesterday_cost > 1
  `).all(yesterday, sevenDaysAgo) as any[];

  let digest = `*TinyJobs Daily Digest — ${yesterday}*\n\n`;
  digest += `Runs: *${stats.run_count}* | Tokens: *${stats.tokens.toLocaleString()}* | Cost: *$${stats.cost.toFixed(2)}*\n`;

  if (topAgent) digest += `Top agent: *${topAgent.name}* (${topAgent.runs} runs)\n`;
  if (topUser) digest += `Top user: <@${topUser.slack_user_id}> (${topUser.runs} runs)\n`;

  if (errorAgents.length > 0) {
    digest += '\n:warning: *High error rate agents:*\n';
    for (const a of errorAgents) {
      digest += `  - ${a.name}: ${((a.failed / a.total) * 100).toFixed(0)}% error rate (${a.failed}/${a.total})\n`;
    }
  }

  if (anomalous.length > 0) {
    digest += '\n:moneybag: *Anomalous cost agents:*\n';
    for (const a of anomalous) {
      digest += `  - ${a.name}: $${a.yesterday_cost.toFixed(2)} yesterday (2x+ avg)\n`;
    }
  }

  return digest;
}

// ── Trace ID Correlation ──

export function getRunByTraceId(traceId: string): any {
  const db = getDb();
  return db.prepare('SELECT * FROM run_history WHERE trace_id = ?').get(traceId);
}
