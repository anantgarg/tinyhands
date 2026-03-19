import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { getAuditLog } from '../../modules/audit';
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
    res.json(entries);
  } catch (err: any) {
    logger.error('Get audit log error', { error: err.message });
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

export default router;
