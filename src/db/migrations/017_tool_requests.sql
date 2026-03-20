-- Tool access requests: users request to add tools to agents, admins approve/deny
CREATE TABLE IF NOT EXISTS tool_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'read-only',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL,
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tool_requests_workspace ON tool_requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tool_requests_agent ON tool_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_tool_requests_status ON tool_requests(workspace_id, status);
