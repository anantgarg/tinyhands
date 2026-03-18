CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  integration_id TEXT NOT NULL,
  connection_type TEXT NOT NULL,
  user_id TEXT,
  label TEXT NOT NULL DEFAULT '',
  credentials_encrypted TEXT NOT NULL,
  credentials_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  oauth_refresh_token_encrypted TEXT,
  oauth_token_expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_connections_ws ON connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(workspace_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_team_unique
  ON connections(workspace_id, integration_id) WHERE connection_type = 'team';
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_personal_unique
  ON connections(workspace_id, integration_id, user_id) WHERE connection_type = 'personal';

CREATE TABLE IF NOT EXISTS agent_tool_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  connection_mode TEXT NOT NULL,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  configured_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tool_conn_unique
  ON agent_tool_connections(agent_id, tool_name);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  redirect_channel_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);
