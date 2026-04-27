-- ── Migration 031: Per-column descriptions for database_tables ──
-- Each table column can have a human/AI-authored description that's surfaced
-- to agents at runtime alongside the column type. The whole map lives on
-- database_tables so we can fetch everything for a table in one row.

ALTER TABLE database_tables
  ADD COLUMN IF NOT EXISTS column_descriptions JSONB NOT NULL DEFAULT '{}'::jsonb;
