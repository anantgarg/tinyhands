import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  listWhatsAppChannels,
  getWhatsAppChannel,
  createWhatsAppChannel,
  updateWhatsAppChannel,
  deleteWhatsAppChannel,
  listAllowedNumbers,
  replaceAllowedNumbers,
} from '../../modules/whatsapp';
import { queryOne } from '../../db';
import { logger } from '../../utils/logger';
import type { WhatsAppChannel } from '../../types';

const router = Router();

// Shape a channel for the dashboard. The Twilio auth token is NEVER returned —
// only a boolean that it is configured. The Account SID is masked to its tail.
async function shape(channel: WhatsAppChannel): Promise<Record<string, unknown>> {
  const agent = await queryOne<{ name: string; model: string }>(
    'SELECT name, model FROM agents WHERE id = $1',
    [channel.agent_id],
  );
  const allowed = await listAllowedNumbers(channel.id);
  const sid = channel.twilio_account_sid || '';
  return {
    id: channel.id,
    name: channel.name,
    agentId: channel.agent_id,
    agentName: agent?.name ?? 'Unknown',
    agentModel: agent?.model ?? '',
    accountSidMasked: sid ? `••••${sid.slice(-4)}` : '',
    authTokenConfigured: !!channel.twilio_auth_token_encrypted,
    whatsappNumber: channel.whatsapp_number,
    allowedNumbers: allowed.map((a) => ({ id: a.id, number: a.phone_number, label: a.label })),
    allowedCount: allowed.length,
    enabled: channel.enabled,
    createdAt: channel.created_at,
  };
}

// Normalise an inbound allowedNumbers payload into the module's shape.
function readAllowedNumbers(raw: unknown): Array<{ number: string; label?: string | null }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return { number: entry };
      if (entry && typeof entry === 'object') {
        return { number: String((entry as any).number ?? ''), label: (entry as any).label ?? null };
      }
      return { number: '' };
    })
    .filter((e) => e.number.trim() !== '');
}

// GET /whatsapp/channels — list all WhatsApp channels in the workspace
router.get('/channels', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const channels = await listWhatsAppChannels(workspaceId);
    res.json(await Promise.all(channels.map(shape)));
  } catch (err: any) {
    logger.error('List WhatsApp channels error', { error: err.message });
    res.status(500).json({ error: 'Failed to list WhatsApp channels' });
  }
});

// GET /whatsapp/channels/:id/numbers — list a channel's allowed phone numbers
router.get('/channels/:id/numbers', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const channel = await getWhatsAppChannel(workspaceId, id);
    if (!channel) {
      res.status(404).json({ error: 'WhatsApp channel not found' });
      return;
    }
    const allowed = await listAllowedNumbers(id);
    res.json(allowed.map((a) => ({ id: a.id, number: a.phone_number, label: a.label })));
  } catch (err: any) {
    logger.error('List WhatsApp numbers error', { error: err.message });
    res.status(500).json({ error: 'Failed to list allowed numbers' });
  }
});

// POST /whatsapp/channels — create a WhatsApp channel
router.post('/channels', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { name, agentId, accountSid, authToken, whatsappNumber } = req.body ?? {};
    if (!name || !agentId || !accountSid || !authToken || !whatsappNumber) {
      res.status(400).json({
        error: 'Name, agent, Twilio Account SID, auth token and WhatsApp number are all required',
      });
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
    const channel = await createWhatsAppChannel(workspaceId, {
      name,
      agentId,
      accountSid,
      authToken,
      whatsappNumber,
      allowedNumbers: readAllowedNumbers(req.body?.allowedNumbers),
      createdBy: userId,
    });
    res.status(201).json(await shape(channel));
  } catch (err: any) {
    logger.error('Create WhatsApp channel error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to create WhatsApp channel' });
  }
});

// PATCH /whatsapp/channels/:id — update a WhatsApp channel (and its allowlist)
router.patch('/channels/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const existing = await getWhatsAppChannel(workspaceId, id);
    if (!existing) {
      res.status(404).json({ error: 'WhatsApp channel not found' });
      return;
    }
    const { name, agentId, accountSid, authToken, whatsappNumber, enabled } = req.body ?? {};
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
    const updated = await updateWhatsAppChannel(workspaceId, id, {
      name,
      agentId,
      accountSid,
      authToken,
      whatsappNumber,
      enabled,
    });
    if (!updated) {
      res.status(404).json({ error: 'WhatsApp channel not found' });
      return;
    }
    if (req.body?.allowedNumbers !== undefined) {
      await replaceAllowedNumbers(id, readAllowedNumbers(req.body.allowedNumbers));
    }
    res.json(await shape(updated));
  } catch (err: any) {
    logger.error('Update WhatsApp channel error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to update WhatsApp channel' });
  }
});

// DELETE /whatsapp/channels/:id — delete a WhatsApp channel
router.delete('/channels/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const existing = await getWhatsAppChannel(workspaceId, id);
    if (!existing) {
      res.status(404).json({ error: 'WhatsApp channel not found' });
      return;
    }
    await deleteWhatsAppChannel(workspaceId, id);
    res.status(204).end();
  } catch (err: any) {
    logger.error('Delete WhatsApp channel error', { error: err.message });
    res.status(500).json({ error: 'Failed to delete WhatsApp channel' });
  }
});

export default router;
