-- ── Migration 033: WhatsApp channels ──
-- Lets an admin expose an agent over WhatsApp, via Twilio. A WhatsApp channel
-- binds one Twilio WhatsApp-enabled sender number to one agent. Access is by
-- phone number: only numbers on the channel's allowlist may message the agent.
--
-- whatsapp_channels — one row per WhatsApp sender number. The Twilio auth token
--   is AES-GCM encrypted (twilio_auth_token_encrypted + twilio_auth_token_iv)
--   so it can be read back to call Twilio and verify inbound signatures.
-- whatsapp_allowed_numbers — the allowlist; many rows per channel, each an
--   E.164 phone number permitted to message the channel.
-- whatsapp_sessions — one row per visitor conversation, keyed by the visitor's
--   E.164 phone number.
-- whatsapp_messages — the user/assistant turns within a session. Each row
--   records its Twilio message SID so a later WhatsApp reply that quotes it can
--   be traced back to the stored turn (Slack-style reply threads).

CREATE TABLE IF NOT EXISTS whatsapp_channels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  twilio_account_sid TEXT NOT NULL,
  twilio_auth_token_encrypted TEXT NOT NULL,
  twilio_auth_token_iv TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_channels_number ON whatsapp_channels(whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_channels_ws ON whatsapp_channels(workspace_id);

CREATE TABLE IF NOT EXISTS whatsapp_allowed_numbers (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_allowed_numbers_channel ON whatsapp_allowed_numbers(channel_id);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  visitor_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_channel_visitor
  ON whatsapp_sessions(channel_id, visitor_number);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  trace_id TEXT,
  twilio_message_sid TEXT,
  reply_to_message_id TEXT REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_session ON whatsapp_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_twilio_sid ON whatsapp_messages(twilio_message_sid);
