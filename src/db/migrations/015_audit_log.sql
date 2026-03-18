CREATE TABLE IF NOT EXISTS action_audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agent_name TEXT,
  tool_name TEXT,
  connection_id TEXT,
  target_user_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  run_id TEXT,
  trace_id TEXT,
  channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ws ON action_audit_log(workspace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_agent ON action_audit_log(agent_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON action_audit_log(actor_user_id, timestamp DESC);
