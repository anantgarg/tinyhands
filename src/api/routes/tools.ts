import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  getBuiltinTools, listCustomTools, getCustomTool,
  registerCustomTool, approveCustomTool, deleteCustomTool,
  getToolConfig, updateToolConfig, setToolConfigKey, removeToolConfigKey,
  updateToolAccessLevel,
} from '../../modules/tools';
import { getIntegrations } from '../../modules/tools/integrations';
import { createTeamConnection } from '../../modules/connections';
import { logger } from '../../utils/logger';

const router = Router();

// GET /tools/builtin — List built-in tools
router.get('/builtin', (_req: Request, res: Response) => {
  try {
    const tools = getBuiltinTools();
    res.json(tools);
  } catch (err: any) {
    logger.error('List builtin tools error', { error: err.message });
    res.status(500).json({ error: 'Failed to list builtin tools' });
  }
});

// GET /tools/custom — List custom tools (admin-only)
router.get('/custom', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const tools = await listCustomTools(workspaceId);
    res.json(tools);
  } catch (err: any) {
    logger.error('List custom tools error', { error: err.message });
    res.status(500).json({ error: 'Failed to list custom tools' });
  }
});

// GET /tools/custom/:name — Get custom tool detail
router.get('/custom/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const name = req.params.name as string;
    const tool = await getCustomTool(workspaceId, name);
    if (!tool) {
      res.status(404).json({ error: 'Tool not found' });
      return;
    }
    res.json(tool);
  } catch (err: any) {
    logger.error('Get custom tool error', { error: err.message });
    res.status(500).json({ error: 'Failed to get tool' });
  }
});

// POST /tools/custom — Register custom tool (admin-only)
router.post('/custom', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { name, schemaJson, scriptCode, options } = req.body;
    if (!name || !schemaJson) {
      res.status(400).json({ error: 'name and schemaJson are required' });
      return;
    }
    const tool = await registerCustomTool(workspaceId, name, schemaJson, scriptCode || null, userId, options);
    res.status(201).json(tool);
  } catch (err: any) {
    logger.error('Register custom tool error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /tools/custom/:name/approve — Approve custom tool (admin-only)
router.post('/custom/:name/approve', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const name = req.params.name as string;
    await approveCustomTool(workspaceId, name, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Approve custom tool error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// DELETE /tools/custom/:name — Delete custom tool (admin-only)
router.delete('/custom/:name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const name = req.params.name as string;
    await deleteCustomTool(workspaceId, name, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete custom tool error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// GET /tools/custom/:name/config — Get tool config (admin-only)
router.get('/custom/:name/config', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const name = req.params.name as string;
    const toolConfig = await getToolConfig(workspaceId, name, userId);
    res.json(toolConfig);
  } catch (err: any) {
    logger.error('Get tool config error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// PUT /tools/custom/:name/config — Update entire tool config (admin-only)
router.put('/custom/:name/config', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const name = req.params.name as string;
    const { configJson } = req.body;
    if (!configJson) {
      res.status(400).json({ error: 'configJson is required' });
      return;
    }
    await updateToolConfig(workspaceId, name, configJson, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Update tool config error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// PATCH /tools/custom/:name/config — Set a single config key (admin-only)
router.patch('/custom/:name/config', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const name = req.params.name as string;
    const { key, value } = req.body;
    if (!key) {
      res.status(400).json({ error: 'key is required' });
      return;
    }
    if (value === undefined || value === null) {
      const result = await removeToolConfigKey(workspaceId, name, key, userId);
      res.json(result);
    } else {
      const result = await setToolConfigKey(workspaceId, name, key, value, userId);
      res.json(result);
    }
  } catch (err: any) {
    logger.error('Patch tool config error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// PUT /tools/custom/:name/access-level — Update tool access level (admin-only)
router.put('/custom/:name/access-level', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const name = req.params.name as string;
    const { accessLevel } = req.body;
    if (!accessLevel) {
      res.status(400).json({ error: 'accessLevel is required' });
      return;
    }
    await updateToolAccessLevel(workspaceId, name, accessLevel, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Update tool access level error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// ── Available Tools ──

// GET /tools/available — All tools from all sources with display names
router.get('/available', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);

    const BUILTIN_DISPLAY: Record<string, { displayName: string; description: string; category: string }> = {
      Bash: { displayName: 'Run Commands', description: 'Execute shell commands', category: 'core' },
      Read: { displayName: 'Read Files', description: 'Read file contents', category: 'core' },
      Write: { displayName: 'Write Files', description: 'Create or overwrite files', category: 'core' },
      Edit: { displayName: 'Edit Files', description: 'Make targeted edits to files', category: 'core' },
      Glob: { displayName: 'Find Files', description: 'Search for files by pattern', category: 'core' },
      Grep: { displayName: 'Search Code', description: 'Search file contents with regex', category: 'core' },
      WebSearch: { displayName: 'Web Search', description: 'Search the web', category: 'web' },
      WebFetch: { displayName: 'Fetch Web Pages', description: 'Fetch content from URLs', category: 'web' },
      NotebookEdit: { displayName: 'Edit Notebooks', description: 'Edit Jupyter notebooks', category: 'core' },
      TodoWrite: { displayName: 'Task Planner', description: 'Create and manage task lists', category: 'core' },
      Agent: { displayName: 'Sub-Agent', description: 'Delegate work to a sub-agent', category: 'core' },
      Mcp: { displayName: 'External Service', description: 'Connect to external MCP services', category: 'integration' },
    };

    const builtinTools = getBuiltinTools().map(name => ({
      name,
      displayName: BUILTIN_DISPLAY[name]?.displayName ?? name,
      description: BUILTIN_DISPLAY[name]?.description ?? '',
      category: BUILTIN_DISPLAY[name]?.category ?? 'core',
      source: 'builtin' as const,
    }));

    const customTools = await listCustomTools(workspaceId);
    const customMapped = (customTools as any[]).map(t => ({
      name: t.name,
      displayName: t.display_name || t.name,
      description: t.description || '',
      category: 'custom',
      source: 'custom' as const,
    }));

    const integrationTools: any[] = [];
    try {
      const integrations = getIntegrations();
      for (const int of integrations) {
        for (const tool of (int as any).tools || []) {
          integrationTools.push({
            name: tool.name,
            displayName: tool.displayName || tool.name,
            description: tool.description || '',
            category: 'integration',
            source: 'integration' as const,
            accessLevel: tool.accessLevel || 'read-only',
          });
        }
      }
    } catch {
      // integrations may not be available
    }

    res.json([...builtinTools, ...customMapped, ...integrationTools]);
  } catch (err: any) {
    logger.error('List available tools error', { error: err.message });
    res.status(500).json({ error: 'Failed to list available tools' });
  }
});

// ── Integrations ──

// GET /tools/integrations — List all integrations with status
router.get('/integrations', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const integrations = getIntegrations();

    // Check which integrations have active connections
    const connectionMap: Record<string, string> = {};
    try {
      const { listTeamConnections } = await import('../../modules/connections');
      const connections = await listTeamConnections(workspaceId);
      for (const c of connections as any[]) {
        if (c.integration_id) connectionMap[c.integration_id] = c.id;
      }
    } catch { /* ignore */ }

    res.json(integrations.map((int: any) => ({
      id: int.id,
      name: int.id,
      displayName: int.label || int.id,
      description: int.description || '',
      status: connectionMap[int.id] ? 'active' : 'inactive',
      connectionId: connectionMap[int.id] || null,
      toolsCount: int.tools?.length ?? 0,
      connectionModel: int.connectionModel || 'team',
      configKeys: (int.configKeys ?? []).map((k: string) => ({
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        required: true,
        secret: k.includes('key') || k.includes('token') || k.includes('secret'),
      })),
    })));
  } catch (err: any) {
    logger.error('List integrations error', { error: err.message });
    res.status(500).json({ error: 'Failed to list integrations' });
  }
});

// POST /tools/integrations/register — Register/activate an integration
router.post('/integrations/register', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { integrationId, config } = req.body;
    if (!integrationId || !config) {
      res.status(400).json({ error: 'integrationId and config are required' });
      return;
    }
    const connection = await createTeamConnection(workspaceId, integrationId, config, userId);
    res.status(201).json(connection);
  } catch (err: any) {
    logger.error('Register integration error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// DELETE /tools/integrations/:id/disconnect — Disconnect an integration
router.delete('/integrations/:id/disconnect', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const integrationId = req.params.id as string;

    // Find the team connection for this integration
    const { getTeamConnection, deleteConnection: delConn } = await import('../../modules/connections');
    const conn = await getTeamConnection(workspaceId, integrationId);
    if (!conn) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }
    await delConn(workspaceId, conn.id);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Disconnect integration error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

export default router;
