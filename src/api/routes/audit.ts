import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { getAuditLog } from '../../modules/audit';
import { resolveUserNames } from '../helpers/user-resolver';
import { query as dbQuery } from '../../db';
import { logger } from '../../utils/logger';

const router = Router();

// GET /audit — Get audit log with optional filters (admin-only)
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const options: {
      agentId?: string;
      userId?: string;
      actionType?: string;
      limit?: number;
      offset?: number;
    } = {};

    if (req.query.agentId) options.agentId = req.query.agentId as string;
    if (req.query.userId) options.userId = req.query.userId as string;
    if (req.query.actionType) options.actionType = req.query.actionType as string;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    options.limit = limit;
    options.offset = (page - 1) * limit;

    const entries = await getAuditLog(workspaceId, options);

    // Get total count for pagination
    let total = entries.length;
    try {
      const countConditions = ['workspace_id = $1'];
      const countParams: any[] = [workspaceId];
      let ci = 2;
      if (options.agentId) { countConditions.push(`agent_id = $${ci++}`); countParams.push(options.agentId); }
      if (options.userId) { countConditions.push(`actor_user_id = $${ci++}`); countParams.push(options.userId); }
      if (options.actionType) { countConditions.push(`action_type = $${ci++}`); countParams.push(options.actionType); }
      const [countRow] = await dbQuery(`SELECT count(*)::int as count FROM action_audit_log WHERE ${countConditions.join(' AND ')}`, countParams);
      total = countRow?.count ?? entries.length;
    } catch { /* best-effort count */ }

    // Resolve user display names (best-effort)
    let enriched = entries;
    try {
      const userIds = (entries as any[]).map((e: any) => e.actor_user_id).filter(Boolean);
      if (userIds.length > 0) {
        const names = await resolveUserNames(userIds);
        enriched = (entries as any[]).map((e: any) => ({
          ...e,
          actorDisplayName: names[e.actor_user_id] || e.actor_user_id,
        }));
      }
    } catch { /* best-effort */ }

    res.json({ entries: enriched, total });
  } catch (err: any) {
    logger.error('Get audit log error', { error: err.message });
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

export default router;
