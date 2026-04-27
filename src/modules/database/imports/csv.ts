import { createTable, getTableByName, addColumn, describeTable } from '../tables';
import { insertRow } from '../rows';
import { logSyncResult } from '../sync-log';
import { inferColumnType, coerceValue } from './infer';
import { assertIdent, sanitizeColumnName } from '../schema';
import type { DatabaseColumn, DatabaseSyncIssue } from '../../../types';

// Minimal in-process CSV parser. Supports RFC 4180 basics: quoted fields,
// escaped quotes, embedded commas/newlines inside quotes. Good enough for
// admin-uploaded spreadsheets; we don't stream because imports are bounded
// by the admin upload size limit (enforced at the Express layer).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  // Drop trailing empty rows
  while (rows.length > 0 && rows[rows.length - 1].every(f => f === '')) rows.pop();
  return rows;
}

export interface CsvImportOptions {
  workspaceId: string;
  tableName: string;
  csvText: string;
  createdBy?: string;
  columnTypes?: Record<string, import('../../../types').DatabaseColumnType>;
}

export interface CsvImportResult {
  tableId: string;
  rowsImported: number;
  rowsSkipped: number;
  issues: DatabaseSyncIssue[];
}

export async function importCsv(opts: CsvImportOptions): Promise<CsvImportResult> {
  const parsed = parseCsv(opts.csvText);
  if (parsed.length === 0) {
    throw new Error('The CSV file is empty.');
  }
  const [header, ...dataRows] = parsed;
  if (!header || header.length === 0) throw new Error('CSV header row is empty.');

  const seen = new Map<string, number>();
  const columnNames = header.map((h, i) => {
    let n = sanitizeColumnName(h, i + 1);
    const c = seen.get(n) || 0;
    seen.set(n, c + 1);
    if (c > 0) n = `${n}_${c + 1}`;
    return n;
  });
  columnNames.forEach(c => assertIdent(c, 'column'));

  // Infer types per column unless the admin provided explicit types.
  const columns: DatabaseColumn[] = columnNames.map((name, idx) => {
    const samples = dataRows.slice(0, 100).map(r => r[idx]);
    const type = opts.columnTypes?.[name] ?? inferColumnType(samples);
    return { name, type, nullable: true };
  });

  const tableName = assertIdent(opts.tableName, 'table');
  let existing = await getTableByName(opts.workspaceId, tableName);
  if (!existing) {
    existing = await createTable(opts.workspaceId, {
      name: tableName,
      columns,
      sourceType: 'csv',
      createdBy: opts.createdBy,
    });
  } else {
    // Augment the existing table with any columns the CSV introduces.
    const descr = await describeTable(opts.workspaceId, tableName);
    const existingCols = new Set((descr?.columns || []).map(c => c.name));
    for (const col of columns) {
      if (!existingCols.has(col.name)) {
        await addColumn(opts.workspaceId, existing.id, col);
      }
    }
  }

  let rowsImported = 0;
  let rowsSkipped = 0;
  const issues: DatabaseSyncIssue[] = [];

  for (let ri = 0; ri < dataRows.length; ri++) {
    const row = dataRows[ri];
    const values: Record<string, any> = {};
    let bad = false;
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const raw = row[ci];
      const coerced = coerceValue(raw, col.type);
      if (!coerced.ok) {
        issues.push({
          kind: 'row_type_mismatch',
          column: col.name,
          row_index: ri + 2, // +1 for 0-index, +1 for header
          value: String(raw).slice(0, 120),
          message: coerced.reason,
        });
        bad = true;
        break;
      }
      values[col.name] = coerced.value;
    }
    if (bad) { rowsSkipped++; continue; }
    try {
      await insertRow(opts.workspaceId, tableName, values);
      rowsImported++;
    } catch (err: any) {
      rowsSkipped++;
      issues.push({ kind: 'row_type_mismatch', row_index: ri + 2, message: err.message });
    }
  }

  const status = rowsSkipped === 0 ? 'success' : (rowsImported > 0 ? 'partial_sync' : 'failed');
  await logSyncResult(opts.workspaceId, existing.id, {
    status, rowsImported, rowsSkipped, issues,
  });

  return { tableId: existing.id, rowsImported, rowsSkipped, issues };
}
