-- ── Migration 032: Web Chat channels ──
-- Lets an admin expose an agent as a password-protected public chat page.
-- A web chat is reachable at /chat/<public_token> with no Slack or dashboard
-- login — visitors authenticate with a shared username/password set by the
-- admin on the Channels page.
--
-- web_chat_channels — one row per web chat. The visitor password is AES-GCM
--   encrypted (auth_password_encrypted + auth_password_iv) so the admin can
--   read it back to re-share it. public_token is the random URL segment.
-- web_chat_sessions — one row per visitor conversation.
-- web_chat_messages — the user/assistant turns within a session; assistant
--   rows carry the trace_id of the run_history row that produced them.

CREATE TABLE IF NOT EXISTS web_chat_channels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  auth_username TEXT NOT NULL,
  auth_password_encrypted TEXT NOT NULL,
  auth_password_iv TEXT NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_web_chat_channels_token ON web_chat_channels(public_token);
CREATE INDEX IF NOT EXISTS idx_web_chat_channels_ws ON web_chat_channels(workspace_id);

CREATE TABLE IF NOT EXISTS web_chat_sessions (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES web_chat_channels(id) ON DELETE CASCADE,
  visitor_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_chat_sessions_channel ON web_chat_sessions(channel_id);

CREATE TABLE IF NOT EXISTS web_chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES web_chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_chat_messages_session ON web_chat_messages(session_id);
