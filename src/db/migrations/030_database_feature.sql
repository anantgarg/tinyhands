-- ── Migration 030: Database feature — workspace-isolated tables ──
-- Adds two metadata tables for the new Database feature. The actual user
-- data lives in per-workspace Postgres schemas (ws_<workspaceId>) that are
-- created lazily the first time an admin creates a table in a workspace.
--
-- database_tables — one row per table an admin has created in the workspace.
--   source_type: 'manual' | 'csv' | 'xlsx' | 'google_sheet'
--   source_config (JSONB): for google_sheet contains { spreadsheet_id,
--     sheet_name, sync_enabled, ignored_columns: [], column_mapping: {} }.
--   UNIQUE(workspace_id, name) — no duplicate names within a workspace.
--
-- database_sync_log — append-only record of imports and Google-Sheet sync
-- cycles. Status is one of: 'success', 'partial_sync', 'failed'. Details
-- (JSONB) describe what was skipped/failed so the dashboard can render the
-- warning triangle + resolution drawer. We keep all rows; the dashboard
-- queries the most recent per table.
--
-- ON DELETE CASCADE — deleting a table or workspace cleans up its logs.

CREATE TABLE IF NOT EXISTS database_tables (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS database_tables_workspace_name_idx
  ON database_tables (workspace_id, name);

CREATE INDEX IF NOT EXISTS database_tables_workspace_idx
  ON database_tables (workspace_id);

CREATE TABLE IF NOT EXISTS database_sync_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES database_tables(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS database_sync_log_table_idx
  ON database_sync_log (table_id, created_at DESC);

CREATE INDEX IF NOT EXISTS database_sync_log_workspace_idx
  ON database_sync_log (workspace_id);
