import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { getAllSettings, setSetting } from '../../modules/workspace-settings';
import { setAnthropicApiKey, hasAnthropicApiKey, testAnthropicApiKey } from '../../modules/anthropic';
import { logger } from '../../utils/logger';

const router = Router();

// GET /settings — Get all workspace settings (admin-only)
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const settings = await getAllSettings(workspaceId);
    // Convert to key-value map for easier consumption
    const map: Record<string, string> = {};
    for (const s of settings) {
      map[s.key] = s.value;
    }
    res.json(map);
  } catch (err: any) {
    logger.error('Get settings error', { error: err.message });
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// GET /settings/anthropic-key/status — Is the workspace's Claude API key configured?
router.get('/anthropic-key/status', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const configured = await hasAnthropicApiKey(workspaceId);
    res.json({ configured });
  } catch (err: any) {
    logger.error('Anthropic key status error', { error: err.message });
    res.status(500).json({ error: 'Failed to check Anthropic key status' });
  }
});

// POST /settings/anthropic-key/test — Validate a candidate key without saving
router.post('/anthropic-key/test', requireAdmin, async (req: Request, res: Response) => {
  const { apiKey } = req.body || {};
  if (!apiKey) {
    res.status(400).json({ error: 'apiKey is required' });
    return;
  }
  const result = await testAnthropicApiKey(apiKey);
  res.json(result);
});

// PUT /settings/anthropic-key — Save (and validate) the workspace's Anthropic API key
router.put('/anthropic-key', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { apiKey } = req.body || {};
    if (!apiKey) {
      res.status(400).json({ error: 'apiKey is required' });
      return;
    }
    const check = await testAnthropicApiKey(apiKey);
    if (!check.ok) {
      res.status(400).json({ error: check.reason || 'Key validation failed' });
      return;
    }
    await setAnthropicApiKey(workspaceId, apiKey, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Anthropic key save error', { error: err.message });
    res.status(500).json({ error: 'Failed to save Anthropic key' });
  }
});

// PUT /settings/:key — Set a workspace setting (admin-only)
router.put('/:key', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const key = req.params.key as string;
    const { value } = req.body;
    if (value === undefined) {
      res.status(400).json({ error: 'value is required' });
      return;
    }
    await setSetting(workspaceId, key, value, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Set setting error', { error: err.message });
    res.status(400).json({ error: "Couldn't update the setting. Please try again." });
  }
});

export default router;
