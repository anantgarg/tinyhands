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

    let where = 'WHERE workspace_id = $1';
    const params: any[] = [workspaceId];
    let paramIdx = 2;

    if (approved !== undefined) {
      where += ` AND approved = $${paramIdx++}`;
      params.push(approved === 'true');
    }
    if (category) {
      where += ` AND category = $${paramIdx++}`;
      params.push(category);
    }
    if (search) {
      where += ` AND (title ILIKE $${paramIdx} OR content ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const [countRow] = await query(`SELECT count(*)::int as count FROM kb_entries ${where}`, params);
    const total = countRow?.count ?? 0;

    const entries = await query(
      `SELECT * FROM kb_entries ${where} ORDER BY updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
  }
});

// ── KB Sources ──

// GET /kb/sources — List sources
router.get('/sources', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const sources = await listSources(workspaceId);
    res.json(sources);
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
    res.status(400).json({ error: err.message });
  }
});

// PATCH /kb/sources/:id — Update source (admin-only)
router.patch('/sources/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    await updateSource(workspaceId, id, req.body);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Update KB source error', { error: err.message });
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
  }
});

export default router;
