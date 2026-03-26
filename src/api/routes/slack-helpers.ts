import { Router, Response } from 'express';
import { getSlackApp } from '../../slack';
import { logger } from '../../utils/logger';

const router = Router();

// GET /slack/channels — List Slack channels
router.get('/channels', async (req, res: Response) => {
  try {
    const client = getSlackApp().client;
    const limit = parseInt(req.query.limit as string) || 200;
    const cursor = req.query.cursor as string | undefined;
    const types = (req.query.types as string) || 'public_channel,private_channel';

    const result = await client.conversations.list({
      limit,
      cursor,
      types,
      exclude_archived: true,
    });

    res.json({
      channels: (result.channels || []).map(c => ({
        id: c.id,
        name: c.name,
        isPrivate: c.is_private,
        isMember: c.is_member,
        numMembers: c.num_members,
        topic: (c as any).topic?.value || '',
        purpose: (c as any).purpose?.value || '',
      })),
      nextCursor: result.response_metadata?.next_cursor || null,
    });
  } catch (err: any) {
    logger.error('List Slack channels error', { error: err.message });
    res.status(500).json({ error: 'Failed to list channels' });
  }
});

// GET /slack/users — List all Slack users (auto-paginates)
router.get('/users', async (req, res: Response) => {
  try {
    const client = getSlackApp().client;
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
