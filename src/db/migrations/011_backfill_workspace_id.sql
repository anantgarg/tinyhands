-- ── Migration 011: Backfill workspace_id ──
-- This migration backfills workspace_id for existing data.
-- The workspace record must be created by the application before this runs.
-- On first startup, the app auto-creates a workspace from SLACK_BOT_TOKEN.
-- If no workspace exists yet, this migration is a no-op (columns remain nullable).
-- The app enforces NOT NULL at the application layer.

DO $$
DECLARE
  ws_id TEXT;
BEGIN
  SELECT id INTO ws_id FROM workspaces LIMIT 1;
  IF ws_id IS NULL THEN
    RAISE NOTICE 'No workspace found — skipping backfill. App will bootstrap on startup.';
    RETURN;
  END IF;

  UPDATE agents SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE agent_versions SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE run_history SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE sources SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE source_chunks SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE agent_memory SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE triggers SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE skills SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE agent_skills SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE kb_entries SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE kb_chunks SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE custom_tools SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE evolution_proposals SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE authored_skills SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE mcp_configs SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE code_artifacts SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE tool_versions SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE tool_runs SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE workflow_definitions SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE workflow_runs SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE side_effects_log SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE superadmins SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE agent_admins SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE team_runs SET workspace_id = ws_id WHERE workspace_id IS NULL;
  UPDATE sub_agent_runs SET workspace_id = ws_id WHERE workspace_id IS NULL;

  -- Tables that may not exist (from later migrations)
  BEGIN UPDATE agent_members SET workspace_id = ws_id WHERE workspace_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN UPDATE dm_conversations SET workspace_id = ws_id WHERE workspace_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN UPDATE pending_confirmations SET workspace_id = ws_id WHERE workspace_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN UPDATE kb_sources SET workspace_id = ws_id WHERE workspace_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN UPDATE kb_api_keys SET workspace_id = ws_id WHERE workspace_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; END;

  RAISE NOTICE 'Backfill complete: all rows assigned to workspace %', ws_id;
END $$;
