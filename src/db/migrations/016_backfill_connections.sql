-- Backfill connections table from existing custom_tools config_json
-- For each integration with non-empty config_json, create a team connection if none exists.
-- This ensures the new credential resolution system works for already-configured tools.

DO $$
DECLARE
  r RECORD;
  integration_id TEXT;
  ws_id TEXT;
  config_data TEXT;
  existing_conn_id TEXT;
BEGIN
  -- Process each custom tool that has config set
  FOR r IN
    SELECT DISTINCT ON (workspace_id, SPLIT_PART(name, '-', 1))
      workspace_id, name, config_json, registered_by
    FROM custom_tools
    WHERE config_json IS NOT NULL
      AND config_json != '{}'
      AND config_json != ''
    ORDER BY workspace_id, SPLIT_PART(name, '-', 1), created_at ASC
  LOOP
    integration_id := SPLIT_PART(r.name, '-', 1);
    ws_id := r.workspace_id;
    config_data := r.config_json;

    -- Check if a team connection already exists for this integration
    SELECT id INTO existing_conn_id
    FROM connections
    WHERE workspace_id = ws_id
      AND integration_id = integration_id
      AND connection_type = 'team'
      AND status = 'active'
    LIMIT 1;

    -- Only create if no team connection exists
    IF existing_conn_id IS NULL THEN
      -- NOTE: This stores config_json as-is (not encrypted).
      -- The application will need to re-encrypt these on first access.
      -- For now, we insert a placeholder that flags the record for re-encryption.
      INSERT INTO connections (id, workspace_id, integration_id, connection_type, user_id, label, credentials_encrypted, credentials_iv, created_by)
      VALUES (
        gen_random_uuid()::text,
        ws_id,
        integration_id,
        'team',
        NULL,
        integration_id || ' (migrated)',
        'NEEDS_RE_ENCRYPTION:' || config_data,
        'migrated',
        COALESCE(r.registered_by, 'system')
      )
      ON CONFLICT (workspace_id, integration_id) WHERE connection_type = 'team'
      DO NOTHING;
    END IF;
  END LOOP;
END $$;
