import { importCsv } from './csv';
import type { CsvImportResult } from './csv';

// We re-use the existing xlsx dependency used by KB parsers rather than
// forking a new one. The module is loaded lazily so environments without
// xlsx installed (e.g. slim test runs) don't pay the cost.
export interface XlsxImportOptions {
  workspaceId: string;
  tableName: string;
  buffer: Buffer;
  sheetName?: string;
  createdBy?: string;
  columnTypes?: Record<string, import('../../../types').DatabaseColumnType>;
}

export async function importXlsx(opts: XlsxImportOptions): Promise<CsvImportResult & { sheetName: string }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(opts.buffer, { type: 'buffer' });
  const sheetName = opts.sheetName && wb.SheetNames.includes(opts.sheetName)
    ? opts.sheetName
    : wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets.');
  const sheet = wb.Sheets[sheetName];
  const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });

  const result = await importCsv({
    workspaceId: opts.workspaceId,
    tableName: opts.tableName,
    csvText: csv,
    createdBy: opts.createdBy,
    columnTypes: opts.columnTypes,
  });

  return { ...result, sheetName };
}

export async function listSheetNames(buffer: Buffer): Promise<string[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.SheetNames;
}
