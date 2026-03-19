import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  getBuiltinTools, listCustomTools, getCustomTool,
  registerCustomTool, approveCustomTool, deleteCustomTool,
  getToolConfig, updateToolConfig, setToolConfigKey, removeToolConfigKey,
  updateToolAccessLevel,
} from '../../modules/tools';
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

export default router;
