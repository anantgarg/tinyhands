/**
 * Per-file KB source skip log.
 *
 * The sync pipeline surfaces per-file failures here — too-large files,
 * corrupted documents, unsupported formats, Reducto fallbacks — so admins
 * can see exactly which files didn't make it in without scrolling through
 * free-text warning blobs. Upsert semantics by (kb_source_id, file_path)
 * keep the log as a view of *current state* rather than a historical audit
 * trail: when a file later ingests successfully, its row is deleted.
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { logger } from '../../utils/logger';

export type SkipReason =
  | 'too_large'
  | 'unsupported_format'
  | 'parser_failed'
  | 'reducto_failed'
  | 'corrupted'
  | 'download_failed'
  | 'empty_extraction';

export interface SkipLogEntry {
  id: string;
  workspace_id: string;
  kb_source_id: string;
  file_path: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  reason: SkipReason;
  message: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface RecordSkippedFileParams {
  workspaceId: string;
  kbSourceId: string;
  filePath: string;
  filename: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  reason: SkipReason;
  message: string;
}

export async function recordSkippedFile(params: RecordSkippedFileParams): Promise<void> {
  const id = uuid();
  try {
    await execute(
      `INSERT INTO kb_source_skip_log (
          id, workspace_id, kb_source_id, file_path, filename, mime_type,
          size_bytes, reason, message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (kb_source_id, file_path) DO UPDATE
          SET reason = EXCLUDED.reason,
              message = EXCLUDED.message,
              mime_type = EXCLUDED.mime_type,
              size_bytes = EXCLUDED.size_bytes,
              filename = EXCLUDED.filename,
              last_seen_at = NOW()`,
      [
        id, params.workspaceId, params.kbSourceId, params.filePath, params.filename,
        params.mimeType ?? null, params.sizeBytes ?? null, params.reason,
        truncateMessage(params.message),
      ],
    );
  } catch (err: any) {
    // Skip-log persistence failures must never abort a sync. Log and move on.
    logger.warn('Failed to record skipped-file entry', {
      kbSourceId: params.kbSourceId,
      filePath: params.filePath,
      error: err.message,
    });
  }
}

export async function clearSkippedFile(workspaceId: string, kbSourceId: string, filePath: string): Promise<void> {
  try {
    await execute(
      'DELETE FROM kb_source_skip_log WHERE workspace_id = $1 AND kb_source_id = $2 AND file_path = $3',
      [workspaceId, kbSourceId, filePath],
    );
  } catch (err: any) {
    logger.warn('Failed to clear skipped-file entry', { kbSourceId, filePath, error: err.message });
  }
}

export async function listSkippedFiles(workspaceId: string, kbSourceId: string): Promise<SkipLogEntry[]> {
  return query<SkipLogEntry>(
    `SELECT id, workspace_id, kb_source_id, file_path, filename, mime_type,
            size_bytes::bigint AS size_bytes, reason, message,
            first_seen_at, last_seen_at
       FROM kb_source_skip_log
      WHERE workspace_id = $1 AND kb_source_id = $2
      ORDER BY last_seen_at DESC
      LIMIT 1000`,
    [workspaceId, kbSourceId],
  );
}

export async function countSkippedFiles(workspaceId: string, kbSourceId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM kb_source_skip_log WHERE workspace_id = $1 AND kb_source_id = $2',
    [workspaceId, kbSourceId],
  );
  return row ? Number(row.count) : 0;
}

// Plain-English labels for the dashboard. The dashboard UX rule is "no
// jargon, no raw error strings" — this map is the single source of truth.
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  too_large: 'File too large to index',
  unsupported_format: 'File format not supported',
  parser_failed: 'Could not read the file contents',
  reducto_failed: 'Advanced parsing failed',
  corrupted: 'File appears to be corrupted',
  download_failed: 'Could not download from source',
  empty_extraction: 'No readable text was found in the file',
};

function truncateMessage(msg: string): string {
  // Keep the log row bounded; reasons should be short and admin-facing.
  if (msg.length <= 500) return msg;
  return msg.slice(0, 497) + '...';
}
