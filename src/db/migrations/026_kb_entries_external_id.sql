-- Migration 026: source_external_id on kb_entries.
--
-- KB sync previously used append-only inserts, which meant editing a file in
-- the source system created a duplicate KB entry, deleting a file left the
-- stale entry in place, and changing a source's folder mixed old and new
-- content. Adding a stable external ID per source row lets sync upsert by
-- that ID and tombstone anything that didn't appear in the latest crawl.

ALTER TABLE kb_entries
  ADD COLUMN IF NOT EXISTS source_external_id TEXT;

-- Partial unique index so entries NOT sourced from a connector (manual,
-- conversation, etc.) aren't subject to the uniqueness constraint.
CREATE UNIQUE INDEX IF NOT EXISTS kb_entries_source_external_uniq
  ON kb_entries (workspace_id, kb_source_id, source_external_id)
  WHERE kb_source_id IS NOT NULL AND source_external_id IS NOT NULL;
