CREATE TABLE IF NOT EXISTS upgrade_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  requested_role TEXT NOT NULL DEFAULT 'member',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_upgrade_requests_agent ON upgrade_requests(agent_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_upgrade_requests_pending
  ON upgrade_requests(agent_id, user_id) WHERE status = 'pending';
