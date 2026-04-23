import { query, queryOne } from '../../db';
import { getMetrics } from '../dashboard';
import { listAgents } from '../agents';
import { config } from '../../config';
import type { AlertCondition, AlertRule, StructuredLog } from '../../types';
import { logger } from '../../utils/logger';
import { friendlyModel } from '../../utils/labels';

// ── Alert Rules ──

const DEFAULT_ALERT_RULES: AlertRule[] = [
  { condition: 'error_rate', threshold: 0.10, action: 'Alert to #tinyhands with recent errors' },
  { condition: 'single_run_cost', threshold: 5.0, action: 'Warning to agent channel + #tinyhands' },
  { condition: 'daily_spend', threshold: config.observability.dailyBudgetUsd, action: 'Pause non-critical triggers. Alert.' },
  { condition: 'queue_depth', threshold: 50, action: 'Alert. Suggest scaling workers.' },
  { condition: 'run_duration', threshold: config.docker.defaultJobTimeoutMs, action: 'Alert to channel. Job not killed.' },
];

// ── Alert Deduplication ──
// Track which alerts have been posted recently to avoid spamming
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between same alert

function shouldFireAlert(key: string): boolean {
  const lastFired = alertCooldowns.get(key) || 0;
  if (Date.now() - lastFired < ALERT_COOLDOWN_MS) return false;
  alertCooldowns.set(key, Date.now());
  return true;
}

/** Reset dedup state — exposed for testing only */
export function resetAlertCooldowns(): void {
  alertCooldowns.clear();
}

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

export async function checkAlerts(workspaceId: string): Promise<AlertResult[]> {
  const results: AlertResult[] = [];

  // Error rate (rolling 1hr)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const hourStats = await queryOne<any>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM run_history WHERE created_at >= $1 AND workspace_id = $2
  `, [oneHourAgo, workspaceId]);

  if (hourStats && parseInt(hourStats.total, 10) >= 3) {
    const total = parseInt(hourStats.total, 10);
    const failed = parseInt(hourStats.failed, 10);
    const errorRate = failed / total;
    if (errorRate > 0.10 && shouldFireAlert(`error_rate:${Math.floor(Date.now() / ALERT_COOLDOWN_MS)}`)) {
      results.push({
        triggered: true,
        condition: 'error_rate',
        value: errorRate,
        threshold: 0.10,
        message: `${(errorRate * 100).toFixed(0)}% of runs failed in the last hour (${failed} out of ${total} runs)`,
      });
    }
  }

  // Single run cost
  const expensiveRun = await queryOne<any>(`
    SELECT rh.id, rh.agent_id, rh.estimated_cost_usd, rh.model, rh.input_tokens, rh.output_tokens, a.name as agent_name
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.estimated_cost_usd > $1 AND rh.created_at >= $2 AND rh.workspace_id = $3
    ORDER BY rh.estimated_cost_usd DESC LIMIT 1
  `, [5.0, oneHourAgo, workspaceId]);

  if (expensiveRun) {
    const cost = parseFloat(expensiveRun.estimated_cost_usd);
    results.push({
      triggered: shouldFireAlert(`single_run_cost:${expensiveRun.id}`),
      condition: 'single_run_cost',
      value: cost,
      threshold: 5.0,
      message: `*${expensiveRun.agent_name}* had an expensive run: *$${cost.toFixed(2)}* (${friendlyModel(expensiveRun.model)}, ${expensiveRun.input_tokens.toLocaleString()} in / ${expensiveRun.output_tokens.toLocaleString()} out tokens)`,
    });
  }

  // Daily spend
  const today = new Date().toISOString().split('T')[0];
  const dailySpend = await queryOne<any>(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
    FROM run_history WHERE created_at >= $1 AND workspace_id = $2
  `, [today, workspaceId]);

  const dailyTotal = parseFloat(dailySpend?.total || '0');
  if (dailyTotal > config.observability.dailyBudgetUsd && shouldFireAlert(`daily_spend:${today}`)) {
    results.push({
      triggered: true,
      condition: 'daily_spend',
      value: dailyTotal,
      threshold: config.observability.dailyBudgetUsd,
      message: `Daily spend has reached *$${dailyTotal.toFixed(2)}* (budget: $${config.observability.dailyBudgetUsd})`,
    });
  }

  // Long running tasks
  const durationThreshold = config.docker.defaultJobTimeoutMs;
  const longRun = await queryOne<any>(`
    SELECT rh.id, rh.agent_id, rh.duration_ms, a.name as agent_name
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.duration_ms > $1 AND rh.created_at >= $2 AND rh.workspace_id = $3
    ORDER BY rh.duration_ms DESC LIMIT 1
  `, [durationThreshold, oneHourAgo, workspaceId]);

  if (longRun && shouldFireAlert(`run_duration:${longRun.id}`)) {
    const mins = (longRun.duration_ms / 60000).toFixed(1);
    results.push({
      triggered: true,
      condition: 'run_duration',
      value: longRun.duration_ms,
      threshold: durationThreshold,
      message: `*${longRun.agent_name}* ran for ${mins} minutes (timeout is ${(durationThreshold / 60000).toFixed(0)} min)`,
    });
  }

  return results.filter(r => r.triggered);
}

// ── Per-Agent Error Rate ──

export async function getAgentErrorRates(workspaceId: string): Promise<Array<{ agentId: string; name: string; errorRate: number; total: number }>> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const rows = await query<any>(`
    SELECT
      rh.agent_id,
      a.name,
      COUNT(*) as total,
      SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM run_history rh
    JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= $1 AND rh.workspace_id = $2
    GROUP BY rh.agent_id, a.name
    HAVING COUNT(*) > 0
    ORDER BY (SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END)::float / COUNT(*)) DESC
  `, [oneHourAgo, workspaceId]);

  return rows.map((r: any) => ({
    agentId: r.agent_id,
    name: r.name,
    errorRate: parseInt(r.failed, 10) / parseInt(r.total, 10),
    total: parseInt(r.total, 10),
  }));
}

// ── Daily Digest ──

export async function generateDailyDigest(workspaceId: string): Promise<string> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];

  const stats = await queryOne<any>(`
    SELECT
      COUNT(*) as run_count,
      COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
      COALESCE(SUM(estimated_cost_usd), 0) as cost,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failures
    FROM run_history
    WHERE created_at >= $1 AND created_at < $2 AND workspace_id = $3
  `, [yesterday, today, workspaceId]);

  // Top agent by runs
  const topAgent = await queryOne<any>(`
    SELECT a.name, COUNT(*) as runs
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= $1 AND rh.created_at < $2 AND rh.workspace_id = $3
    GROUP BY rh.agent_id, a.name ORDER BY runs DESC LIMIT 1
  `, [yesterday, today, workspaceId]);

  // Top user
  const topUser = await queryOne<any>(`
    SELECT slack_user_id, COUNT(*) as runs
    FROM run_history
    WHERE created_at >= $1 AND created_at < $2 AND slack_user_id IS NOT NULL AND workspace_id = $3
    GROUP BY slack_user_id ORDER BY runs DESC LIMIT 1
  `, [yesterday, today, workspaceId]);

  // Agents with high error rates
  const errorAgents = await query<any>(`
    SELECT a.name,
      COUNT(*) as total,
      SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= $1 AND rh.created_at < $2 AND rh.workspace_id = $3
    GROUP BY rh.agent_id, a.name
    HAVING SUM(CASE WHEN rh.status = 'failed' THEN 1 ELSE 0 END)::float / COUNT(*) > 0.1 AND COUNT(*) >= 3
  `, [yesterday, today, workspaceId]);

  // Anomalous cost agents (>2x 7-day average)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const anomalous = await query<any>(`
    SELECT a.name,
      SUM(CASE WHEN rh.created_at >= $1 THEN rh.estimated_cost_usd ELSE 0 END) as yesterday_cost,
      AVG(rh.estimated_cost_usd) * COUNT(DISTINCT date(rh.created_at)) / 7.0 as avg_daily_cost
    FROM run_history rh JOIN agents a ON rh.agent_id = a.id
    WHERE rh.created_at >= $2 AND rh.workspace_id = $3
    GROUP BY rh.agent_id, a.name
    HAVING SUM(CASE WHEN rh.created_at >= $1 THEN rh.estimated_cost_usd ELSE 0 END) > AVG(rh.estimated_cost_usd) * COUNT(DISTINCT date(rh.created_at)) / 7.0 * 2
      AND SUM(CASE WHEN rh.created_at >= $1 THEN rh.estimated_cost_usd ELSE 0 END) > 1
  `, [yesterday, sevenDaysAgo, workspaceId]);

  const runCount = parseInt(stats?.run_count || '0', 10);
  const tokens = parseInt(stats?.tokens || '0', 10);
  const cost = parseFloat(stats?.cost || '0');

  let digest = `✋ *TinyHands Daily Digest — ${yesterday}*\n\n`;
  digest += `Runs: *${runCount}* | Tokens: *${tokens.toLocaleString()}* | Cost: *$${cost.toFixed(2)}*\n`;

  if (topAgent) digest += `Top agent: *${topAgent.name}* (${topAgent.runs} runs)\n`;
  if (topUser) digest += `Top user: <@${topUser.slack_user_id}> (${topUser.runs} runs)\n`;

  if (errorAgents.length > 0) {
    digest += '\n:warning: *High error rate agents:*\n';
    for (const a of errorAgents) {
      const total = parseInt(a.total, 10);
      const failed = parseInt(a.failed, 10);
      digest += `  - ${a.name}: ${((failed / total) * 100).toFixed(0)}% error rate (${failed}/${total})\n`;
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

export async function getRunByTraceId(workspaceId: string, traceId: string): Promise<any> {
  return queryOne('SELECT * FROM run_history WHERE trace_id = $1 AND workspace_id = $2', [traceId, workspaceId]);
}
