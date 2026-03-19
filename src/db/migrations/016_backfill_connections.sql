-- Backfill connections table from existing custom_tools config_json
-- For each integration with non-empty config_json, create a team connection if none exists.
-- This ensures the new credential resolution system works for already-configured tools.

DO $$
DECLARE
  r RECORD;
  v_integration_id TEXT;
  v_ws_id TEXT;
  v_config_data TEXT;
  v_existing_conn_id TEXT;
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
    v_integration_id := SPLIT_PART(r.name, '-', 1);
    v_ws_id := r.workspace_id;
    v_config_data := r.config_json;

    -- Check if a team connection already exists for this integration
    SELECT c.id INTO v_existing_conn_id
    FROM connections c
    WHERE c.workspace_id = v_ws_id
      AND c.integration_id = v_integration_id
      AND c.connection_type = 'team'
      AND c.status = 'active'
    LIMIT 1;

    -- Only create if no team connection exists
    IF v_existing_conn_id IS NULL THEN
      INSERT INTO connections (id, workspace_id, integration_id, connection_type, user_id, label, credentials_encrypted, credentials_iv, created_by)
      VALUES (
        gen_random_uuid()::text,
        v_ws_id,
        v_integration_id,
        'team',
        NULL,
        v_integration_id || ' (migrated)',
        'NEEDS_RE_ENCRYPTION:' || v_config_data,
        'migrated',
        COALESCE(r.registered_by, 'system')
      )
      ON CONFLICT (workspace_id, integration_id) WHERE connection_type = 'team'
      DO NOTHING;
    END IF;
  END LOOP;
END $$;
