-- Store full container JSONL output for trace reconstruction
ALTER TABLE run_history ADD COLUMN IF NOT EXISTS conversation_trace TEXT;

-- Per-invocation tool call tracking
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run_history(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id),
  tool_name TEXT NOT NULL,
  tool_input JSONB,
  tool_output TEXT,
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  sequence_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_ws_run ON tool_calls(workspace_id, run_id);
