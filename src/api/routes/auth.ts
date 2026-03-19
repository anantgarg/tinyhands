import { Router, Request, Response } from 'express';
import { config } from '../../config';
import { getPlatformRole } from '../../modules/access-control';
import { logger } from '../../utils/logger';

const router = Router();

// GET /auth/slack — Redirect to Slack OAuth
router.get('/slack', (_req: Request, res: Response) => {
  const clientId = config.slack.clientId;
  if (!clientId) {
    res.status(500).json({ error: 'SLACK_CLIENT_ID not configured' });
    return;
  }

  const redirectUri = `${config.oauth.redirectBaseUrl}/api/v1/auth/slack/callback`;
  const scopes = 'identity.basic,identity.email,identity.avatar,identity.team';
  const url = `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}&user_scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(url);
});

// GET /auth/slack/callback — Exchange code for token, create session
router.get('/slack/callback', async (req: Request, res: Response) => {
  const { code } = req.query;

  if (!code) {
    res.status(400).json({ error: 'Missing code parameter' });
    return;
  }

  try {
    const clientId = config.slack.clientId;
    const clientSecret = config.slack.clientSecret;
    const redirectUri = `${config.oauth.redirectBaseUrl}/api/v1/auth/slack/callback`;

    // Exchange code for access token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code as string,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json() as any;
    if (!tokenData.ok) {
      logger.error('Slack OAuth token exchange failed', { error: tokenData.error });
      res.status(400).json({ error: `Slack OAuth failed: ${tokenData.error}` });
      return;
    }

    const userAccessToken = tokenData.authed_user?.access_token;
    if (!userAccessToken) {
      res.status(400).json({ error: 'No user access token returned' });
      return;
    }

    // Fetch user identity
    const identityResponse = await fetch('https://slack.com/api/users.identity', {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });

    const identityData = await identityResponse.json() as any;
    if (!identityData.ok) {
      logger.error('Slack identity fetch failed', { error: identityData.error });
      res.status(400).json({ error: `Failed to fetch user identity: ${identityData.error}` });
      return;
    }

    const userId = identityData.user?.id;
    const displayName = identityData.user?.name || 'Unknown';
    const avatarUrl = identityData.user?.image_72 || '';
    const workspaceId = identityData.team?.id;

    if (!userId || !workspaceId) {
      res.status(400).json({ error: 'Could not determine user or workspace' });
      return;
    }

    // Get platform role
    const platformRole = await getPlatformRole(workspaceId, userId);

    // Create session
    const session = (req as any).session;
    session.user = {
      userId,
      workspaceId,
      displayName,
      avatarUrl,
      platformRole,
    };

    // Redirect to dashboard
    res.redirect('/');
  } catch (err: any) {
    logger.error('Slack OAuth callback error', { error: err.message });
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /auth/me — Return current session user
router.get('/me', (req: Request, res: Response) => {
  const session = (req as any).session;
  if (!session?.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json(session.user);
});

// POST /auth/logout — Destroy session
router.post('/logout', (req: Request, res: Response) => {
  const session = (req as any).session;
  if (session) {
    session.destroy((err: any) => {
      if (err) {
        logger.error('Session destroy error', { error: err.message });
        res.status(500).json({ error: 'Logout failed' });
        return;
      }
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

export default router;
