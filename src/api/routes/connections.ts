import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  listTeamConnections, listPersonalConnectionsForUser,
  createTeamConnection, createPersonalConnection,
  deleteConnection,
  listAgentToolConnections, setAgentToolConnection,
  getToolAgentUsage,
} from '../../modules/connections';
import { getIntegrations } from '../../modules/tools/integrations';
import { getSupportedOAuthIntegrations, OAuthAppNotConfiguredError, getProviderForIntegration } from '../../modules/connections/oauth';
import {
  hasOAuthAppConfigured,
  getOAuthAppSummary,
  setOAuthAppCredentials,
  clearOAuthAppCredentials,
  testOAuthAppCredentials,
  SUPPORTED_PROVIDERS,
} from '../../modules/workspace-oauth-apps';
import type { OAuthAppProvider, OAuthAppPublishingStatus } from '../../types';
import { resolveUserNames } from '../helpers/user-resolver';
import { query, execute } from '../../db';
import { logger } from '../../utils/logger';
import { config } from '../../config';

const router = Router();

/**
 * The set of OAuth-capable integrations is static metadata (the protocol is
 * the same for everyone). What _varies per workspace_ is whether credentials
 * have been configured for each provider — checked via `hasOAuthAppConfigured`
 * at the entry points, not here.
 */
const OAUTH_CAPABLE_IDS = new Set([
  'google', 'google_drive', 'google-drive', 'google-sheets', 'google-docs', 'gmail',
  'notion', 'github',
]);
const oauthIds = { includes: (id: string) => OAUTH_CAPABLE_IDS.has(id) };

// GET /connections/team — List team connections (admin-only)
router.get('/team', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const connections = await listTeamConnections(workspaceId);

    // Build integration name map + collect auto-configured integration ids so
    // we can filter them out. Auto-configured integrations (KB, Docs) declare
    // `supportedCredentialModes: []` — they never need a credential row. Any
    // rows for them in the connections table are legacy leftovers from before
    // they were reclassified and shouldn't appear as manageable team
    // connections in the UI.
    const integrationMap: Record<string, string> = {};
    const autoConfiguredIds = new Set<string>();
    try {
      const integrations = getIntegrations();
      for (const int of integrations as any[]) {
        integrationMap[int.id] = int.label || int.name || int.id;
        if (Array.isArray(int.supportedCredentialModes) && int.supportedCredentialModes.length === 0) {
          autoConfiguredIds.add(int.id);
        }
      }
    } catch { /* ignore */ }

    res.json((connections as any[])
      .filter((c: any) => !autoConfiguredIds.has(c.integration_id))
      .map((c: any) => ({
        id: c.id,
        integrationId: c.integration_id,
        integrationName: integrationMap[c.integration_id] || c.integration_id || '',
        displayName: c.label || integrationMap[c.integration_id] || c.integration_id || '',
        type: 'team',
        userId: null,
        userDisplayName: null,
        status: c.status || 'active',
        createdAt: c.created_at,
      })));
  } catch (err: any) {
    logger.error('List team connections error', { error: err.message });
    res.status(500).json({ error: 'Failed to list team connections' });
  }
});

// GET /connections/personal — List personal connections for current user
router.get('/personal', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const connections = await listPersonalConnectionsForUser(workspaceId, userId);

    const integrationMap: Record<string, string> = {};
    try {
      const integrations = getIntegrations();
      for (const int of integrations as any[]) {
        integrationMap[int.id] = int.label || int.name || int.id;
      }
    } catch { /* ignore */ }

    const userIds = (connections as any[]).map((c: any) => c.user_id).filter(Boolean);
    const names = await resolveUserNames(userIds);

    res.json((connections as any[]).map((c: any) => {
      let rootFolderId = null;
      let rootFolderName = null;
      try {
        if (c.credentials_encrypted && c.credentials_iv) {
          const { decryptCredentials } = require('../../modules/connections');
          const creds = decryptCredentials(c);
          rootFolderId = creds.root_folder_id || null;
          rootFolderName = creds.root_folder_name || null;
        }
      } catch { /* ignore decrypt errors */ }
      return {
        id: c.id,
        integrationId: c.integration_id,
        integrationName: integrationMap[c.integration_id] || c.integration_id || '',
        displayName: c.label || integrationMap[c.integration_id] || c.integration_id || '',
        type: 'personal',
        userId: c.user_id,
        userDisplayName: names[c.user_id] || c.user_id,
        status: c.status || 'active',
        createdAt: c.created_at,
        rootFolderId,
        rootFolderName,
      };
    }));
  } catch (err: any) {
    logger.error('List personal connections error', { error: err.message });
    res.status(500).json({ error: 'Failed to list personal connections' });
  }
});

// POST /connections/team — Create team connection (admin-only)
router.post('/team', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { integrationId, credentials, label } = req.body;
    if (!integrationId || !credentials) {
      res.status(400).json({ error: 'integrationId and credentials are required' });
      return;
    }
    const connection = await createTeamConnection(workspaceId, integrationId, credentials, userId, label);
    res.status(201).json(connection);
  } catch (err: any) {
    logger.error('Create team connection error', { error: err.message });
    res.status(400).json({ error: "Couldn't save the connection. Please check your credentials and try again." });
  }
});

// POST /connections/personal — Create personal connection
router.post('/personal', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { integrationId, credentials, label } = req.body;
    if (!integrationId || !credentials) {
      res.status(400).json({ error: 'integrationId and credentials are required' });
      return;
    }
    const connection = await createPersonalConnection(workspaceId, integrationId, userId, credentials, label);
    res.status(201).json(connection);
  } catch (err: any) {
    logger.error('Create personal connection error', { error: err.message });
    res.status(400).json({ error: "Couldn't save the connection. Please check your credentials and try again." });
  }
});

// PATCH /connections/:id/settings — Update connection settings (e.g. root folder)
router.patch('/:id/settings', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const { rootFolderId, rootFolderName } = req.body;

    // Get existing connection and decrypt credentials
    const { decryptCredentials } = await import('../../modules/connections');
    const conn = await query('SELECT * FROM connections WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
    if (!(conn as any[]).length) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }
    const existing = (conn as any[])[0];
    // Check ownership
    if (existing.connection_type === 'personal' && existing.user_id !== userId) {
      res.status(403).json({ error: 'Not your connection' });
      return;
    }

    const creds = decryptCredentials(existing);
    // Update settings in credentials
    if (rootFolderId !== undefined) {
      if (rootFolderId) {
        creds.root_folder_id = rootFolderId;
        creds.root_folder_name = rootFolderName || '';
      } else {
        delete creds.root_folder_id;
        delete creds.root_folder_name;
      }
    }

    const { encrypt } = await import('../../modules/connections/crypto');
    const { encrypted, iv } = encrypt(JSON.stringify(creds));
    await execute(
      'UPDATE connections SET credentials_encrypted = $1, credentials_iv = $2, updated_at = NOW() WHERE id = $3',
      [encrypted, iv, id]
    );
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Update connection settings error', { error: err.message });
    res.status(400).json({ error: "Couldn't update the connection settings. Please try again." });
  }
});

// DELETE /connections/:id — Delete connection
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    await deleteConnection(workspaceId, id);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete connection error', { error: err.message });
    res.status(400).json({ error: "Couldn't delete the connection. Please try again." });
  }
});

// GET /connections/agent-tool-usage — Get tool-agent usage map (admin-only)
router.get('/agent-tool-usage', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const usage = await getToolAgentUsage(workspaceId);
    res.json(usage);
  } catch (err: any) {
    logger.error('Get tool agent usage error', { error: err.message });
    res.status(500).json({ error: 'Failed to get tool agent usage' });
  }
});

// GET /connections/agent/:agentId — List agent tool connections
router.get('/agent/:agentId', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const agentId = req.params.agentId as string;
    const connections = await listAgentToolConnections(workspaceId, agentId);
    const REVERSE_MAP: Record<string, string> = { team: 'team', runtime: 'personal', delegated: 'creator' };
    res.json((connections as any[]).map((c: any) => ({
      agentId: c.agent_id,
      toolName: c.tool_name,
      mode: REVERSE_MAP[c.connection_mode] || c.connection_mode || 'team',
      connectionId: c.connection_id,
    })));
  } catch (err: any) {
    logger.error('List agent tool connections error', { error: err.message });
    res.status(500).json({ error: 'Failed to list agent tool connections' });
  }
});

// PUT /connections/agent/:agentId/:toolName — Set agent tool connection
// When setting a mode for one tool, also sets it for all sibling tools from the
// same integration (e.g. setting google-sheets-read to delegated also sets
// google-sheets-write). This ensures the credential mode is consistent at the
// integration level, matching the dashboard's per-integration dropdown.
router.put('/agent/:agentId/:toolName', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const agentId = req.params.agentId as string;
    const toolName = req.params.toolName as string;
    const { mode, connectionId } = req.body;
    if (!mode) {
      res.status(400).json({ error: 'mode is required' });
      return;
    }
    // Map frontend labels to backend connection modes
    const MODE_MAP: Record<string, string> = { team: 'team', personal: 'runtime', creator: 'delegated', runtime: 'runtime', delegated: 'delegated' };
    const resolvedMode = MODE_MAP[mode] || mode;

    // Validate mode against integration's supportedCredentialModes
    try {
      const { getIntegrationIdForTool } = await import('../../modules/connections');
      const integId = getIntegrationIdForTool(toolName);
      const { getIntegration } = await import('../../modules/tools/integrations');
      const integ = getIntegration(integId);
      if (integ?.supportedCredentialModes) {
        if (integ.supportedCredentialModes.length === 0) {
          res.status(400).json({ error: 'This tool is auto-configured and does not need credentials.' });
          return;
        }
        if (!integ.supportedCredentialModes.includes(resolvedMode as any)) {
          res.status(400).json({ error: `Mode '${resolvedMode}' is not supported for this integration. Supported: ${integ.supportedCredentialModes.join(', ')}` });
          return;
        }
      }
    } catch { /* best-effort validation */ }

    // Non-admins: team credential flow with read vs write rules
    if (resolvedMode === 'team') {
      const { isPlatformAdmin } = await import('../../modules/access-control');
      const isAdmin = await isPlatformAdmin(workspaceId, userId);
      if (!isAdmin) {
        const { getIntegrationIdForTool, getTeamConnection } = await import('../../modules/connections');
        const { getAgent } = await import('../../modules/agents');
        const agent = await getAgent(workspaceId, agentId);
        const integrationId = getIntegrationIdForTool(toolName);
        const isWriteTool = toolName.endsWith('-write');

        // Persist the mode immediately so it doesn't revert on refresh
        await setAgentToolConnection(workspaceId, agentId, toolName, 'team', null, userId);
        // Also set for sibling tools from the same integration
        if (agent) {
          const siblingTools = (agent.tools || []).filter(
            (t: string) => t !== toolName && getIntegrationIdForTool(t) === integrationId
          );
          for (const sibling of siblingTools) {
            await setAgentToolConnection(workspaceId, agentId, sibling, 'team', null, userId);
          }
        }

        // Read tools with existing team connection: no request needed
        if (!isWriteTool) {
          const teamConn = await getTeamConnection(workspaceId, integrationId);
          if (teamConn) {
            res.json({ ok: true, message: 'Team credentials configured.' });
            return;
          }
        }

        // Write tools or read tools without team connection: create request
        const { createToolRequest, listPlatformAdmins } = await import('../../modules/access-control');
        const accessLevel = isWriteTool ? 'read-write' : 'read-only';
        const reason = isWriteTool ? 'Requested team credentials' : 'Team credentials not configured';
        await createToolRequest(workspaceId, agentId, toolName, accessLevel, userId, reason);
        // Notify admins
        try {
          const { sendDMBlocks } = await import('../../slack');
          const admins = await listPlatformAdmins(workspaceId);
          for (const admin of admins) {
            await sendDMBlocks(admin.user_id, [
              { type: 'section', text: { type: 'mrkdwn', text: `:lock: *Credential request*\n<@${userId}> wants to use *team credentials* for *${toolName}* on agent *${agent?.name || agentId}*.\nReview in the dashboard under Credential Requests.` } },
              {
                type: 'actions',
                elements: [{
                  type: 'button',
                  text: { type: 'plain_text', text: 'View in Dashboard' },
                  url: `${config.server.webDashboardUrl}/requests`,
                  action_id: 'open_dashboard_requests',
                }],
              },
            ], 'Credential request pending review');
          }
        } catch {}
        res.status(202).json({ status: 'pending_approval', message: 'Using team credentials requires admin approval.' });
        return;
      }
    }

    // Set for the requested tool
    const result = await setAgentToolConnection(
      workspaceId, agentId, toolName,
      resolvedMode, connectionId || null, userId,
    );

    // Also set for all sibling tools from the same integration that the agent has
    const { getIntegrationIdForTool } = await import('../../modules/connections');
    const { getAgent } = await import('../../modules/agents');
    const integrationId = getIntegrationIdForTool(toolName);
    const agent = await getAgent(workspaceId, agentId);
    if (agent) {
      const siblingTools = (agent.tools || []).filter(
        (t: string) => t !== toolName && getIntegrationIdForTool(t) === integrationId
      );
      for (const sibling of siblingTools) {
        await setAgentToolConnection(workspaceId, agentId, sibling, resolvedMode, connectionId || null, userId);
      }
    }

    res.json(result);
  } catch (err: any) {
    logger.error('Set agent tool connection error', { error: err.message });
    res.status(400).json({ error: "Couldn't update the tool connection. Please try again." });
  }
});

// GET /connections/oauth/:integration/start — Start OAuth flow (redirects to provider).
// Pre-flight gate: if the workspace has no OAuth app configured for this
// provider, surface the setup prompt instead of a generic failure.
router.get('/oauth/:integration/start', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const integration = req.params.integration as string;
    const provider = getProviderForIntegration(integration);
    if (provider) {
      const configured = await hasOAuthAppConfigured(workspaceId, provider);
      if (!configured) {
        res.status(409).json({
          needsSetup: true,
          provider,
          setupUrl: `/settings/integrations/${provider}`,
          message: `Your workspace hasn't set up a ${provider} OAuth app yet. An admin needs to configure one in Settings → Integrations.`,
        });
        return;
      }
    }
    const { getOAuthUrl } = await import('../../modules/connections/oauth');
    const { url } = await getOAuthUrl(integration, workspaceId, userId);
    res.redirect(url);
  } catch (err: any) {
    if (err instanceof OAuthAppNotConfiguredError) {
      res.status(409).json({
        needsSetup: true,
        provider: err.provider,
        setupUrl: `/settings/integrations/${err.provider}`,
        message: err.message,
      });
      return;
    }
    logger.error('OAuth start error', { error: err.message });
    res.status(400).json({ error: "Couldn't start the connection process. Please try again." });
  }
});

// GET /connections/oauth-integrations — List OAuth-capable integrations.
// The `oauthSupported` flag narrows to integrations the workspace has actually
// configured an OAuth app for (i.e. has creds in `workspace_oauth_apps`).
router.get('/oauth-integrations', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const supported = new Set(await getSupportedOAuthIntegrations(workspaceId));
    let result: any[] = [];
    try {
      const integrations = getIntegrations();
      result = (integrations as any[])
        .filter((int: any) => int.id !== 'google') // Hide legacy Google Workspace
        .map((int: any) => ({
          id: int.id,
          name: int.id,
          displayName: int.label || int.id,
          description: int.description || '',
          oauthSupported: supported.has(int.id),
        }));
    } catch { /* ignore */ }
    res.json(result);
  } catch (err: any) {
    logger.error('List OAuth integrations error', { error: err.message });
    res.status(500).json({ error: 'Failed to list OAuth integrations' });
  }
});

// GET /connections/agent-tool-modes — List all agent tool connection modes
router.get('/agent-tool-modes', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const rows = await query(
      `SELECT atc.*, a.name as agent_name
       FROM agent_tool_connections atc
       JOIN agents a ON atc.agent_id = a.id
       WHERE a.workspace_id = $1`,
      [workspaceId]
    );
    res.json((rows as any[]).map((r: any) => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      toolName: r.tool_name,
      mode: ({ team: 'team', runtime: 'personal', delegated: 'creator' } as Record<string, string>)[r.connection_mode || r.mode] || r.connection_mode || r.mode || 'team',
    })));
  } catch (err: any) {
    logger.error('List agent tool modes error', { error: err.message });
    res.status(500).json({ error: 'Failed to list agent tool modes' });
  }
});

// PUT /connections/agent-tool-modes/:agentId/:toolName — Set agent tool mode
router.put('/agent-tool-modes/:agentId/:toolName', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const agentId = req.params.agentId as string;
    const toolName = req.params.toolName as string;
    const { mode, connectionId } = req.body;
    if (!mode) {
      res.status(400).json({ error: 'mode is required' });
      return;
    }
    const result = await setAgentToolConnection(
      workspaceId, agentId, toolName,
      mode, connectionId || null, userId,
    );
    res.json(result);
  } catch (err: any) {
    logger.error('Set agent tool mode error', { error: err.message });
    res.status(400).json({ error: "Couldn't update the tool mode. Please try again." });
  }
});

// GET /connections/agent/:agentId/availability — Check connection availability for an agent's tools
// Returns booleans indicating whether team, creator, and current user have connections for each integration
router.get('/agent/:agentId/availability', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const agentId = req.params.agentId as string;

    const { getAgent } = await import('../../modules/agents');
    const { getIntegrationIdForTool } = await import('../../modules/connections');

    const agent = await getAgent(workspaceId, agentId);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    // Map agent tools to unique integration IDs
    const integrationIds = new Set<string>();
    for (const tool of (agent.tools || []) as string[]) {
      const intId = getIntegrationIdForTool(tool);
      if (intId) integrationIds.add(intId);
    }

    // Batch-query connections
    const teamConnections = await listTeamConnections(workspaceId);
    const creatorConnections = agent.created_by
      ? await listPersonalConnectionsForUser(workspaceId, agent.created_by)
      : [];
    const currentUserConnections = await listPersonalConnectionsForUser(workspaceId, userId);

    // Build team connection set
    const teamSet = new Set((teamConnections as any[]).filter((c: any) => c.status === 'active').map((c: any) => c.integration_id));
    const creatorSet = new Set((creatorConnections as any[]).filter((c: any) => c.status === 'active').map((c: any) => c.integration_id));
    const currentUserSet = new Set((currentUserConnections as any[]).filter((c: any) => c.status === 'active').map((c: any) => c.integration_id));

    const result: Record<string, { teamConnected: boolean; creatorConnected: boolean; currentUserConnected: boolean }> = {};
    for (const intId of integrationIds) {
      result[intId] = {
        teamConnected: teamSet.has(intId),
        creatorConnected: creatorSet.has(intId),
        currentUserConnected: currentUserSet.has(intId),
      };
    }

    res.json(result);
  } catch (err: any) {
    logger.error('Connection availability error', { error: err.message });
    res.status(500).json({ error: 'Failed to check connection availability' });
  }
});

// GET /connections/expired-count — Count expired connections relevant to current user
// Admins see all expired connections (team + all personal); non-admins see only their own
router.get('/expired-count', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { queryOne } = await import('../../db');
    const { isPlatformAdmin } = await import('../../modules/access-control');
    const isAdmin = await isPlatformAdmin(workspaceId, userId);
    // Admins: expired team connections + their own expired personal connections
    // Non-admins: only their own expired personal connections
    const result = await queryOne<{ count: string }>(
      isAdmin
        ? "SELECT COUNT(*)::text AS count FROM connections WHERE workspace_id = $1 AND status = 'expired' AND (connection_type = 'team' OR user_id = $2)"
        : "SELECT COUNT(*)::text AS count FROM connections WHERE workspace_id = $1 AND status = 'expired' AND user_id = $2 AND connection_type = 'personal'",
      [workspaceId, userId]
    );
    res.json({ count: parseInt(result?.count || '0', 10) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workspace-owned OAuth apps (Google, Notion, GitHub) ──
// Each workspace brings its own OAuth client credentials. The platform is
// transport only — it never holds a Google OAuth identity of its own.

function parseProvider(raw: string): OAuthAppProvider | null {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as OAuthAppProvider)
    : null;
}

function parsePublishingStatus(raw: unknown): OAuthAppPublishingStatus | null {
  if (raw === 'internal' || raw === 'external_testing' || raw === 'external_production') return raw;
  return null;
}

// GET /connections/workspace-oauth-apps/:provider — status + masked client id
router.get('/workspace-oauth-apps/:provider', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const provider = parseProvider(req.params.provider as string);
    if (!provider) {
      res.status(400).json({ error: 'Unsupported provider' });
      return;
    }
    const summary = await getOAuthAppSummary(workspaceId, provider);
    if (!summary) {
      res.json({
        configured: false,
        provider,
        redirectUri: `${config.oauth.redirectBaseUrl}/auth/callback/${provider}`,
      });
      return;
    }
    res.json({
      configured: true,
      provider,
      clientIdMasked: summary.clientIdMasked,
      publishingStatus: summary.publishingStatus,
      configuredAt: summary.configuredAt,
      updatedAt: summary.updatedAt,
      redirectUri: `${config.oauth.redirectBaseUrl}/auth/callback/${provider}`,
    });
  } catch (err: any) {
    logger.error('Get workspace OAuth app error', { error: err.message });
    res.status(500).json({ error: 'Failed to read OAuth app config' });
  }
});

// PUT /connections/workspace-oauth-apps/:provider — save or replace credentials
router.put('/workspace-oauth-apps/:provider', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const provider = parseProvider(req.params.provider as string);
    if (!provider) {
      res.status(400).json({ error: 'Unsupported provider' });
      return;
    }
    const { clientId, clientSecret, publishingStatus } = req.body || {};
    if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
      res.status(400).json({ error: 'clientId and clientSecret are required' });
      return;
    }
    const summary = await setOAuthAppCredentials(workspaceId, provider, {
      clientId,
      clientSecret,
      publishingStatus: parsePublishingStatus(publishingStatus),
      userId: userId || null,
    });
    res.json({
      configured: true,
      provider,
      clientIdMasked: summary.clientIdMasked,
      publishingStatus: summary.publishingStatus,
      configuredAt: summary.configuredAt,
      updatedAt: summary.updatedAt,
    });
  } catch (err: any) {
    logger.error('Save workspace OAuth app error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to save OAuth app' });
  }
});

// DELETE /connections/workspace-oauth-apps/:provider — remove credentials
router.delete('/workspace-oauth-apps/:provider', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const provider = parseProvider(req.params.provider as string);
    if (!provider) {
      res.status(400).json({ error: 'Unsupported provider' });
      return;
    }
    await clearOAuthAppCredentials(workspaceId, provider);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete workspace OAuth app error', { error: err.message });
    res.status(500).json({ error: 'Failed to remove OAuth app' });
  }
});

// POST /connections/workspace-oauth-apps/:provider/test — preflight check
router.post('/workspace-oauth-apps/:provider/test', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const provider = parseProvider(req.params.provider as string);
    if (!provider) {
      res.status(400).json({ error: 'Unsupported provider' });
      return;
    }
    const result = await testOAuthAppCredentials(workspaceId, provider);
    res.json(result);
  } catch (err: any) {
    logger.error('Test workspace OAuth app error', { error: err.message });
    res.status(500).json({ error: 'Failed to test OAuth app' });
  }
});

export default router;
