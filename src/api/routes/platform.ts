import { Router, Request, Response } from 'express';
import { query } from '../../db';
import { getSessionUser } from '../middleware/auth';
import { isPlatformAdmin } from '../../modules/users';
import { hasAnthropicApiKey } from '../../modules/anthropic';
import { logger } from '../../utils/logger';

const router = Router();

async function requirePlatformAdmin(req: Request, res: Response): Promise<boolean> {
  const session = (req as any).session;
  if (!session?.user) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  const dbUserId = session.user.dbUserId as string | undefined;
  const isAdmin = dbUserId ? await isPlatformAdmin(dbUserId) : false;
  if (!isAdmin) {
    res.status(403).json({ error: 'Platform admin access required' });
    return false;
  }
  (req as any).sessionUser = session.user;
  return true;
}

interface WorkspaceHealth {
  workspace_id: string;
  team_name: string;
  workspace_slug: string;
  status: string;
  installed_at: string;
  runs_24h: number;
  error_rate_24h: number;
  anthropic_key_configured: boolean;
}

// GET /platform/workspaces — Per-workspace health aggregates. No per-run data,
// no cross-tenant content; just counts.
router.get('/workspaces', async (req: Request, res: Response) => {
  if (!(await requirePlatformAdmin(req, res))) return;

  try {
    const workspaces = await query<{
      id: string;
      team_name: string;
      workspace_slug: string;
      status: string;
      installed_at: string;
    }>(
      `SELECT id, team_name, workspace_slug, status, installed_at
       FROM workspaces
       ORDER BY installed_at DESC`,
    );

    const out: WorkspaceHealth[] = [];
    for (const ws of workspaces) {
      const runs = await (await import('../../db')).queryOne<{ total: string; errors: string }>(
        `SELECT
           COUNT(*)::text AS total,
           SUM(CASE WHEN status IN ('failed', 'timeout') THEN 1 ELSE 0 END)::text AS errors
         FROM run_history
         WHERE workspace_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [ws.id],
      );
      const total = parseInt(runs?.total || '0', 10);
      const errors = parseInt(runs?.errors || '0', 10);
      out.push({
        workspace_id: ws.id,
        team_name: ws.team_name,
        workspace_slug: ws.workspace_slug,
        status: ws.status,
        installed_at: ws.installed_at,
        runs_24h: total,
        error_rate_24h: total > 0 ? errors / total : 0,
        anthropic_key_configured: await hasAnthropicApiKey(ws.id),
      });
    }
    res.json({ workspaces: out });
  } catch (err: any) {
    logger.error('Platform workspaces list error', { error: err.message });
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

export default router;
