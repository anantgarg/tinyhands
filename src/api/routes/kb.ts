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
    const [manualRow] = await query('SELECT count(*)::int as count FROM kb_entries WHERE workspace_id = $1 AND kb_source_id IS NULL', [workspaceId]);
    res.json({
      totalEntries: totalRow?.count ?? 0,
      pendingEntries: pendingRow?.count ?? 0,
      categories: catRow?.count ?? 0,
      sourcesCount: srcRow?.count ?? 0,
      manualEntries: manualRow?.count ?? 0,
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
    res.status(400).json({ error: "Couldn't create the knowledge base entry. Please try again." });
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
    res.status(400).json({ error: "Couldn't approve the entry. Please try again." });
  }
});

// DELETE /kb/entries/:id — Delete KB entry (admin-only)
router.delete('/entries/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const existing = await getKBEntry(workspaceId, id);
    if (!existing) { res.status(404).json({ error: 'Entry not found' }); return; }
    if (existing.kb_source_id) {
      res.status(409).json({ error: 'This entry is managed by a connected source and can\'t be deleted here. Remove it in the source folder and re-sync.' });
      return;
    }
    await deleteKBEntry(workspaceId, id);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete KB entry error', { error: err.message });
    res.status(400).json({ error: "Couldn't delete the entry. Please try again." });
  }
});

// PATCH /kb/entries/:id — Update KB entry (admin-only)
router.patch('/entries/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const existing = await getKBEntry(workspaceId, id);
    if (!existing) { res.status(404).json({ error: 'Entry not found' }); return; }
    if (existing.kb_source_id) {
      res.status(409).json({ error: 'This entry is managed by a connected source and can\'t be edited here. Edit it in the source folder and re-sync.' });
      return;
    }
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
    res.status(400).json({ error: "Couldn't update the entry. Please try again." });
  }
});

// ── KB Sources ──

// GET /kb/sources — List sources, including a per-source `skippedCount`
// that the dashboard uses to decide whether to show the "failures" icon on
// each row. The icon opens a modal that loads the full list via
// /kb/sources/:id/skip-log.
router.get('/sources', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { countSkippedFiles } = await import('../../modules/kb-sources/skip-log');
    const sources = await listSources(workspaceId);
    const rows = await Promise.all((sources as any[]).map(async (s: any) => ({
      id: s.id,
      name: s.name,
      type: s.source_type || s.type,
      config: s.config_json ? (typeof s.config_json === 'string' ? JSON.parse(s.config_json) : s.config_json) : {},
      status: s.status,
      lastSyncAt: s.last_sync_at,
      entriesCount: s.entry_count ?? 0,
      errorMessage: s.error_message ?? null,
      skippedCount: await countSkippedFiles(workspaceId, s.id),
      createdAt: s.created_at,
    })));
    res.json(rows);
  } catch (err: any) {
    logger.error('List KB sources error', { error: err.message });
    res.status(500).json({ error: 'Failed to list sources' });
  }
});

// GET /kb/sources/:id/skip-log — Per-file failures from the most recent
// syncs (upserted; deleted when a file later ingests successfully). The
// dashboard surfaces this behind an icon on each source row.
router.get('/sources/:id/skip-log', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const { listSkippedFiles, SKIP_REASON_LABELS } = await import('../../modules/kb-sources/skip-log');
    const rows = await listSkippedFiles(workspaceId, id);
    res.json(rows.map(r => ({
      id: r.id,
      filename: r.filename,
      filePath: r.file_path,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
      reason: r.reason,
      reasonLabel: SKIP_REASON_LABELS[r.reason as keyof typeof SKIP_REASON_LABELS] || r.reason,
      message: r.message,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    })));
  } catch (err: any) {
    logger.error('List skip log error', { error: err.message });
    res.status(500).json({ error: 'Failed to load skipped files' });
  }
});

// POST /kb/sources/:id/reparse — Re-run parsing on every already-synced
// file in a source using current workspace parser settings (e.g. after
// enabling Reducto). Implemented as flush+resync: cheapest path that
// honors the updated settings without a dedicated re-parse queue.
router.post('/sources/:id/reparse', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    await flushAndResync(workspaceId, id, userId);
    res.json({ ok: true, message: 'Re-parse started — existing entries are being refreshed.' });
  } catch (err: any) {
    logger.error('Re-parse KB source error', { error: err.message });
    res.status(400).json({ error: "Couldn't start the re-parse. Please try again." });
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
    res.status(400).json({ error: "Couldn't create the source. Please try again." });
  }
});

// PATCH /kb/sources/:id — Update source (admin-only)
router.patch('/sources/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const { config, autoSync, syncIntervalHours, ...rest } = req.body;
    const updates: any = { ...rest };
    if (config) updates.config_json = JSON.stringify(config);
    if (autoSync !== undefined) updates.auto_sync = autoSync === true || autoSync === 'true';
    if (syncIntervalHours !== undefined) {
      const h = Number(syncIntervalHours);
      if (Number.isFinite(h) && h > 0) updates.sync_interval_hours = Math.round(h);
    }
    await updateSource(workspaceId, id, updates);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Update KB source error', { error: err.message });
    res.status(400).json({ error: "Couldn't update the source. Please try again." });
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
    res.status(400).json({ error: "Couldn't delete the source. Please try again." });
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
    res.status(400).json({ error: "Couldn't start the sync. Please try again." });
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
    res.status(400).json({ error: "Couldn't resync the source. Please try again." });
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
    res.status(400).json({ error: "Couldn't save the API key. Please try again." });
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
    res.status(400).json({ error: "Couldn't delete the API key. Please try again." });
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
      res.status(400).json({ error: 'Connect your Google account in Tools → Personal first, then try again.' });
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
    res.status(500).json({ error: "Couldn't load Drive folders. Please try again." });
  }
});

// GET /kb/drive-folder-name/:id — look up a Google Drive folder's display name
// via the caller's personal Google connection (used to backfill folderName
// for sources created before we saved it alongside folderId).
router.get('/drive-folder-name/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const folderId = req.params.id as string;

    const { getPersonalConnection, decryptCredentials } = await import('../../modules/connections');
    let conn = await getPersonalConnection(workspaceId, 'google-drive', userId);
    if (!conn) conn = await getPersonalConnection(workspaceId, 'google', userId);
    if (!conn) {
      res.status(400).json({ error: 'Connect your Google account in Tools → Personal first.' });
      return;
    }
    const creds = decryptCredentials(conn);
    const token = creds?.access_token;
    if (!token) {
      res.status(400).json({ error: 'Google access token not found' });
      return;
    }

    const nodeHttps = require('https');
    const name: string = await new Promise((resolve, reject) => {
      const req2 = nodeHttps.request({
        hostname: 'www.googleapis.com',
        path: `/drive/v3/files/${encodeURIComponent(folderId)}?fields=name`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      }, (r: any) => {
        let data = '';
        r.on('data', (c: Buffer) => { data += c.toString(); });
        r.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed?.name || '');
          } catch {
            resolve('');
          }
        });
      });
      req2.on('error', reject);
      req2.setTimeout(10000, () => { req2.destroy(); reject(new Error('timeout')); });
      req2.end();
    });

    res.json({ id: folderId, name });
  } catch (err: any) {
    logger.error('Drive folder name lookup error', { error: err.message });
    res.status(500).json({ error: "Couldn't look up the folder." });
  }
});

export default router;
