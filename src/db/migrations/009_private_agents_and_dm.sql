-- Private agents: visibility + member access control
ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';

CREATE TABLE IF NOT EXISTS agent_members (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, user_id)
);

-- DM conversations: maps DM threads to agents
CREATE TABLE IF NOT EXISTS dm_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  dm_channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dm_conversations_thread ON dm_conversations (dm_channel_id, thread_ts);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user ON dm_conversations (user_id, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_members_user ON agent_members (user_id);
