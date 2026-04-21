-- ── Migration 025: Per-workspace OAuth app credentials ──
-- Stores each workspace's own OAuth client credentials (client_id +
-- encrypted client_secret) for third-party providers (Google today;
-- Notion and GitHub reserved for a follow-up plan). Replaces the single
-- platform-owned OAuth app model — the platform no longer owns a Google
-- OAuth identity.

CREATE TABLE IF NOT EXISTS workspace_oauth_apps (
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,                          -- 'google' | 'notion' | 'github'
  client_id TEXT NOT NULL,                         -- not secret on its own; plaintext for debuggability
  client_secret_encrypted TEXT NOT NULL,           -- AES-GCM ciphertext + auth tag (see modules/connections/crypto)
  client_secret_iv TEXT NOT NULL,                  -- AES-GCM IV (hex)
  publishing_status TEXT,                          -- 'internal' | 'external_testing' | 'external_production' | NULL
  configured_by_user_id TEXT,
  configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_workspace_oauth_apps_provider
  ON workspace_oauth_apps(provider);
