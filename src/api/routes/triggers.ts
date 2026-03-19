import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import {
  createTrigger, getTrigger,
  pauseTrigger, resumeTrigger, deleteTrigger,
} from '../../modules/triggers';
import { query } from '../../db';
import { logger } from '../../utils/logger';

const router = Router();

// GET /triggers — List all triggers with agent info, optionally by type
router.get('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const type = req.query.type as string | undefined;

    let sql = `
      SELECT t.*, a.name as agent_name, a.avatar_emoji as agent_avatar
      FROM triggers t
      LEFT JOIN agents a ON t.agent_id = a.id
      WHERE t.workspace_id = $1
    `;
    const params: any[] = [workspaceId];

    if (type) {
      sql += ' AND t.trigger_type = $2';
      params.push(type);
    }
    sql += ' ORDER BY t.created_at DESC';

    const rows = await query(sql, params);

    res.json((rows as any[]).map((t: any) => ({
      id: t.id,
      agentId: t.agent_id,
      agentName: t.agent_name || 'Unknown',
      agentAvatar: t.agent_avatar || '',
      type: t.trigger_type,
      config: typeof t.config_json === 'string' ? JSON.parse(t.config_json || '{}') : (t.config_json || {}),
      enabled: t.status === 'active',
      lastTriggeredAt: t.last_triggered_at || t.last_fired_at || null,
      createdAt: t.created_at,
    })));
  } catch (err: any) {
    logger.error('List triggers error', { error: err.message });
    res.status(500).json({ error: 'Failed to list triggers' });
  }
});

// GET /triggers/:id — Get trigger
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const trigger = await getTrigger(workspaceId, id);
    if (!trigger) {
      res.status(404).json({ error: 'Trigger not found' });
      return;
    }
    res.json(trigger);
  } catch (err: any) {
    logger.error('Get trigger error', { error: err.message });
    res.status(500).json({ error: 'Failed to get trigger' });
  }
});

// POST /triggers — Create trigger
router.post('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { agentId, triggerType, type, config } = req.body;
    const resolvedType = triggerType || type;
    if (!agentId || !resolvedType) {
      res.status(400).json({ error: 'agentId and triggerType are required' });
      return;
    }
    const trigger = await createTrigger(workspaceId, {
      agentId,
      triggerType: resolvedType,
      config: config || {},
      createdBy: userId,
    });
    res.status(201).json(trigger);
  } catch (err: any) {
    logger.error('Create trigger error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// PATCH /triggers/:id — Update trigger (enable/disable)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const { enabled } = req.body;

    if (enabled === true) {
      await resumeTrigger(workspaceId, id, userId);
    } else if (enabled === false) {
      await pauseTrigger(workspaceId, id, userId);
    }

    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Update trigger error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /triggers/:id/pause — Pause trigger
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    await pauseTrigger(workspaceId, id, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Pause trigger error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /triggers/:id/resume — Resume trigger
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    await resumeTrigger(workspaceId, id, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Resume trigger error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// DELETE /triggers/:id — Delete trigger
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    await deleteTrigger(workspaceId, id, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete trigger error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

export default router;
