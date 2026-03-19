import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { getMetrics } from '../../modules/dashboard';
import { listAgents } from '../../modules/agents';
// getRecentRuns replaced by direct JOIN query for agent names
// import { getRecentRuns } from '../../modules/execution';
import { getAuditLog } from '../../modules/audit';
import { query } from '../../db';
import { resolveUserNames } from '../helpers/user-resolver';
import { logger } from '../../utils/logger';

const router = Router();

// GET /dashboard/metrics?days=30
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const days = parseInt(req.query.days as string) || 30;
    const metrics = await getMetrics(workspaceId, days);
    res.json(metrics);
  } catch (err: any) {
    logger.error('Dashboard metrics error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// GET /dashboard/power-users?days=30&limit=5
router.get('/power-users', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const days = parseInt(req.query.days as string) || 30;
    const limit = parseInt(req.query.limit as string) || 5;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const rows = await query<any>(`
      SELECT r.slack_user_id, COUNT(*) as run_count,
        array_agg(DISTINCT a.name) as agent_names
      FROM run_history r
      JOIN agents a ON r.agent_id = a.id
      WHERE r.slack_user_id IS NOT NULL AND r.created_at >= $1 AND r.workspace_id = $2
      GROUP BY r.slack_user_id
      ORDER BY run_count DESC
      LIMIT $3
    `, [since, workspaceId, limit]);

    const userIds = rows.map((r: any) => r.slack_user_id);
    const names = await resolveUserNames(userIds);

    res.json(rows.map((r: any) => ({
      userId: r.slack_user_id,
      displayName: names[r.slack_user_id] || r.slack_user_id,
      runCount: parseInt(r.run_count, 10),
      agentNames: r.agent_names || [],
    })));
  } catch (err: any) {
    logger.error('Dashboard power-users error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch power users' });
  }
});

// GET /dashboard/agent-creators?limit=5
router.get('/agent-creators', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const limit = parseInt(req.query.limit as string) || 5;

    const rows = await query<any>(`
      SELECT created_by, COUNT(*) as agent_count,
        array_agg(name ORDER BY created_at DESC) as agent_names
      FROM agents
      WHERE status != 'archived' AND workspace_id = $1
      GROUP BY created_by
      ORDER BY agent_count DESC
      LIMIT $2
    `, [workspaceId, limit]);

    const userIds = rows.map((r: any) => r.created_by);
    const names = await resolveUserNames(userIds);

    res.json(rows.map((r: any) => ({
      userId: r.created_by,
      displayName: names[r.created_by] || r.created_by,
      agentCount: parseInt(r.agent_count, 10),
      agentNames: r.agent_names || [],
    })));
  } catch (err: any) {
    logger.error('Dashboard agent-creators error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch agent creators' });
  }
});

// GET /dashboard/popular-agents?days=30&limit=5
router.get('/popular-agents', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const days = parseInt(req.query.days as string) || 30;
    const limit = parseInt(req.query.limit as string) || 5;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const rows = await query<any>(`
      SELECT r.agent_id, a.name, a.avatar_emoji, COUNT(*) as run_count,
        COALESCE(SUM(r.estimated_cost_usd), 0) as total_cost
      FROM run_history r
      JOIN agents a ON r.agent_id = a.id
      WHERE r.created_at >= $1 AND r.workspace_id = $2
      GROUP BY r.agent_id, a.name, a.avatar_emoji
      ORDER BY run_count DESC
      LIMIT $3
    `, [since, workspaceId, limit]);

    res.json(rows.map((r: any) => ({
      agentId: r.agent_id,
      name: r.name,
      avatarEmoji: r.avatar_emoji,
      runCount: parseInt(r.run_count, 10),
      totalCost: parseFloat(r.total_cost),
    })));
  } catch (err: any) {
    logger.error('Dashboard popular-agents error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch popular agents' });
  }
});

// GET /dashboard/fleet
router.get('/fleet', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const agents = await listAgents(workspaceId);
    res.json(agents);
  } catch (err: any) {
    logger.error('Dashboard fleet error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch agent fleet' });
  }
});

// GET /dashboard/recent-runs?limit=10
router.get('/recent-runs', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const limit = parseInt(req.query.limit as string) || 10;

    const runs = await query(`
      SELECT r.*, a.name as agent_name, a.avatar_emoji as agent_avatar
      FROM run_history r
      LEFT JOIN agents a ON r.agent_id = a.id
      WHERE r.workspace_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2
    `, [workspaceId, limit]);

    const userIds = (runs as any[]).map((r: any) => r.slack_user_id).filter(Boolean);
    const names = await resolveUserNames(userIds);

    res.json((runs as any[]).map((r: any) => ({
      id: r.id,
      traceId: r.trace_id,
      agentName: r.agent_name || 'Unknown',
      agentAvatar: r.agent_avatar || '',
      userId: r.slack_user_id,
      displayName: names[r.slack_user_id] || r.slack_user_id || '',
      status: r.status,
      model: r.model,
      cost: parseFloat(r.estimated_cost_usd) || 0,
      durationMs: r.duration_ms || 0,
      error: r.status === 'error' ? (r.output || 'Error') : null,
      errorMessage: r.status === 'error' ? r.output : null,
      createdAt: r.created_at,
    })));
  } catch (err: any) {
    logger.error('Dashboard recent-runs error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch recent runs' });
  }
});

// GET /dashboard/recent-activity?limit=10
router.get('/recent-activity', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const limit = parseInt(req.query.limit as string) || 10;
    const entries = await getAuditLog(workspaceId, { limit });

    const userIds = (entries as any[]).map((e: any) => e.actor_user_id).filter(Boolean);
    const names = await resolveUserNames(userIds);

    res.json((entries as any[]).map((e: any) => ({
      id: e.id,
      action: e.action || e.action_type || '',
      userId: e.actor_user_id,
      displayName: names[e.actor_user_id] || e.actor_user_id || 'system',
      details: e.details || (e.metadata ? JSON.stringify(e.metadata).slice(0, 200) : ''),
      createdAt: e.created_at,
    })));
  } catch (err: any) {
    logger.error('Dashboard recent-activity error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

export default router;
