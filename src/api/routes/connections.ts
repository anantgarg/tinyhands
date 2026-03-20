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
import { query } from '../../db';
import { logger } from '../../utils/logger';

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

    res.json((connections as any[]).map((c: any) => ({
      id: c.id,
      integrationId: c.integration_id,
      integrationName: integrationMap[c.integration_id] || c.integration_id || '',
      displayName: c.label || integrationMap[c.integration_id] || c.integration_id || '',
      type: 'personal',
      userId: c.user_id,
      userDisplayName: names[c.user_id] || c.user_id,
      status: c.status || 'active',
      createdAt: c.created_at,
    })));
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
    // Map backend modes to frontend labels
    const REVERSE_MAP: Record<string, string> = { team: 'team', runtime: 'personal', delegated: 'creator' };
    res.json((connections as any[]).map((c: any) => ({
      ...c,
      connection_mode: REVERSE_MAP[c.connection_mode] || c.connection_mode,
    })));
  } catch (err: any) {
    logger.error('List agent tool connections error', { error: err.message });
    res.status(500).json({ error: 'Failed to list agent tool connections' });
  }
});

// PUT /connections/agent/:agentId/:toolName — Set agent tool connection
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
    const result = await setAgentToolConnection(
      workspaceId, agentId, toolName,
      resolvedMode, connectionId || null, userId,
    );
    res.json(result);
  } catch (err: any) {
    logger.error('Set agent tool connection error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// GET /connections/oauth-integrations — List OAuth-capable integrations
router.get('/oauth-integrations', async (_req: Request, res: Response) => {
  try {
    let result: any[] = [];
    try {
      const integrations = getIntegrations();
      result = (integrations as any[]).map((int: any) => ({
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
    res.status(400).json({ error: err.message });
  }
});

export default router;
