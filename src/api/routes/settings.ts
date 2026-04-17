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

// PATCH /settings — Partial update of workspace settings (admin-only).
// Accepts the nested shape the web form sends: { general?, defaults?,
// rateLimits?, alerts? }. Writes each field to workspace_settings and, for
// the `workspaceName` field, to workspaces.team_name so it shows up in the
// sidebar workspace switcher too.
router.patch('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const body = req.body || {};
    const { execute } = await import('../../db');

    const writes: Array<Promise<any>> = [];

    if (body.general && typeof body.general === 'object') {
      const g = body.general as Record<string, unknown>;
      if (typeof g.workspaceName === 'string' && g.workspaceName.trim()) {
        writes.push(execute('UPDATE workspaces SET team_name = $1, updated_at = NOW() WHERE id = $2', [g.workspaceName.trim(), workspaceId]));
      }
      if (typeof g.defaultModel === 'string') writes.push(setSetting(workspaceId, 'default_model', g.defaultModel, userId));
      if (g.dailyBudgetUsd !== undefined && g.dailyBudgetUsd !== null) writes.push(setSetting(workspaceId, 'daily_budget_usd', String(g.dailyBudgetUsd), userId));
    }

    if (body.defaults && typeof body.defaults === 'object') {
      const d = body.defaults as Record<string, unknown>;
      if (typeof d.defaultAccess === 'string') writes.push(setSetting(workspaceId, 'default_access', d.defaultAccess, userId));
      if (typeof d.writePolicy === 'string') writes.push(setSetting(workspaceId, 'write_policy', d.writePolicy, userId));
      if (d.maxTurns !== undefined && d.maxTurns !== null) writes.push(setSetting(workspaceId, 'max_turns', String(d.maxTurns), userId));
      if (typeof d.memoryEnabled === 'boolean') writes.push(setSetting(workspaceId, 'memory_enabled', d.memoryEnabled ? 'true' : 'false', userId));
    }

    if (body.rateLimits && typeof body.rateLimits === 'object') {
      const r = body.rateLimits as Record<string, unknown>;
      if (r.tpmLimit !== undefined && r.tpmLimit !== null) writes.push(setSetting(workspaceId, 'tpm_limit', String(r.tpmLimit), userId));
      if (r.rpmLimit !== undefined && r.rpmLimit !== null) writes.push(setSetting(workspaceId, 'rpm_limit', String(r.rpmLimit), userId));
      if (r.concurrentRunsLimit !== undefined && r.concurrentRunsLimit !== null) writes.push(setSetting(workspaceId, 'concurrent_runs_limit', String(r.concurrentRunsLimit), userId));
    }

    if (body.alerts && typeof body.alerts === 'object') {
      const a = body.alerts as Record<string, unknown>;
      if (a.errorRateThreshold !== undefined && a.errorRateThreshold !== null) writes.push(setSetting(workspaceId, 'error_rate_threshold', String(a.errorRateThreshold), userId));
      if (a.costAlertThreshold !== undefined && a.costAlertThreshold !== null) writes.push(setSetting(workspaceId, 'cost_alert_threshold', String(a.costAlertThreshold), userId));
      if (a.durationAlertThreshold !== undefined && a.durationAlertThreshold !== null) writes.push(setSetting(workspaceId, 'duration_alert_threshold', String(a.durationAlertThreshold), userId));
    }

    await Promise.all(writes);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Patch settings error', { error: err.message });
    res.status(500).json({ error: 'Failed to save settings' });
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
