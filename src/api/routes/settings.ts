import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { getAllSettings, setSetting } from '../../modules/workspace-settings';
import { logger } from '../../utils/logger';

const router = Router();

// GET /settings — Get all workspace settings (admin-only)
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const settings = await getAllSettings(workspaceId);
    // Convert to key-value map for easier consumption
    const map: Record<string, string> = {};
    for (const s of settings) {
      map[s.key] = s.value;
    }
    res.json(map);
  } catch (err: any) {
    logger.error('Get settings error', { error: err.message });
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// PUT /settings/:key — Set a workspace setting (admin-only)
router.put('/:key', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const key = req.params.key as string;
    const { value } = req.body;
    if (value === undefined) {
      res.status(400).json({ error: 'value is required' });
      return;
    }
    await setSetting(workspaceId, key, value, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Set setting error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

export default router;
