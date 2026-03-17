-- ── Migration 010: Workspaces & Multi-Tenancy ──
-- Adds workspaces table and workspace_id column to all existing tables.
-- Column is added as NULLABLE first; backfill + NOT NULL in migration 011.

-- ── Workspaces Table ──

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  domain TEXT,
  bot_token TEXT NOT NULL,
  bot_user_id TEXT NOT NULL,
  bot_id TEXT,
  app_id TEXT,
  authed_user_id TEXT,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Add workspace_id to all tables ──

-- agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_agents_ws ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agents_ws_channel ON agents(workspace_id, channel_id);

-- agent_versions
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- run_history
ALTER TABLE run_history ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_run_history_ws ON run_history(workspace_id);
CREATE INDEX IF NOT EXISTS idx_run_history_ws_agent ON run_history(workspace_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_run_history_ws_created ON run_history(workspace_id, created_at);

-- sources
ALTER TABLE sources ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_sources_ws ON sources(workspace_id);

-- source_chunks
ALTER TABLE source_chunks ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- agent_memory
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- triggers
ALTER TABLE triggers ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_triggers_ws ON triggers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_triggers_ws_agent ON triggers(workspace_id, agent_id);

-- skills
ALTER TABLE skills ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_skills_ws ON skills(workspace_id);

-- agent_skills
ALTER TABLE agent_skills ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- kb_entries
ALTER TABLE kb_entries ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_kb_entries_ws ON kb_entries(workspace_id);

-- kb_chunks
ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- custom_tools
ALTER TABLE custom_tools ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_custom_tools_ws ON custom_tools(workspace_id);

-- evolution_proposals
ALTER TABLE evolution_proposals ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- authored_skills
ALTER TABLE authored_skills ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- mcp_configs
ALTER TABLE mcp_configs ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- code_artifacts
ALTER TABLE code_artifacts ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- tool_versions
ALTER TABLE tool_versions ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- tool_runs
ALTER TABLE tool_runs ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- workflow_definitions
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- workflow_runs
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- side_effects_log
ALTER TABLE side_effects_log ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- superadmins
ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS idx_superadmins_ws ON superadmins(workspace_id);

-- agent_admins
ALTER TABLE agent_admins ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- agent_members (from migration 009)
DO $$ BEGIN
  ALTER TABLE agent_members ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- dm_conversations (from migration 009)
DO $$ BEGIN
  ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
  CREATE INDEX IF NOT EXISTS idx_dm_conversations_ws ON dm_conversations(workspace_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- pending_confirmations (from migration 002)
DO $$ BEGIN
  ALTER TABLE pending_confirmations ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- kb_sources (from migration 005)
DO $$ BEGIN
  ALTER TABLE kb_sources ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
  CREATE INDEX IF NOT EXISTS idx_kb_sources_ws ON kb_sources(workspace_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- kb_api_keys (from migration 005)
DO $$ BEGIN
  ALTER TABLE kb_api_keys ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- team_runs
ALTER TABLE team_runs ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- sub_agent_runs
ALTER TABLE sub_agent_runs ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

-- ── Update unique constraints for multi-tenancy ──
-- These will be enforced after backfill in migration 011
