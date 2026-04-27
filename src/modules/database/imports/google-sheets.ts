import * as https from 'https';
import {
  createTable, getTable, getTableByName, describeTable, markSynced, updateSourceConfig,
} from '../tables';
import { withWorkspaceClient, assertIdent, sanitizeColumnName } from '../schema';
import { logSyncResult } from '../sync-log';
import { inferColumnType, coerceValue } from './infer';
import {
  getAnyPersonalConnection, getFreshCredentials,
} from '../../connections';
import type { DatabaseColumn, DatabaseSyncIssue } from '../../../types';

function httpGetJson(url: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(parsed);
        } catch (e: any) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

export interface GoogleSheetImportOptions {
  workspaceId: string;
  tableName: string;
  spreadsheetId: string;
  sheetName?: string;
  syncEnabled: boolean;
  createdBy?: string;
  connectionOwnerUserId?: string;
  /** Optional table-level description authored or AI-suggested at import time. */
  description?: string;
  /** Optional per-column descriptions, keyed by sanitized column name. */
  columnDescriptions?: Record<string, string>;
}

async function resolveGoogleToken(workspaceId: string, preferredUserId?: string): Promise<string> {
  const INTEGRATIONS = ['google-sheets', 'google-drive', 'google'];
  let conn: any = null;
  for (const id of INTEGRATIONS) {
    conn = await getAnyPersonalConnection(workspaceId, id, preferredUserId);
    if (conn) break;
  }
  if (!conn) {
    throw new Error('No Google account connected. Connect Google in Tools → Personal Connections, then try again.');
  }
  // getFreshCredentials refreshes the Google access_token if a refresh_token
  // is available — this matters for unattended sync jobs (the 5-minute
  // database sheet sync) since the stored access_token is almost always
  // stale by the time we run.
  const creds: any = await getFreshCredentials(conn);
  if (!creds?.access_token) {
    throw new Error('Google connection is missing access/refresh tokens. Reconnect Google and try again.');
  }
  return creds.access_token as string;
}

async function fetchSheetValues(
  token: string, spreadsheetId: string, sheetName: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  const range = encodeURIComponent(`${sheetName}!A:ZZ`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`;
  const resp = await httpGetJson(url, token);
  const values: string[][] = resp.values || [];
  if (values.length === 0) return { headers: [], rows: [] };
  return { headers: values[0].map(v => String(v ?? '')), rows: values.slice(1).map(r => r.map(v => String(v ?? ''))) };
}

async function fetchFirstSheetName(token: string, spreadsheetId: string): Promise<string> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const resp = await httpGetJson(url, token);
  const first = resp.sheets?.[0]?.properties?.title;
  if (!first) throw new Error('Spreadsheet has no sheets.');
  return first as string;
}

export async function importGoogleSheet(opts: GoogleSheetImportOptions): Promise<{
  tableId: string; rowsImported: number; rowsSkipped: number; issues: DatabaseSyncIssue[];
}> {
  const tableName = assertIdent(opts.tableName, 'table');
  const token = await resolveGoogleToken(opts.workspaceId, opts.connectionOwnerUserId);
  const sheetName = opts.sheetName || await fetchFirstSheetName(token, opts.spreadsheetId);

  const { headers, rows } = await fetchSheetValues(token, opts.spreadsheetId, sheetName);
  if (headers.length === 0) throw new Error('The first row of the sheet is empty — add column headers before importing.');

  // Sanitize sheet headers to Postgres-safe identifiers. Handles spaces,
  // punctuation, leading digits, etc. Duplicates after sanitization get a
  // numeric suffix so we never collide.
  const seen = new Map<string, number>();
  const columnNames = headers.map((h, i) => {
    let n = sanitizeColumnName(h, i + 1);
    const count = seen.get(n) || 0;
    seen.set(n, count + 1);
    if (count > 0) n = `${n}_${count + 1}`;
    return n;
  });
  columnNames.forEach(c => assertIdent(c, 'column'));

  const columns: DatabaseColumn[] = columnNames.map((name, idx) => {
    const samples = rows.slice(0, 100).map(r => r[idx]);
    return { name, type: inferColumnType(samples), nullable: true };
  });

  let table = await getTableByName(opts.workspaceId, tableName);
  if (!table) {
    table = await createTable(opts.workspaceId, {
      name: tableName,
      description: opts.description,
      columns,
      sourceType: 'google_sheet',
      sourceConfig: {
        spreadsheet_id: opts.spreadsheetId,
        sheet_name: sheetName,
        sync_enabled: opts.syncEnabled,
        ignored_columns: [],
        column_mapping: {},
      },
      columnDescriptions: opts.columnDescriptions,
      createdBy: opts.createdBy,
    });
  } else {
    await updateSourceConfig(opts.workspaceId, table.id, {
      spreadsheet_id: opts.spreadsheetId,
      sheet_name: sheetName,
      sync_enabled: opts.syncEnabled,
    });
  }

  const res = await syncGoogleSheetInternal(opts.workspaceId, table.id, token);
  return { tableId: table.id, ...res };
}

export interface SyncResult {
  rowsImported: number;
  rowsSkipped: number;
  issues: DatabaseSyncIssue[];
  status: 'success' | 'partial_sync' | 'failed';
}

export async function syncGoogleSheet(
  workspaceId: string,
  tableId: string,
): Promise<SyncResult> {
  const t = await getTable(workspaceId, tableId);
  if (!t) throw new Error('Table not found');
  if (t.source_type !== 'google_sheet') throw new Error('Not a Google-Sheet-backed table.');
  const cfg = t.source_config || {};
  if (!cfg.spreadsheet_id) throw new Error('Table is missing its spreadsheet_id.');

  let token: string;
  try {
    token = await resolveGoogleToken(workspaceId, t.created_by || undefined);
  } catch (err: any) {
    const issues: DatabaseSyncIssue[] = [{ kind: 'auth_failed', message: err.message }];
    await logSyncResult(workspaceId, tableId, { status: 'failed', rowsImported: 0, rowsSkipped: 0, issues });
    await markSynced(workspaceId, tableId, 'failed');
    return { status: 'failed', rowsImported: 0, rowsSkipped: 0, issues };
  }

  const inner = await syncGoogleSheetInternal(workspaceId, tableId, token);
  return { ...inner, status: inner.status };
}

async function syncGoogleSheetInternal(
  workspaceId: string,
  tableId: string,
  token: string,
): Promise<SyncResult> {
  const t = await getTable(workspaceId, tableId);
  if (!t) throw new Error('Table not found');
  const cfg = t.source_config || {};
  const spreadsheetId = cfg.spreadsheet_id as string;
  const sheetName = (cfg.sheet_name as string) || await fetchFirstSheetName(token, spreadsheetId);
  const ignored = new Set<string>((cfg.ignored_columns as string[]) || []);
  const mapping: Record<string, string> = (cfg.column_mapping as Record<string, string>) || {};

  const { headers, rows } = await fetchSheetValues(token, spreadsheetId, sheetName);
  // Apply the same sanitization on sync as on import so headers map back to
  // the same Postgres column. (Without this, "Contract Signed?" wouldn't
  // match the previously-stored "contract_signed" and would surface as an
  // unmapped_column issue every cycle.)
  const sheetSeen = new Map<string, number>();
  const sheetHeaderNames = headers.map((h, i) => {
    let n = sanitizeColumnName(h, i + 1);
    const c = sheetSeen.get(n) || 0;
    sheetSeen.set(n, c + 1);
    if (c > 0) n = `${n}_${c + 1}`;
    return n;
  });

  // Map sheet columns → Postgres columns. column_mapping lets admins handle
  // renames ("foo_old" in Postgres, "foo_new" in the sheet).
  const describedCols = (await describeTable(workspaceId, t.name))?.columns || [];
  const pgColNames = new Set(describedCols.map(c => c.name));

  const issues: DatabaseSyncIssue[] = [];
  const mappedIndices: { sheetIdx: number; pgCol: string }[] = [];

  for (let i = 0; i < sheetHeaderNames.length; i++) {
    const raw = sheetHeaderNames[i];
    if (!raw) continue;
    if (ignored.has(raw)) continue;
    const target = mapping[raw] || raw;
    if (pgColNames.has(target)) {
      mappedIndices.push({ sheetIdx: i, pgCol: target });
    } else {
      issues.push({ kind: 'unmapped_column', column: raw });
    }
  }

  // Detect removed columns: in Postgres but not in the sheet (and not built-ins).
  const sheetHeaderSet = new Set(sheetHeaderNames.filter(h => h.length > 0));
  for (const col of describedCols) {
    if (['id', 'created_at', 'updated_at'].includes(col.name)) continue;
    const mappedFrom = Object.entries(mapping).find(([, pg]) => pg === col.name)?.[0];
    if (!sheetHeaderSet.has(col.name) && !(mappedFrom && sheetHeaderSet.has(mappedFrom))) {
      issues.push({ kind: 'removed_column', column: col.name });
    }
  }

  // Replace-all semantics: Google Sheet is the source of truth for its table.
  // We truncate and re-insert each sync. This is appropriate because the sheet
  // is the canonical copy and agents writing via the tool should target a
  // non-synced table.
  const tableName = assertIdent(t.name, 'table');
  let rowsImported = 0;
  let rowsSkipped = 0;

  await withWorkspaceClient(workspaceId, async (client) => {
    await client.query(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY`);

    const colOrder = mappedIndices.map(m => m.pgCol);
    const typeFor = new Map(describedCols.map(c => [c.name, c.type]));

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const values: any[] = [];
      let bad = false;
      for (const m of mappedIndices) {
        const raw = row[m.sheetIdx] ?? '';
        const type = typeFor.get(m.pgCol) || 'text';
        const coerced = coerceValue(raw, type);
        if (!coerced.ok) {
          issues.push({
            kind: 'row_type_mismatch',
            column: m.pgCol,
            row_index: ri + 2,
            value: String(raw).slice(0, 120),
            message: coerced.reason,
          });
          bad = true;
          break;
        }
        values.push(coerced.value);
      }
      if (bad) { rowsSkipped++; continue; }
      if (colOrder.length === 0) { rowsSkipped++; continue; }
      const placeholders = colOrder.map((_, i) => `$${i + 1}`).join(', ');
      const colList = colOrder.map(c => `"${c}"`).join(', ');
      await client.query(
        `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders})`,
        values,
      );
      rowsImported++;
    }
  });

  const status: 'success' | 'partial_sync' | 'failed' =
    issues.length === 0 ? 'success' : (rowsImported > 0 ? 'partial_sync' : 'failed');

  await logSyncResult(workspaceId, tableId, { status, rowsImported, rowsSkipped, issues });
  await markSynced(workspaceId, tableId, status);

  return { status, rowsImported, rowsSkipped, issues };
}

export { resolveGoogleToken };
