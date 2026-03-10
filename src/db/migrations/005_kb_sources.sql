-- KB API Keys: system-level API keys per provider (admin-managed via Slack)
CREATE TABLE IF NOT EXISTS kb_api_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,  -- 'google', 'zendesk', 'firecrawl', 'github', 'reducto'
  config_json TEXT NOT NULL DEFAULT '{}',
  setup_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- KB Sources: individual source connections
CREATE TABLE IF NOT EXISTS kb_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,  -- 'google_drive', 'zendesk_help_center', 'firecrawl', 'github', 'reducto'
  config_json TEXT NOT NULL DEFAULT '{}',  -- source-specific: URL, folder ID, repo, etc.
  status TEXT NOT NULL DEFAULT 'needs_setup',  -- 'active', 'syncing', 'error', 'needs_setup'
  auto_sync BOOLEAN NOT NULL DEFAULT FALSE,
  sync_interval_hours INTEGER NOT NULL DEFAULT 24,
  last_sync_at TIMESTAMPTZ,
  entry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link KB entries to their source
ALTER TABLE kb_entries ADD COLUMN IF NOT EXISTS kb_source_id TEXT REFERENCES kb_sources(id) ON DELETE SET NULL;

-- Update KBSourceType to include new source types
-- (handled in TypeScript types, not SQL)

CREATE INDEX IF NOT EXISTS idx_kb_sources_type ON kb_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_kb_sources_status ON kb_sources(status);
CREATE INDEX IF NOT EXISTS idx_kb_entries_source ON kb_entries(kb_source_id);
