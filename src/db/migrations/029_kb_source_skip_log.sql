-- ── Migration 029: Per-file KB source skip log ──
-- When a KB source sync skips a file (too large, corrupted, unsupported
-- format, Reducto failure, etc.) we record a structured row per (source,
-- file_path) so admins can see exactly which files didn't make it into the
-- knowledge base and why. The dashboard surfaces these on the KB source
-- detail page.
--
-- UNIQUE(kb_source_id, file_path) enforces upsert semantics: repeated skips
-- of the same file update last_seen_at / reason / message instead of piling
-- up duplicate rows. When a previously-skipped file successfully ingests on
-- a later sync, its row is deleted so the log reflects current state.
--
-- ON DELETE CASCADE — deleting a KB source cleans up its skip log.

CREATE TABLE IF NOT EXISTS kb_source_skip_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kb_source_id TEXT NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  reason TEXT NOT NULL,
  message TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_source_skip_log_source_path_idx
  ON kb_source_skip_log (kb_source_id, file_path);

CREATE INDEX IF NOT EXISTS kb_source_skip_log_workspace_idx
  ON kb_source_skip_log (workspace_id);
