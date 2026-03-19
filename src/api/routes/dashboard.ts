import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { getMetrics } from '../../modules/dashboard';
import { listAgents } from '../../modules/agents';
import { getRecentRuns } from '../../modules/execution';
import { getAuditLog } from '../../modules/audit';
import { query } from '../../db';
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

    res.json(rows.map((r: any) => ({
      userId: r.slack_user_id,
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

    res.json(rows.map((r: any) => ({
      userId: r.created_by,
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
    const runs = await getRecentRuns(workspaceId, limit);
    res.json(runs);
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
    res.json(entries);
  } catch (err: any) {
    logger.error('Dashboard recent-activity error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

export default router;
