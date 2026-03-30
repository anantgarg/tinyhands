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
import { resolveUserNames } from '../helpers/user-resolver';
import { query, execute } from '../../db';
import { logger } from '../../utils/logger';
import { config } from '../../config';

const router = Router();

// GET /connections/team — List team connections (admin-only)
router.get('/team', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const connections = await listTeamConnections(workspaceId);

    // Build integration name map
    const integrationMap: Record<string, string> = {};
    try {
      const integrations = getIntegrations();
      for (const int of integrations as any[]) {
        integrationMap[int.id] = int.label || int.name || int.id;
      }
    } catch { /* ignore */ }

    res.json((connections as any[]).map((c: any) => ({
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

    // Non-admins cannot switch write tools to team credentials without approval
    if (resolvedMode === 'team' && toolName.endsWith('-write')) {
      const { isPlatformAdmin } = await import('../../modules/access-control');
      const isAdmin = await isPlatformAdmin(workspaceId, userId);
      if (!isAdmin) {
        const { createToolRequest, listPlatformAdmins } = await import('../../modules/access-control');
        const { getAgent } = await import('../../modules/agents');
        const agent = await getAgent(workspaceId, agentId);
        await createToolRequest(workspaceId, agentId, toolName, 'read-write', userId, 'Requested team credentials for write tool');
        // Notify admins
        try {
          const { sendDMBlocks } = await import('../../slack');
          const admins = await listPlatformAdmins(workspaceId);
          for (const admin of admins) {
            await sendDMBlocks(admin.user_id, [
              { type: 'section', text: { type: 'mrkdwn', text: `:lock: *Tool credential request*\n<@${userId}> wants to use *team credentials* for *${toolName}* on agent *${agent?.name || agentId}*.\nReview in the dashboard under Tool Requests.` } },
              {
                type: 'actions',
                elements: [{
                  type: 'button',
                  text: { type: 'plain_text', text: 'View in Dashboard' },
                  url: `${config.server.webDashboardUrl}/requests`,
                  action_id: 'open_dashboard_requests',
                }],
              },
            ], 'Tool credential request pending approval');
          }
        } catch {}
        res.status(202).json({ status: 'pending_approval', message: 'Using team credentials for write tools requires admin approval.' });
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

// GET /connections/oauth/:integration/start — Start OAuth flow (redirects to provider)
router.get('/oauth/:integration/start', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const integration = req.params.integration as string;
    const { getOAuthUrl } = await import('../../modules/connections/oauth');
    const { url } = await getOAuthUrl(integration, workspaceId, userId);
    res.redirect(url);
  } catch (err: any) {
    logger.error('OAuth start error', { error: err.message });
    res.status(400).json({ error: "Couldn't start the connection process. Please try again." });
  }
});

// GET /connections/oauth-integrations — List OAuth-capable integrations
router.get('/oauth-integrations', async (_req: Request, res: Response) => {
  try {
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
          oauthSupported: !!(int as any).oauthConfig || int.connectionModel === 'personal',
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

// GET /connections/expired-count — Count expired connections
router.get('/expired-count', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { queryOne } = await import('../../db');
    const result = await queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM connections WHERE workspace_id = $1 AND status = 'expired'",
      [workspaceId]
    );
    res.json({ count: parseInt(result?.count || '0', 10) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
