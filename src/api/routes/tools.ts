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
// Accepts either backend format {schemaJson, scriptCode, options} or dashboard format {schema, code, language, accessLevel}
router.post('/custom', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { name, options } = req.body;
    // Accept both field name conventions, ensure string format
    const rawSchema = req.body.schemaJson || req.body.schema;
    const schemaJson = rawSchema ? (typeof rawSchema === 'string' ? rawSchema : JSON.stringify(rawSchema)) : undefined;
    const scriptCode = req.body.scriptCode || req.body.code || null;
    const mergedOptions = {
      ...options,
      ...(req.body.language ? { language: req.body.language } : {}),
      ...(req.body.accessLevel ? { accessLevel: req.body.accessLevel } : {}),
      ...(req.body.description ? { description: req.body.description } : {}),
      ...(req.body.code || req.body.scriptCode ? { code: scriptCode } : {}),
    };
    if (!name || !schemaJson) {
      res.status(400).json({ error: 'name and schemaJson (or schema) are required' });
      return;
    }
    const tool = await registerCustomTool(workspaceId, name, schemaJson, null, userId, mergedOptions);
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

    // Core tools (Bash, Read, etc.) are always available — don't return them
    // Only return integration tools and custom tools that agents can enable/disable

    // Integration tools from manifests
    const integrationTools: any[] = [];
    const integrationToolNames = new Set<string>();
    try {
      const integrations = getIntegrations();
      for (const int of integrations) {
        for (const tool of (int as any).tools || []) {
          integrationTools.push({
            name: tool.name,
            displayName: tool.displayName || tool.name,
            description: int.description || tool.description || '',
            category: 'integration',
            source: 'integration' as const,
            accessLevel: tool.accessLevel || 'read-only',
          });
          integrationToolNames.add(tool.name);
        }
      }
    } catch {
      // integrations may not be available
    }

    // Custom tools (agent-created, not integration-based)
    // Also exclude legacy google-read/google-write (replaced by google-drive, google-sheets, google-docs, gmail)
    const legacyGoogleTools = new Set(['google-read', 'google-write']);
    const customTools = await listCustomTools(workspaceId);
    const customMapped = (customTools as any[])
      .filter(t => !integrationToolNames.has(t.name) && !legacyGoogleTools.has(t.name))
      .map(t => ({
        name: t.name,
        displayName: t.display_name || t.name,
        description: t.description || '',
        category: 'custom',
        source: 'custom' as const,
      }));

    res.json([...integrationTools, ...customMapped]);
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

    // Hide legacy Google Workspace (replaced by google-drive, google-sheets, google-docs, gmail)
    res.json(integrations.filter((int: any) => int.id !== 'google').map((int: any) => ({
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
        placeholder: int.configPlaceholders?.[k] || '',
        required: true,
        secret: k.includes('key') || k.includes('token') || k.includes('secret'),
      })),
      setupGuide: int.setupGuide || null,
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

// ── Custom Tool Builder ──

// POST /tools/custom/generate — AI-generate a custom tool from description
router.post('/custom/generate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { description, language } = req.body;
    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();
    const lang = language || 'javascript';
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: `You are a tool code generator. Given a description, generate a JSON object with:
- name: kebab-case tool name
- description: one-line description
- inputSchema: JSON Schema object for the tool's input parameters
- code: ${lang} code that implements the tool (reads input from stdin JSON, writes output to stdout)
- language: "${lang}"

Return ONLY valid JSON, no markdown fences.`,
      messages: [{ role: 'user', content: description }],
    });

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    const generated = JSON.parse(text);
    res.json({
      name: generated.name || 'custom-tool',
      description: generated.description || description,
      inputSchema: generated.inputSchema || { type: 'object', properties: {} },
      code: generated.code || '',
      language: generated.language || lang,
    });
  } catch (err: any) {
    logger.error('Generate tool error', { error: err.message });
    res.status(500).json({ error: 'Failed to generate tool: ' + err.message });
  }
});

// POST /tools/custom/:name/test — Test a custom tool in sandbox
router.post('/custom/:name/test', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const name = req.params.name as string;
    const tool = await getCustomTool(workspaceId, name);
    if (!tool) {
      res.status(404).json({ error: 'Tool not found' });
      return;
    }

    const { code, inputSchema } = req.body;
    const toolCode = code || (tool as any).script_code;
    const schema = inputSchema || (tool as any).schema_json;

    if (!toolCode) {
      res.status(400).json({ error: 'Tool has no code to test' });
      return;
    }

    try {
      const { sandboxTest: doSandboxTest } = await import('../../modules/self-authoring');
      const result = await (doSandboxTest as any)(toolCode, (tool as any).language || 'javascript', typeof schema === 'string' ? JSON.parse(schema) : schema);
      res.json(result);
    } catch (sandboxErr: any) {
      res.json({ passed: false, output: '', error: sandboxErr.message, durationMs: 0 });
    }
  } catch (err: any) {
    logger.error('Test tool error', { error: err.message });
    res.status(500).json({ error: 'Failed to test tool: ' + err.message });
  }
});

// GET /tools/custom/:name/versions — Get version history
router.get('/custom/:name/versions', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const name = req.params.name as string;
    const { getToolVersions } = await import('../../modules/self-authoring');
    const versions = await getToolVersions(workspaceId, name);
    res.json(versions);
  } catch (err: any) {
    logger.error('Get tool versions error', { error: err.message });
    res.status(500).json({ error: 'Failed to get versions' });
  }
});

// POST /tools/custom/:name/rollback — Rollback to a version
router.post('/custom/:name/rollback', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const name = req.params.name as string;
    const { version } = req.body;
    if (!version) {
      res.status(400).json({ error: 'version is required' });
      return;
    }
    const { rollbackTool } = await import('../../modules/self-authoring');
    await rollbackTool(workspaceId, name, version, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Rollback tool error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// GET /tools/custom/:name/analytics — Get tool analytics
router.get('/custom/:name/analytics', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const name = req.params.name as string;
    const { getToolAnalytics } = await import('../../modules/self-authoring');
    const analytics = await getToolAnalytics(workspaceId, name);
    res.json(analytics);
  } catch (err: any) {
    logger.error('Get tool analytics error', { error: err.message });
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

export default router;
