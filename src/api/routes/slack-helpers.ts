import { Router, Response } from 'express';
import { getBotClient } from '../../slack';
import { getSessionUser } from '../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();

// GET /slack/channels — List ALL Slack channels (auto-paginates)
router.get('/channels', async (req, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req as any);
    const client = await getBotClient(workspaceId);
    const types = (req.query.types as string) || 'public_channel,private_channel';
    const allChannels: any[] = [];
    let cursor: string | undefined;

    // Auto-paginate to get ALL channels
    do {
      const result = await client.conversations.list({
        limit: 200,
        cursor,
        types,
        exclude_archived: true,
      });
      allChannels.push(...(result.channels || []));
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // Sort: private first (user's channels), then public, alphabetical within each
    allChannels.sort((a, b) => {
      if (a.is_private && !b.is_private) return -1;
      if (!a.is_private && b.is_private) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    res.json({
      channels: allChannels.map(c => ({
        id: c.id,
        name: c.name,
        isPrivate: c.is_private,
        isMember: c.is_member,
        numMembers: c.num_members,
        topic: (c as any).topic?.value || '',
        purpose: (c as any).purpose?.value || '',
      })),
      nextCursor: null,
    });
  } catch (err: any) {
    logger.error('List Slack channels error', { error: err.message });
    res.status(500).json({ error: 'Failed to list channels' });
  }
});

// GET /slack/users — List all Slack users (auto-paginates)
router.get('/users', async (req, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req as any);
    const client = await getBotClient(workspaceId);
    const allMembers: any[] = [];
    let cursor: string | undefined;

    // Paginate through all users — Slack returns as few as 13 per page
    do {
      const result = await client.users.list({ limit: 200, cursor });
      allMembers.push(...(result.members || []));
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    res.json({
      users: allMembers
        .filter(m => !m.is_bot && !m.deleted && m.id !== 'USLACKBOT')
        .map(m => ({
          id: m.id,
          name: m.name,
          realName: m.real_name || m.profile?.real_name || '',
          displayName: m.profile?.display_name || '',
          avatarUrl: m.profile?.image_72 || '',
          isAdmin: m.is_admin,
          isOwner: m.is_owner,
        })),
      nextCursor: null,
    });
  } catch (err: any) {
    logger.error('List Slack users error', { error: err.message });
    res.status(500).json({ error: 'Failed to list users' });
  }
});

export default router;
