import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import type { DatabaseSyncIssue, DatabaseSyncLogRecord, DatabaseSyncStatus } from '../../types';

export async function logSyncResult(
  workspaceId: string,
  tableId: string,
  result: {
    status: DatabaseSyncStatus;
    rowsImported: number;
    rowsSkipped: number;
    issues: DatabaseSyncIssue[];
  },
): Promise<void> {
  await execute(
    `INSERT INTO database_sync_log (id, workspace_id, table_id, status, rows_imported, rows_skipped, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      uuid(), workspaceId, tableId, result.status,
      result.rowsImported, result.rowsSkipped,
      JSON.stringify({ issues: result.issues }),
    ],
  );
}

export async function getLatestSyncLog(
  workspaceId: string,
  tableId: string,
): Promise<DatabaseSyncLogRecord | undefined> {
  return queryOne<DatabaseSyncLogRecord>(
    `SELECT * FROM database_sync_log
     WHERE workspace_id = $1 AND table_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [workspaceId, tableId],
  );
}

export async function listRecentSyncLogs(
  workspaceId: string,
  tableId: string,
  limit: number = 20,
): Promise<DatabaseSyncLogRecord[]> {
  return query<DatabaseSyncLogRecord>(
    `SELECT * FROM database_sync_log
     WHERE workspace_id = $1 AND table_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [workspaceId, tableId, limit],
  );
}
