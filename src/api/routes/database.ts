import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  listTables, getTable, createTable, deleteTable, addColumn, renameColumn, dropColumn,
  describeTable, updateSourceConfig,
  selectRows, insertRow, updateRow, deleteRow,
  importCsv, importXlsx, importGoogleSheet, syncGoogleSheet,
  getLatestSyncLog, listRecentSyncLogs, listSheetNames,
} from '../../modules/database';
import { logger } from '../../utils/logger';

const router = Router();

// GET /database/tables — list tables in this workspace.
router.get('/tables', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const tables = await listTables(workspaceId);
    const enriched = await Promise.all(tables.map(async (t) => {
      const latest = await getLatestSyncLog(workspaceId, t.id);
      return {
        ...t,
        source_config: typeof t.source_config === 'string' ? JSON.parse(t.source_config) : t.source_config,
        latestSync: latest || null,
      };
    }));
    res.json(enriched);
  } catch (err: any) {
    logger.error('List database tables failed', { error: err.message });
    res.status(500).json({ error: 'Failed to load tables.' });
  }
});

// GET /database/tables/:id — full table detail incl. columns + recent logs.
router.get('/tables/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const t = await getTable(workspaceId, (req.params.id as string));
    if (!t) { res.status(404).json({ error: 'Table not found' }); return; }
    const descr = await describeTable(workspaceId, t.name);
    const logs = await listRecentSyncLogs(workspaceId, t.id, 20);
    res.json({
      ...t,
      source_config: typeof t.source_config === 'string' ? JSON.parse(t.source_config) : t.source_config,
      columns: descr?.columns || [],
      recentLogs: logs,
    });
  } catch (err: any) {
    logger.error('Get database table failed', { error: err.message });
    res.status(500).json({ error: 'Failed to load table.' });
  }
});

// POST /database/tables — create a new table (admin-only).
router.post('/tables', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { name, description, columns } = req.body;
    if (!name || !Array.isArray(columns) || columns.length === 0) {
      res.status(400).json({ error: 'name and at least one column are required.' });
      return;
    }
    const t = await createTable(workspaceId, {
      name, description, columns,
      sourceType: 'manual',
      createdBy: userId,
    });
    res.status(201).json(t);
  } catch (err: any) {
    logger.error('Create database table failed', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to create table.' });
  }
});

// DELETE /database/tables/:id (admin-only).
router.delete('/tables/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    await deleteTable(workspaceId, (req.params.id as string));
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete database table failed', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to delete table.' });
  }
});

// PATCH /database/tables/:id/columns — add/rename/drop columns (admin-only).
router.patch('/tables/:id/columns', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { op, column, from, to, type, nullable } = req.body;
    switch (op) {
      case 'add':
        if (!column || !type) { res.status(400).json({ error: 'column and type are required for add' }); return; }
        await addColumn(workspaceId, (req.params.id as string), { name: column, type, nullable });
        break;
      case 'rename':
        if (!from || !to) { res.status(400).json({ error: 'from and to are required for rename' }); return; }
        await renameColumn(workspaceId, (req.params.id as string), from, to);
        break;
      case 'drop':
        if (!column) { res.status(400).json({ error: 'column is required for drop' }); return; }
        if (!req.body.confirm) { res.status(400).json({ error: 'Type confirm: true to drop a column.' }); return; }
        await dropColumn(workspaceId, (req.params.id as string), column);
        break;
      default:
        res.status(400).json({ error: 'Unknown column op. Use add/rename/drop.' });
        return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Column op failed', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// PATCH /database/tables/:id — update table metadata / source_config bits.
router.patch('/tables/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const patch = req.body || {};
    const id = req.params.id as string;
    if (patch.source_config) {
      await updateSourceConfig(workspaceId, id, patch.source_config);
    }
    if (typeof patch.description === 'string' || patch.description === null) {
      const { setTableDescription } = await import('../../modules/database');
      await setTableDescription(workspaceId, id, patch.description ?? null);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /database/tables/:id/columns/:column/description — single-column edit.
router.patch('/tables/:id/columns/:column/description', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const column = (req.params.column as string).toLowerCase();
    const description = typeof req.body?.description === 'string' ? req.body.description : null;
    const { setColumnDescription } = await import('../../modules/database');
    await setColumnDescription(workspaceId, id, column, description);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /database/tables/:id/rows — list rows for the dashboard editor.
router.get('/tables/:id/rows', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const t = await getTable(workspaceId, (req.params.id as string));
    if (!t) { res.status(404).json({ error: 'Table not found' }); return; }
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const result = await selectRows(workspaceId, t.name, { limit, offset });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /database/tables/:id/rows — insert (admin UI only; not the agent path).
router.post('/tables/:id/rows', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const t = await getTable(workspaceId, (req.params.id as string));
    if (!t) { res.status(404).json({ error: 'Table not found' }); return; }
    const result = await insertRow(workspaceId, t.name, req.body.values || {});
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /database/tables/:id/rows/:rowId — update a single row.
router.patch('/tables/:id/rows/:rowId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const t = await getTable(workspaceId, (req.params.id as string));
    if (!t) { res.status(404).json({ error: 'Table not found' }); return; }
    const rowId = parseInt((req.params.rowId as string), 10);
    const result = await updateRow(workspaceId, t.name, rowId, req.body.values || {});
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /database/tables/:id/rows/:rowId — delete a single row.
router.delete('/tables/:id/rows/:rowId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const t = await getTable(workspaceId, (req.params.id as string));
    if (!t) { res.status(404).json({ error: 'Table not found' }); return; }
    const rowId = parseInt((req.params.rowId as string), 10);
    const result = await deleteRow(workspaceId, t.name, rowId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /database/tables/:id/import — CSV/XLSX/Google Sheet import.
router.post('/import', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { kind, name, description, columnDescriptions, csvText, xlsxBase64, sheetName, spreadsheetId, syncEnabled } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    if (kind === 'csv') {
      if (!csvText) { res.status(400).json({ error: 'csvText is required for CSV import' }); return; }
      const result = await importCsv({ workspaceId, tableName: name, csvText, createdBy: userId });
      res.json(result);
    } else if (kind === 'xlsx') {
      if (!xlsxBase64) { res.status(400).json({ error: 'xlsxBase64 is required for XLSX import' }); return; }
      const buffer = Buffer.from(xlsxBase64, 'base64');
      const result = await importXlsx({ workspaceId, tableName: name, buffer, sheetName, createdBy: userId });
      res.json(result);
    } else if (kind === 'google_sheet') {
      if (!spreadsheetId) { res.status(400).json({ error: 'spreadsheetId is required' }); return; }
      const result = await importGoogleSheet({
        workspaceId, tableName: name,
        spreadsheetId, sheetName,
        syncEnabled: syncEnabled !== false,
        description,
        columnDescriptions,
        createdBy: userId,
        connectionOwnerUserId: userId,
      });
      res.json(result);
    } else {
      res.status(400).json({ error: 'Unknown import kind. Use csv, xlsx, or google_sheet.' });
    }
  } catch (err: any) {
    logger.error('Database import failed', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /database/import/xlsx-sheets — peek sheet names before importing.
router.post('/import/xlsx-sheets', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { xlsxBase64 } = req.body;
    if (!xlsxBase64) { res.status(400).json({ error: 'xlsxBase64 is required' }); return; }
    const buffer = Buffer.from(xlsxBase64, 'base64');
    const sheets = await listSheetNames(buffer);
    res.json({ sheets });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /database/drive-sheets — list spreadsheets + folders in a Drive folder
// for the spreadsheet picker. Default to the user's Drive root. Re-uses the
// same Google connection resolution as KB sources.
router.get('/drive-sheets', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const parentId = (req.query.parentId as string) || 'root';

    const { getPersonalConnection, getFreshCredentials } = await import('../../modules/connections');
    let conn = await getPersonalConnection(workspaceId, 'google-sheets', userId);
    if (!conn) conn = await getPersonalConnection(workspaceId, 'google-drive', userId);
    if (!conn) conn = await getPersonalConnection(workspaceId, 'google', userId);
    if (!conn) {
      res.status(400).json({ error: 'Connect your Google account in Tools → Personal Connections first.' });
      return;
    }
    const creds: any = await getFreshCredentials(conn);
    if (!creds?.access_token) {
      res.status(400).json({ error: 'Google session expired. Reconnect Google in Tools → Personal Connections.' });
      return;
    }

    // Honor the per-connection Drive scoping admins set under Tools → My
    // connections → Restrict Drive access. When that's set, Drive access is
    // contained to that folder for every consumer of the connection — agents,
    // the KB picker, and now this picker. We resolve `parentId='root'` to the
    // restricted folder so the picker's "top" matches what the admin allowed.
    const restrictedRootId: string | null = creds.root_folder_id || null;
    const restrictedRootName: string | null = creds.root_folder_name || null;
    const effectiveParent = parentId === 'root' && restrictedRootId
      ? restrictedRootId
      : parentId;

    // Defense-in-depth: when a restriction is set, refuse to list any folder
    // outside it. The frontend won't let you navigate up past the restricted
    // root, but a hand-crafted request shouldn't bypass it either.
    if (restrictedRootId && parentId !== 'root' && parentId !== restrictedRootId) {
      const ok = await isDescendantOf(parentId, restrictedRootId, creds.access_token);
      if (!ok) {
        res.status(403).json({
          error: `Your Google connection is restricted to "${restrictedRootName || 'a single folder'}". Pick a sheet inside that folder.`,
        });
        return;
      }
    }

    const { listDriveSpreadsheets } = await import('../../modules/sources/google-drive');
    const result = await listDriveSpreadsheets(effectiveParent, creds.access_token);
    res.json({
      parentId: effectiveParent,
      ...result,
      restrictedRootId,
      restrictedRootName,
    });
  } catch (err: any) {
    logger.error('List drive sheets failed', { error: err.message });
    res.status(500).json({ error: "Couldn't load your Google Sheets. Try reconnecting Google." });
  }
});

// Walk up the parents chain to confirm `folderId` lives under `rootId`. Stops
// after a hard cap so a malicious or broken loop can't hang the request.
async function isDescendantOf(folderId: string, rootId: string, accessToken: string): Promise<boolean> {
  let cur = folderId;
  for (let i = 0; i < 25; i++) {
    if (cur === rootId) return true;
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cur)}?fields=id,parents`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) return false;
    const data: any = await r.json();
    const parent = (data.parents && data.parents[0]) || null;
    if (!parent) return false;
    cur = parent;
  }
  return false;
}

// GET /database/sheet-tabs — list the named tabs inside a Google Sheet so the
// import dialog can show a dropdown instead of a free-text "tab name" field.
// Uses the same Google connection resolution as drive-sheets above.
router.get('/sheet-tabs', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const spreadsheetId = (req.query.spreadsheetId as string) || '';
    if (!spreadsheetId) { res.status(400).json({ error: 'spreadsheetId is required' }); return; }

    const { getPersonalConnection, getFreshCredentials } = await import('../../modules/connections');
    let conn = await getPersonalConnection(workspaceId, 'google-sheets', userId);
    if (!conn) conn = await getPersonalConnection(workspaceId, 'google-drive', userId);
    if (!conn) conn = await getPersonalConnection(workspaceId, 'google', userId);
    if (!conn) { res.status(400).json({ error: 'Connect Google in Tools → Personal Connections first.' }); return; }
    const creds: any = await getFreshCredentials(conn);
    if (!creds?.access_token) { res.status(400).json({ error: 'Google session expired. Reconnect Google.' }); return; }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(title,sheetId,index,gridProperties)`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${creds.access_token}` } });
    if (!r.ok) throw new Error(`Sheets API ${r.status}`);
    const data: any = await r.json();
    const tabs = (data.sheets || [])
      .map((s: any) => ({
        title: s.properties?.title as string,
        rowCount: s.properties?.gridProperties?.rowCount as number | undefined,
        colCount: s.properties?.gridProperties?.columnCount as number | undefined,
      }))
      .filter((t: any) => t.title);
    res.json({ tabs });
  } catch (err: any) {
    logger.error('List sheet tabs failed', { error: err.message });
    res.status(500).json({ error: "Couldn't load this spreadsheet's tabs." });
  }
});

// POST /database/suggest-metadata — given a Google Sheet (and tab), pull
// the headers + a few rows and ask Claude for a snake_case table name and a
// detailed multi-sentence description. The description is what other agents
// see when this table is `@`-referenced in their prompt, so it should be
// rich enough to let them decide whether the table is relevant.
router.post('/suggest-metadata', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { kind, spreadsheetId, sheetName } = req.body || {};
    if (kind !== 'google_sheet' || !spreadsheetId) {
      res.status(400).json({ error: 'Only Google Sheet sources are supported right now.' });
      return;
    }
    const { getPersonalConnection, getFreshCredentials } = await import('../../modules/connections');
    let conn = await getPersonalConnection(workspaceId, 'google-sheets', userId);
    if (!conn) conn = await getPersonalConnection(workspaceId, 'google-drive', userId);
    if (!conn) conn = await getPersonalConnection(workspaceId, 'google', userId);
    if (!conn) { res.status(400).json({ error: 'Connect Google in Tools → Personal Connections first.' }); return; }
    const creds: any = await getFreshCredentials(conn);
    if (!creds?.access_token) { res.status(400).json({ error: 'Google session expired. Reconnect Google.' }); return; }

    const tab = sheetName || 'Sheet1';
    const range = encodeURIComponent(`${tab}!A1:ZZ20`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${creds.access_token}` } });
    if (!r.ok) throw new Error(`Sheets API ${r.status}`);
    const data: any = await r.json();
    const values: string[][] = data.values || [];
    if (values.length === 0) {
      res.status(400).json({ error: 'The picked tab is empty. Add headers and some data, then try again.' });
      return;
    }
    const headers = values[0].map((v: any) => String(v ?? ''));
    const rows = values.slice(1).map((r: any) => r.map((v: any) => String(v ?? '')));

    // Best-effort: also pass the spreadsheet's title to give the model a hint.
    let sourceHint = sheetName || '';
    try {
      const meta = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=name`,
        { headers: { Authorization: `Bearer ${creds.access_token}` } },
      );
      if (meta.ok) {
        const m: any = await meta.json();
        if (m.name) sourceHint = sourceHint ? `${m.name} — ${sourceHint}` : m.name;
      }
    } catch { /* hint is optional */ }

    const { suggestTableMetadata } = await import('../../modules/database');
    const suggestion = await suggestTableMetadata(workspaceId, { headers, rows, sourceHint });
    res.json(suggestion);
  } catch (err: any) {
    logger.error('Suggest metadata failed', { error: err.message });
    res.status(500).json({ error: "Couldn't suggest a name and description. Fill them in manually." });
  }
});

// POST /database/tables/:id/suggest-column-descriptions — backfill per-column
// descriptions on an existing table by sampling its rows and asking Claude.
// Only fills columns that don't already have a description so admin edits
// aren't overwritten. Skips built-in columns (id/created_at/updated_at).
router.post('/tables/:id/suggest-column-descriptions', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const { getTable, describeTable, selectRows, suggestTableMetadata, setColumnDescription } =
      await import('../../modules/database');
    const t = await getTable(workspaceId, id);
    if (!t) { res.status(404).json({ error: 'Table not found' }); return; }
    const descr = await describeTable(workspaceId, t.name);
    if (!descr) { res.status(404).json({ error: 'Table not found' }); return; }
    const userCols = descr.columns.filter(c => !['id', 'created_at', 'updated_at'].includes(c.name));
    const headers = userCols.map(c => c.name);
    const sample = await selectRows(workspaceId, t.name, { columns: headers, limit: 8 });
    const rows = (sample.rows || []).map(r => headers.map(h => String(r[h] ?? '')));
    const suggestion = await suggestTableMetadata(workspaceId, {
      headers, rows,
      columns: userCols.map(c => ({ name: c.name, type: c.type })),
      sourceHint: t.name,
    });
    let updated = 0;
    for (const col of userCols) {
      const existing = (col.description || '').trim();
      const proposed = (suggestion.columns[col.name] || '').trim();
      if (!existing && proposed) {
        await setColumnDescription(workspaceId, id, col.name, proposed);
        updated++;
      }
    }
    res.json({ updated, suggested: suggestion.columns });
  } catch (err: any) {
    logger.error('Suggest column descriptions failed', { error: err.message });
    res.status(500).json({ error: "Couldn't generate column descriptions. Try again." });
  }
});

// POST /database/tables/:id/sync — manually re-sync a Google-Sheet-backed table.
router.post('/tables/:id/sync', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const result = await syncGoogleSheet(workspaceId, (req.params.id as string));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /database/tables/:id/sync/ignore-column — mark a sheet column ignored.
router.post('/tables/:id/sync/ignore-column', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const t = await getTable(workspaceId, (req.params.id as string));
    if (!t) { res.status(404).json({ error: 'Table not found' }); return; }
    const cfg = (typeof t.source_config === 'string' ? JSON.parse(t.source_config) : t.source_config) || {};
    const ignored = new Set<string>(cfg.ignored_columns || []);
    const { column } = req.body;
    if (!column) { res.status(400).json({ error: 'column is required' }); return; }
    ignored.add(String(column).toLowerCase());
    await updateSourceConfig(workspaceId, (req.params.id as string), { ignored_columns: Array.from(ignored) });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /database/tables/:id/sync/map-column — map a sheet column to an existing pg column.
router.post('/tables/:id/sync/map-column', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const t = await getTable(workspaceId, (req.params.id as string));
    if (!t) { res.status(404).json({ error: 'Table not found' }); return; }
    const cfg = (typeof t.source_config === 'string' ? JSON.parse(t.source_config) : t.source_config) || {};
    const mapping: Record<string, string> = cfg.column_mapping || {};
    const { from, to } = req.body;
    if (!from || !to) { res.status(400).json({ error: 'from and to are required' }); return; }
    mapping[String(from).toLowerCase()] = String(to).toLowerCase();
    await updateSourceConfig(workspaceId, (req.params.id as string), { column_mapping: mapping });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
