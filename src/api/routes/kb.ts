import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  createKBEntry, approveKBEntry, getKBEntry, deleteKBEntry,
  searchKB, getCategories,
} from '../../modules/knowledge-base';
import {
  listSources, createSource, updateSource, deleteSource,
  startSync, flushAndResync,
  listApiKeys, setApiKey, deleteApiKey,
} from '../../modules/kb-sources';
import { query } from '../../db';
import { logger } from '../../utils/logger';

const router = Router();

// GET /kb/stats — KB statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const [totalRow] = await query('SELECT count(*)::int as count FROM kb_entries WHERE workspace_id = $1 AND approved = true', [workspaceId]);
    const [pendingRow] = await query('SELECT count(*)::int as count FROM kb_entries WHERE workspace_id = $1 AND approved = false', [workspaceId]);
    const [catRow] = await query('SELECT count(DISTINCT category)::int as count FROM kb_entries WHERE workspace_id = $1 AND category IS NOT NULL', [workspaceId]);
    const [srcRow] = await query('SELECT count(*)::int as count FROM kb_sources WHERE workspace_id = $1', [workspaceId]);
    res.json({
      totalEntries: totalRow?.count ?? 0,
      pendingEntries: pendingRow?.count ?? 0,
      categories: catRow?.count ?? 0,
      sourcesCount: srcRow?.count ?? 0,
    });
  } catch (err: any) {
    logger.error('KB stats error', { error: err.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ── KB Entries ──

// GET /kb/entries — List KB entries with pagination/filtering
router.get('/entries', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const category = req.query.category as string | undefined;
    const approved = req.query.approved as string | undefined;
    const search = req.query.search as string | undefined;
    const sourceId = req.query.sourceId as string | undefined;

    let where = 'WHERE e.workspace_id = $1';
    const params: any[] = [workspaceId];
    let paramIdx = 2;

    if (approved !== undefined) {
      where += ` AND e.approved = $${paramIdx++}`;
      params.push(approved === 'true');
    }
    if (category) {
      where += ` AND e.category = $${paramIdx++}`;
      params.push(category);
    }
    if (sourceId === 'manual') {
      where += ` AND e.kb_source_id IS NULL`;
    } else if (sourceId) {
      where += ` AND e.kb_source_id = $${paramIdx++}`;
      params.push(sourceId);
    }
    if (search) {
      where += ` AND (e.title ILIKE $${paramIdx} OR e.content ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const [countRow] = await query(`SELECT count(*)::int as count FROM kb_entries e ${where}`, params);
    const total = countRow?.count ?? 0;

    const entries = await query(
      `SELECT e.*, s.name as source_name, s.source_type FROM kb_entries e LEFT JOIN kb_sources s ON e.kb_source_id = s.id ${where} ORDER BY e.updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    res.json({ entries, total });
  } catch (err: any) {
    logger.error('List KB entries error', { error: err.message });
    res.status(500).json({ error: 'Failed to list entries' });
  }
});

// GET /kb/entries/search — Search KB
router.get('/entries/search', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const q = req.query.q as string;
    if (!q) {
      res.status(400).json({ error: 'q (query) is required' });
      return;
    }
    const agentId = req.query.agentId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    const results = await searchKB(workspaceId, q, agentId, limit);
    res.json(results);
  } catch (err: any) {
    logger.error('Search KB error', { error: err.message });
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /kb/categories — List categories
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const categories = await getCategories(workspaceId);
    res.json(categories);
  } catch (err: any) {
    logger.error('List KB categories error', { error: err.message });
    res.status(500).json({ error: 'Failed to list categories' });
  }
});

// GET /kb/entries/:id — Get KB entry
router.get('/entries/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const entry = await getKBEntry(workspaceId, id);
    if (!entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    res.json(entry);
  } catch (err: any) {
    logger.error('Get KB entry error', { error: err.message });
    res.status(500).json({ error: 'Failed to get entry' });
  }
});

// POST /kb/entries — Create KB entry
router.post('/entries', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const entry = await createKBEntry(workspaceId, {
      ...req.body,
      contributedBy: userId,
      sourceType: req.body.sourceType || 'manual',
    });
    res.status(201).json(entry);
  } catch (err: any) {
    logger.error('Create KB entry error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t create the knowledge base entry. Please try again." });
  }
});

// POST /kb/entries/:id/approve — Approve KB entry (admin-only)
router.post('/entries/:id/approve', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const entry = await approveKBEntry(workspaceId, id);
    res.json(entry);
  } catch (err: any) {
    logger.error('Approve KB entry error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t approve the entry. Please try again." });
  }
});

// DELETE /kb/entries/:id — Delete KB entry (admin-only)
router.delete('/entries/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    await deleteKBEntry(workspaceId, id);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete KB entry error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t delete the entry. Please try again." });
  }
});

// PATCH /kb/entries/:id — Update KB entry (admin-only)
router.patch('/entries/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const { title, content, category } = req.body;
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (title !== undefined) { sets.push(`title = $${idx++}`); vals.push(title); }
    if (content !== undefined) { sets.push(`content = $${idx++}`); vals.push(content); }
    if (category !== undefined) { sets.push(`category = $${idx++}`); vals.push(category || null); }
    if (sets.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    sets.push(`updated_at = NOW()`);
    await query(
      `UPDATE kb_entries SET ${sets.join(', ')} WHERE workspace_id = $${idx++} AND id = $${idx}`,
      [...vals, workspaceId, id]
    );
    const entry = await getKBEntry(workspaceId, id);
    res.json(entry);
  } catch (err: any) {
    logger.error('Update KB entry error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t update the entry. Please try again." });
  }
});

// ── KB Sources ──

// GET /kb/sources — List sources
router.get('/sources', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const sources = await listSources(workspaceId);
    res.json((sources as any[]).map((s: any) => ({
      id: s.id,
      name: s.name,
      type: s.source_type || s.type,
      config: s.config_json ? (typeof s.config_json === 'string' ? JSON.parse(s.config_json) : s.config_json) : {},
      status: s.status,
      lastSyncAt: s.last_sync_at,
      entriesCount: s.entry_count ?? 0,
      createdAt: s.created_at,
    })));
  } catch (err: any) {
    logger.error('List KB sources error', { error: err.message });
    res.status(500).json({ error: 'Failed to list sources' });
  }
});

// POST /kb/sources — Create source (admin-only)
router.post('/sources', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { name, sourceType, config } = req.body;
    if (!name || !sourceType) {
      res.status(400).json({ error: 'name and sourceType are required' });
      return;
    }
    const source = await createSource(workspaceId, {
      name,
      sourceType,
      config: config || {},
      createdBy: userId,
    });
    res.status(201).json(source);
  } catch (err: any) {
    logger.error('Create KB source error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t create the source. Please try again." });
  }
});

// PATCH /kb/sources/:id — Update source (admin-only)
router.patch('/sources/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const { config, ...rest } = req.body;
    const updates: any = { ...rest };
    if (config) updates.config_json = JSON.stringify(config);
    await updateSource(workspaceId, id, updates);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Update KB source error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t update the source. Please try again." });
  }
});

// DELETE /kb/sources/:id — Delete source (admin-only)
router.delete('/sources/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    await deleteSource(workspaceId, id, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete KB source error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t delete the source. Please try again." });
  }
});

// POST /kb/sources/:id/sync — Start sync (admin-only)
router.post('/sources/:id/sync', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    await startSync(workspaceId, id);
    res.json({ ok: true, message: 'Sync started' });
  } catch (err: any) {
    logger.error('Sync KB source error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t start the sync. Please try again." });
  }
});

// POST /kb/sources/:id/flush-and-resync — Flush and resync (admin-only)
router.post('/sources/:id/flush-and-resync', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    await flushAndResync(workspaceId, id, userId);
    res.json({ ok: true, message: 'Flush and resync started' });
  } catch (err: any) {
    logger.error('Flush and resync error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t resync the source. Please try again." });
  }
});

// ── API Keys ──

// GET /kb/api-keys — List API keys (admin-only)
router.get('/api-keys', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const keys = await listApiKeys(workspaceId);
    res.json(keys);
  } catch (err: any) {
    logger.error('List API keys error', { error: err.message });
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// PUT /kb/api-keys/:provider — Set API key (admin-only)
router.put('/api-keys/:provider', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const provider = req.params.provider as string;
    const { config: keyConfig } = req.body;
    if (!keyConfig) {
      res.status(400).json({ error: 'config is required' });
      return;
    }
    const key = await setApiKey(workspaceId, provider as any, keyConfig, userId);
    res.json(key);
  } catch (err: any) {
    logger.error('Set API key error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t save the API key. Please try again." });
  }
});

// DELETE /kb/api-keys/:provider — Delete API key (admin-only)
router.delete('/api-keys/:provider', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const provider = req.params.provider as string;
    await deleteApiKey(workspaceId, provider as any, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete API key error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t delete the API key. Please try again." });
  }
});

// ── Google Drive Folder Browser ──

// GET /kb/drive-folders — List Google Drive folders for the current user
router.get('/drive-folders', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const parentId = (req.query.parentId as string) || 'root';

    // Get user's Google OAuth token
    const { getPersonalConnection } = await import('../../modules/connections');
    let conn = await getPersonalConnection(workspaceId, 'google-drive', userId);
    if (!conn) conn = await getPersonalConnection(workspaceId, 'google', userId);
    if (!conn) conn = await getPersonalConnection(workspaceId, 'google_drive', userId);

    if (!conn) {
      res.status(400).json({ error: 'Google account not connected. Connect via Connections page first.' });
      return;
    }

    const { decryptCredentials } = await import('../../modules/connections');
    const connConfig = decryptCredentials(conn);
    const token = connConfig?.access_token;
    if (!token) {
      res.status(400).json({ error: 'Google access token not found' });
      return;
    }

    const { listDriveFolders } = await import('../../modules/sources/google-drive');
    const folders = await listDriveFolders(parentId, token);
    res.json({ parentId, folders });
  } catch (err: any) {
    logger.error('Drive folders error', { error: err.message });
    res.status(500).json({ error: "Couldn\'t load Drive folders. Please try again." });
  }
});

export default router;
