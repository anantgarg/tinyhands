import { Router, Request, Response } from 'express';
import { config } from '../../config';
import { getPlatformRole } from '../../modules/access-control';
import { upsertUser, listUserWorkspaces, setActiveWorkspace, isWorkspaceMember, isPlatformAdmin, setMembership, getMembership } from '../../modules/users';
import { logger } from '../../utils/logger';

const router = Router();

// Bot scopes required by the TinyHands Slack app. Listed in CLAUDE.md; must
// match the Slack app manifest. Kept here so both the install and sign-in
// flows reference the same list.
// Note: `commands` scope was removed in v1.48.0 — slash commands are deprecated;
// all workflows are in the web dashboard. Remove the Slash Commands section
// from the Slack app config when you next rotate the app.
const SLACK_BOT_SCOPES = [
  'app_mentions:read', 'channels:history', 'channels:join', 'channels:manage', 'channels:read',
  'chat:write', 'chat:write.customize', 'files:read',
  'groups:history', 'groups:read', 'groups:write',
  'im:history', 'im:read', 'im:write', 'users:read',
].join(',');

// GET /auth/slack — Redirect to Slack OAuth for sign-in (user-scope only)
router.get('/slack', (_req: Request, res: Response) => {
  const clientId = config.slack.clientId;
  if (!clientId) {
    logger.error('SLACK_CLIENT_ID not configured');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
    return;
  }

  const redirectUri = `${config.oauth.redirectBaseUrl}/api/v1/auth/slack/callback`;
  const scopes = 'identity.basic,identity.email,identity.avatar,identity.team';
  const url = `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}&user_scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(url);
});

// GET /auth/slack/install — "Add to Slack" flow. Requests bot scopes so a new
// Slack workspace can host the TinyHands bot. On successful callback we
// create (or reactivate) the workspace row with the new bot token.
router.get('/slack/install', (_req: Request, res: Response) => {
  const clientId = config.slack.clientId;
  if (!clientId) {
    res.status(500).send('Slack OAuth is not configured on this deployment.');
    return;
  }
  const redirectUri = `${config.oauth.redirectBaseUrl}/api/v1/auth/slack/install/callback`;
  const url = `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(SLACK_BOT_SCOPES)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(url);
});

router.get('/slack/install/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code) {
    res.status(400).send('Missing code parameter');
    return;
  }
  try {
    const { upsertWorkspace } = await import('../../db');
    const redirectUri = `${config.oauth.redirectBaseUrl}/api/v1/auth/slack/install/callback`;
    const tokenResp = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.slack.clientId,
        client_secret: config.slack.clientSecret,
        code: code as string,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenResp.json() as any;
    if (!tokenData.ok) {
      logger.error('Slack install token exchange failed', { error: tokenData.error });
      res.status(400).send('Install failed. Please try again.');
      return;
    }
    const teamId = tokenData.team?.id;
    const teamName = tokenData.team?.name || 'Unknown workspace';
    const botToken = tokenData.access_token;
    const botUserId = tokenData.bot_user_id;
    const botId = tokenData.bot_id;
    const appId = tokenData.app_id;
    const authedUserId = tokenData.authed_user?.id;
    const scope = tokenData.scope;

    if (!teamId || !botToken || !botUserId) {
      res.status(400).send('Install response missing required fields.');
      return;
    }

    // Generate a URL-safe slug from the team name (lowercase, dashes)
    const slug = teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || teamId.toLowerCase();

    const ws = await upsertWorkspace({
      id: teamId,
      team_name: teamName,
      bot_token: botToken,
      bot_user_id: botUserId,
      bot_id: botId,
      app_id: appId,
      authed_user_id: authedUserId,
      scope,
      status: 'active',
    });

    // Ensure workspace_slug is populated. Collisions get a short id suffix.
    try {
      const { execute, queryOne } = await import('../../db');
      let candidate = slug;
      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM workspaces WHERE workspace_slug = $1 AND id <> $2',
        [candidate, teamId],
      );
      if (existing) candidate = `${candidate}-${teamId.slice(0, 6).toLowerCase()}`;
      await execute('UPDATE workspaces SET workspace_slug = $1 WHERE id = $2', [candidate, teamId]);
    } catch (err: any) {
      logger.warn('Failed to set workspace slug', { teamId, error: err.message });
    }

    // First user to install becomes a workspace admin (and platform_admin on
    // single-tenant self-hosted deployments, tracked separately).
    if (authedUserId) {
      const { upsertUser, setMembership } = await import('../../modules/users');
      const user = await upsertUser({ slackUserId: authedUserId, homeWorkspaceId: teamId });
      await setMembership(teamId, user.id, 'admin');
    }

    logger.info('Slack workspace installed', { workspaceId: teamId, teamName });
    res.status(200).send(`
      <html><body style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h2>TinyHands installed in ${teamName}!</h2>
        <p>The bot is ready to go. Sign in to the dashboard to finish setup (including your Claude API key).</p>
        <p><a href="/api/v1/auth/slack">Sign in to TinyHands →</a></p>
      </body></html>
    `);
    return;
  } catch (err: any) {
    logger.error('Slack install callback failed', { error: err.message });
    res.status(500).send('Install failed. Please try again.');
  }
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
      res.status(400).json({ error: 'Authentication failed. Please try again.' });
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
      res.status(400).json({ error: 'Authentication failed. Please try again.' });
      return;
    }

    const slackUserId = identityData.user?.id;
    const displayName = identityData.user?.name || 'Unknown';
    const email = identityData.user?.email || undefined;
    const avatarUrl = identityData.user?.image_72 || '';
    const workspaceId = identityData.team?.id;

    if (!slackUserId || !workspaceId) {
      res.status(400).json({ error: 'Could not determine user or workspace' });
      return;
    }

    // Upsert the user in our users table. Users who sign in from multiple Slack
    // workspaces end up with one user row per (slack_user_id, home_workspace_id).
    const dbUser = await upsertUser({
      slackUserId,
      homeWorkspaceId: workspaceId,
      displayName,
      email,
      avatarUrl,
    });

    // Ensure the user has a workspace membership for their home workspace.
    // Ordering matters because workspaces can reach this path without an
    // install-callback admin being set (e.g. Slack returned no authed_user.id,
    // or the workspace pre-existed the multi-tenant migration):
    //   1. existing membership → leave alone
    //   2. legacy platform_roles row for this (workspace, slack_user) → mirror
    //   3. workspace has no admin yet → make this user admin (bootstrap)
    //   4. fall back to member
    const existing = await getMembership(workspaceId, dbUser.id);
    if (!existing) {
      const { queryOne: queryOneDb } = await import('../../db');
      const legacy = await queryOneDb<{ role: string }>(
        'SELECT role FROM platform_roles WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, slackUserId],
      );
      let membershipRole: 'admin' | 'member';
      if (legacy) {
        membershipRole = legacy.role === 'member' ? 'member' : 'admin';
      } else {
        const anyAdmin = await queryOneDb<{ exists: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND role = 'admin') AS exists",
          [workspaceId],
        );
        membershipRole = anyAdmin?.exists ? 'member' : 'admin';
      }
      await setMembership(workspaceId, dbUser.id, membershipRole);
    }

    const platformRole = await getPlatformRole(workspaceId, slackUserId);
    const platformAdmin = await isPlatformAdmin(dbUser.id);

    // Pick the active workspace: prefer the user's previously-saved selection
    // if they're still a member, else default to the workspace they just
    // signed in from.
    let activeWorkspaceId = workspaceId;
    if (dbUser.active_workspace_id) {
      const stillMember = await isWorkspaceMember(dbUser.active_workspace_id, dbUser.id);
      if (stillMember) activeWorkspaceId = dbUser.active_workspace_id;
    }
    if (activeWorkspaceId !== dbUser.active_workspace_id) {
      await setActiveWorkspace(dbUser.id, activeWorkspaceId);
    }

    const activeMembership = await getMembership(activeWorkspaceId, dbUser.id);
    const workspaceRole = activeMembership?.role ?? 'member';

    const session = (req as any).session;
    session.user = {
      userId: slackUserId,             // kept for backward compat with existing middleware
      dbUserId: dbUser.id,
      slackUserId,
      workspaceId: activeWorkspaceId,
      homeWorkspaceId: workspaceId,
      displayName,
      avatarUrl,
      platformRole,
      platformAdmin,
      workspaceRole,
    };

    // Explicitly save session before redirect to avoid race condition
    session.save((err: any) => {
      if (err) {
        logger.error('Session save error', { error: err.message });
        res.status(500).json({ error: 'Failed to create session' });
        return;
      }
      res.redirect('/');
    });
  } catch (err: any) {
    logger.error('Slack OAuth callback error', { error: err.message });
    res.status(500).json({ error: 'Something went wrong. Please try again in a moment.' });
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

// GET /auth/workspaces — List workspaces the current user belongs to
router.get('/workspaces', async (req: Request, res: Response) => {
  const session = (req as any).session;
  if (!session?.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const dbUserId = session.user.dbUserId as string | undefined;
  if (!dbUserId) {
    res.status(400).json({ error: 'Session missing dbUserId — sign in again' });
    return;
  }
  const workspaces = await listUserWorkspaces(dbUserId);
  res.json({ workspaces, activeWorkspaceId: session.user.workspaceId });
});

// POST /auth/switch-workspace — Change the session's active workspace
router.post('/switch-workspace', async (req: Request, res: Response) => {
  const session = (req as any).session;
  if (!session?.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const { workspaceId } = req.body || {};
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }
  const dbUserId = session.user.dbUserId as string;
  if (!(await isWorkspaceMember(workspaceId, dbUserId))) {
    res.status(403).json({ error: 'You are not a member of that workspace' });
    return;
  }
  await setActiveWorkspace(dbUserId, workspaceId);
  const platformRole = await getPlatformRole(workspaceId, session.user.slackUserId);
  session.user.workspaceId = workspaceId;
  session.user.platformRole = platformRole;
  session.save((err: any) => {
    if (err) {
      logger.error('Session save failed during workspace switch', { error: err.message });
      res.status(500).json({ error: 'Failed to save session' });
      return;
    }
    res.json({ ok: true, activeWorkspaceId: workspaceId });
  });
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
