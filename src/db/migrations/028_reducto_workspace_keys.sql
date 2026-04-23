-- ── Migration 028: Reducto per-workspace key + per-file sync warnings ──
-- Reducto is an optional high-fidelity document parser for KB source sync
-- (primarily PDFs and scanned docs). Admins opt in per workspace by pasting
-- an API key and enabling the toggle in Settings → Document Parsing.
--
-- Reducto storage uses the existing workspace_settings key/value table
-- (migration 012) with three keys:
--   reducto_api_key    — AES-256-GCM ciphertext + auth tag (hex.hex)
--   reducto_api_key_iv — 12-byte hex IV for the above
--   reducto_enabled    — 'true' | 'false' (only 'true' actually sends bytes
--                         to the vendor, even if a key is present)
--
-- This migration also adds a per-source warnings column so KB source syncs
-- can surface non-fatal per-file issues (unsupported legacy formats,
-- corrupt Office files, Reducto fallbacks, etc.) without using the
-- error_message column that is reserved for fatal sync failures. The
-- structured per-file skip log lives in the separate kb_source_skip_log
-- table (migration 029).

ALTER TABLE kb_sources
  ADD COLUMN IF NOT EXISTS last_sync_warnings TEXT;
