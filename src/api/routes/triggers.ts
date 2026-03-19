import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import {
  createTrigger, getTrigger, getActiveTriggersByType,
  pauseTrigger, resumeTrigger, deleteTrigger,
} from '../../modules/triggers';
import { logger } from '../../utils/logger';

const router = Router();

// GET /triggers — List active triggers, optionally by type
router.get('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const type = req.query.type as string | undefined;
    if (type) {
      const triggers = await getActiveTriggersByType(workspaceId, type as any);
      res.json(triggers);
    } else {
      const types = ['slack_channel', 'linear', 'zendesk', 'intercom', 'webhook', 'schedule'] as const;
      const all = [];
      for (const t of types) {
        const triggers = await getActiveTriggersByType(workspaceId, t);
        all.push(...triggers);
      }
      res.json(all);
    }
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
    const { agentId, triggerType, config } = req.body;
    if (!agentId || !triggerType) {
      res.status(400).json({ error: 'agentId and triggerType are required' });
      return;
    }
    const trigger = await createTrigger(workspaceId, {
      agentId,
      triggerType,
      config: config || {},
      createdBy: userId,
    });
    res.status(201).json(trigger);
  } catch (err: any) {
    logger.error('Create trigger error', { error: err.message });
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
