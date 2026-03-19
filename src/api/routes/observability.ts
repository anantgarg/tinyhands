import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { getAlertRules, checkAlerts, getAgentErrorRates } from '../../modules/observability';
import { query } from '../../db';
import { resolveUserNames } from '../helpers/user-resolver';
import { logger } from '../../utils/logger';

const router = Router();

// GET /observability/alert-rules — List alert rules
router.get('/alert-rules', (_req: Request, res: Response) => {
  try {
    const rules = getAlertRules();
    res.json(rules);
  } catch (err: any) {
    logger.error('List alert rules error', { error: err.message });
    res.status(500).json({ error: 'Failed to list alert rules' });
  }
});

// GET /observability/alerts — Check current alerts
router.get('/alerts', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const alerts = await checkAlerts(workspaceId);
    res.json(alerts);
  } catch (err: any) {
    logger.error('Check alerts error', { error: err.message });
    res.status(500).json({ error: 'Failed to check alerts' });
  }
});

// GET /observability/error-rates — Get per-agent error rates
router.get('/error-rates', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const rates = await getAgentErrorRates(workspaceId);
    res.json(rates);
  } catch (err: any) {
    logger.error('Get error rates error', { error: err.message });
    res.status(500).json({ error: 'Failed to get error rates' });
  }
});

// GET /observability/error-log?days=7&agentId=...&limit=50
router.get('/error-log', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const days = parseInt(req.query.days as string) || 7;
    const agentId = req.query.agentId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let sql = `
      SELECT r.*, a.name as agent_name, a.avatar_emoji
      FROM run_history r
      JOIN agents a ON r.agent_id = a.id
      WHERE r.status = 'failed' AND r.created_at >= $1 AND r.workspace_id = $2
    `;
    const params: any[] = [since, workspaceId];

    if (agentId) {
      sql += ` AND r.agent_id = $3`;
      params.push(agentId);
    }

    sql += ` ORDER BY r.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const rows = await query(sql, params);

    // Resolve user names
    const userIds = (rows as any[]).map((r: any) => r.slack_user_id).filter(Boolean);
    const names = await resolveUserNames(userIds);

    res.json((rows as any[]).map((r: any) => ({
      id: r.id,
      agentId: r.agent_id,
      agentName: r.agent_name || 'Unknown',
      avatarEmoji: r.avatar_emoji || '',
      traceId: r.trace_id,
      slackUserId: r.slack_user_id,
      displayName: names[r.slack_user_id] || r.slack_user_id || '',
      status: r.status,
      model: r.model,
      input: r.input,
      output: r.output,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      estimatedCostUsd: r.estimated_cost_usd,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    })));
  } catch (err: any) {
    logger.error('Get error log error', { error: err.message });
    res.status(500).json({ error: 'Failed to get error log' });
  }
});

export default router;
