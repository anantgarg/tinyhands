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
import { logger } from '../../utils/logger';

const router = Router();

// GET /connections/team — List team connections (admin-only)
router.get('/team', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const connections = await listTeamConnections(workspaceId);
    res.json(connections);
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
    res.json(connections);
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
    res.json(connections);
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
    const result = await setAgentToolConnection(
      workspaceId, agentId, toolName,
      mode, connectionId || null, userId,
    );
    res.json(result);
  } catch (err: any) {
    logger.error('Set agent tool connection error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

export default router;
