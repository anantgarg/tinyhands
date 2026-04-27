export {
  schemaFor, assertIdent, sanitizeColumnName, ensureSchemaExists, dropSchemaIfEmpty,
  listPhysicalColumns, listPhysicalTables, withWorkspaceClient,
} from './schema';
export {
  listTables, getTable, getTableByName, createTable, deleteTable,
  addColumn, renameColumn, dropColumn, describeTable,
  updateSourceConfig, markSynced, sqlTypeFor, sqlToLogicalType,
  setTableDescription, setColumnDescription,
} from './tables';
export {
  selectRows, insertRow, updateRow, deleteRow, aggregate,
} from './rows';
export { runReadOnlySql, validateReadOnly, SqlReadOnlyError } from './sql';
export { importCsv, parseCsv } from './imports/csv';
export { importXlsx, listSheetNames } from './imports/xlsx';
export { importGoogleSheet, syncGoogleSheet } from './imports/google-sheets';
export { inferColumnType, coerceValue } from './imports/infer';
export { logSyncResult, getLatestSyncLog, listRecentSyncLogs } from './sync-log';
export { suggestTableMetadata } from './ai-metadata';
export type { SuggestedMetadata } from './ai-metadata';

// List Google-Sheet-backed tables that should be re-synced now. Called from
// the sync process on a 5-minute interval (same cadence as KB auto-sync).
import { query } from '../../db';
import type { DatabaseTable } from '../../types';

export async function getSheetTablesDueForSync(): Promise<DatabaseTable[]> {
  return query<DatabaseTable>(
    `SELECT * FROM database_tables
     WHERE source_type = 'google_sheet'
       AND (source_config->>'sync_enabled')::boolean = true
       AND (
         last_synced_at IS NULL
         OR last_synced_at < NOW() - INTERVAL '5 minutes'
       )`,
  );
}
