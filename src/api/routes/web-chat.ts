import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  listWebChats,
  getWebChat,
  createWebChat,
  updateWebChat,
  deleteWebChat,
  decryptWebChatPassword,
} from '../../modules/web-chat';
import { queryOne } from '../../db';
import { logger } from '../../utils/logger';
import type { WebChatChannel } from '../../types';

const router = Router();

async function shape(channel: WebChatChannel): Promise<Record<string, unknown>> {
  const agent = await queryOne<{ name: string; model: string }>(
    'SELECT name, model FROM agents WHERE id = $1',
    [channel.agent_id],
  );
  let password = '';
  try {
    password = decryptWebChatPassword(channel);
  } catch {
    password = '';
  }
  return {
    id: channel.id,
    name: channel.name,
    agentId: channel.agent_id,
    agentName: agent?.name ?? 'Unknown',
    agentModel: agent?.model ?? '',
    username: channel.auth_username,
    password,
    publicToken: channel.public_token,
    enabled: channel.enabled,
    createdAt: channel.created_at,
  };
}

// GET /web-chat/channels — list all web chats in the workspace
router.get('/channels', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const channels = await listWebChats(workspaceId);
    res.json(await Promise.all(channels.map(shape)));
  } catch (err: any) {
    logger.error('List web chats error', { error: err.message });
    res.status(500).json({ error: 'Failed to list web chats' });
  }
});

// POST /web-chat/channels — create a web chat
router.post('/channels', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { name, agentId, username, password } = req.body ?? {};
    if (!name || !agentId || !username || !password) {
      res.status(400).json({ error: 'Name, agent, username and password are all required' });
      return;
    }
    const agent = await queryOne('SELECT id FROM agents WHERE id = $1 AND workspace_id = $2', [
      agentId,
      workspaceId,
    ]);
    if (!agent) {
      res.status(400).json({ error: 'Unknown agent' });
      return;
    }
    const channel = await createWebChat(workspaceId, {
      name,
      agentId,
      username,
      password,
      createdBy: userId,
    });
    res.status(201).json(await shape(channel));
  } catch (err: any) {
    logger.error('Create web chat error', { error: err.message });
    res.status(500).json({ error: 'Failed to create web chat' });
  }
});

// PATCH /web-chat/channels/:id — update a web chat
router.patch('/channels/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const existing = await getWebChat(workspaceId, id);
    if (!existing) {
      res.status(404).json({ error: 'Web chat not found' });
      return;
    }
    const { name, agentId, username, password, enabled } = req.body ?? {};
    if (agentId) {
      const agent = await queryOne('SELECT id FROM agents WHERE id = $1 AND workspace_id = $2', [
        agentId,
        workspaceId,
      ]);
      if (!agent) {
        res.status(400).json({ error: 'Unknown agent' });
        return;
      }
    }
    const updated = await updateWebChat(workspaceId, id, { name, agentId, username, password, enabled });
    if (!updated) {
      res.status(404).json({ error: 'Web chat not found' });
      return;
    }
    res.json(await shape(updated));
  } catch (err: any) {
    logger.error('Update web chat error', { error: err.message });
    res.status(500).json({ error: 'Failed to update web chat' });
  }
});

// DELETE /web-chat/channels/:id — delete a web chat
router.delete('/channels/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const existing = await getWebChat(workspaceId, id);
    if (!existing) {
      res.status(404).json({ error: 'Web chat not found' });
      return;
    }
    await deleteWebChat(workspaceId, id);
    res.status(204).end();
  } catch (err: any) {
    logger.error('Delete web chat error', { error: err.message });
    res.status(500).json({ error: 'Failed to delete web chat' });
  }
});

export default router;
