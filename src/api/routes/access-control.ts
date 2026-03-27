import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  listPlatformAdmins, setPlatformRole, removePlatformRole,
  getPlatformRole,
} from '../../modules/access-control';
import { resolveUserNames } from '../helpers/user-resolver';
import { logger } from '../../utils/logger';

const router = Router();

// GET /access/platform-roles — List platform admins (admin-only)
router.get('/platform-roles', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const admins = await listPlatformAdmins(workspaceId);
    const userIds = (admins as any[]).map((a: any) => a.user_id).concat((admins as any[]).map((a: any) => a.granted_by)).filter(Boolean);
    const names = await resolveUserNames(userIds);
    res.json((admins as any[]).map((a: any) => ({
      ...a,
      displayName: names[a.user_id] || a.user_id,
      grantedByName: names[a.granted_by] || a.granted_by,
    })));
  } catch (err: any) {
    logger.error('List platform admins error', { error: err.message });
    res.status(500).json({ error: 'Failed to list platform admins' });
  }
});

// GET /access/platform-roles/:userId — Get platform role for a user
router.get('/platform-roles/:userId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const targetUserId = req.params.userId as string;
    const role = await getPlatformRole(workspaceId, targetUserId);
    res.json({ userId: targetUserId, role });
  } catch (err: any) {
    logger.error('Get platform role error', { error: err.message });
    res.status(500).json({ error: 'Failed to get platform role' });
  }
});

// PUT /access/platform-roles/:userId — Set platform role (admin-only)
router.put('/platform-roles/:userId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const targetUserId = req.params.userId as string;
    const { role } = req.body;
    if (!role) {
      res.status(400).json({ error: 'role is required' });
      return;
    }
    await setPlatformRole(workspaceId, targetUserId, role, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Set platform role error', { error: err.message });
    res.status(400).json({ error: "Couldn't update the role. Please try again." });
  }
});

// DELETE /access/platform-roles/:userId — Remove platform role (admin-only)
router.delete('/platform-roles/:userId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const targetUserId = req.params.userId as string;
    await removePlatformRole(workspaceId, targetUserId, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Remove platform role error', { error: err.message });
    res.status(400).json({ error: "Couldn't remove the role. Please try again." });
  }
});

export default router;
