import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL ||
      'postgresql://doadmin:AVNS_9nKZ4q_jVa_91LO7h5R@private-dbaas-db-1775877-do-user-5103356-0.c.db.ondigitalocean.com:25060/tinyjobs?sslmode=require';

    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected PG pool error', { error: err.message });
    });
  }
  return pool;
}

export async function query(text: string, params?: any[]): Promise<any> {
  const p = getPool();
  return p.query(text, params);
}

export async function getClient(): Promise<PoolClient> {
  const p = getPool();
  return p.connect();
}

export async function initializeSchema(): Promise<void> {
  const p = getPool();

  await p.query(`
    -- ── Module 1: Agent Management ──

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      channel_id TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      tools TEXT NOT NULL DEFAULT '[]',
      avatar_emoji TEXT NOT NULL DEFAULT ':robot_face:',
      status TEXT NOT NULL DEFAULT 'active',
      model TEXT NOT NULL DEFAULT 'sonnet',
      streaming_detail BOOLEAN NOT NULL DEFAULT true,
      docker_image TEXT,
      self_evolution_mode TEXT NOT NULL DEFAULT 'autonomous',
      max_turns INTEGER NOT NULL DEFAULT 50,
      memory_enabled BOOLEAN NOT NULL DEFAULT false,
      permission_level TEXT NOT NULL DEFAULT 'standard',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS agent_versions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      system_prompt TEXT NOT NULL,
      change_note TEXT NOT NULL DEFAULT '',
      changed_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_versions_agent ON agent_versions(agent_id, version);

    -- ── Module 2: Task Execution ──

    CREATE TABLE IF NOT EXISTS run_history (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      queue_wait_ms INTEGER NOT NULL DEFAULT 0,
      context_tokens_injected INTEGER NOT NULL DEFAULT 0,
      tool_calls_count INTEGER NOT NULL DEFAULT 0,
      trace_id TEXT NOT NULL,
      job_id TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'sonnet',
      slack_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_run_history_agent ON run_history(agent_id);
    CREATE INDEX IF NOT EXISTS idx_run_history_trace ON run_history(trace_id);
    CREATE INDEX IF NOT EXISTS idx_run_history_created ON run_history(created_at);

    -- ── Module 4: Source Connections ──

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      uri TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_sync_at TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_sources_agent ON sources(agent_id);

    CREATE TABLE IF NOT EXISTS source_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      search_vector tsvector
    );

    CREATE INDEX IF NOT EXISTS idx_source_chunks_source ON source_chunks(source_id);
    CREATE INDEX IF NOT EXISTS idx_source_chunks_agent ON source_chunks(agent_id);
    CREATE INDEX IF NOT EXISTS idx_source_chunks_fts ON source_chunks USING GIN(search_vector);

    -- ── Module 4b: Agent Memory ──

    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL,
      fact TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      relevance_score REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      search_vector tsvector
    );

    CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_fts ON agent_memory USING GIN(search_vector);

    -- ── Module 5: Event Triggers ──

    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_triggers_agent ON triggers(agent_id);

    -- ── Module 6: Skills ──

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      skill_type TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      permission_level TEXT NOT NULL DEFAULT 'read',
      attached_by TEXT NOT NULL,
      attached_at TEXT NOT NULL DEFAULT (NOW()::text),
      PRIMARY KEY (agent_id, skill_id)
    );

    -- ── Module 7: Knowledge Base ──

    CREATE TABLE IF NOT EXISTS kb_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      access_scope TEXT NOT NULL DEFAULT '"all"',
      source_type TEXT NOT NULL DEFAULT 'manual',
      contributed_by TEXT,
      approved BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS kb_chunks (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES kb_entries(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      search_vector tsvector
    );

    CREATE INDEX IF NOT EXISTS idx_kb_chunks_fts ON kb_chunks USING GIN(search_vector);

    -- ── Module 11: Custom Tools ──

    CREATE TABLE IF NOT EXISTS custom_tools (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      tool_type TEXT NOT NULL DEFAULT 'custom',
      schema_json TEXT NOT NULL DEFAULT '{}',
      script_code TEXT,
      script_path TEXT,
      language TEXT NOT NULL DEFAULT 'javascript',
      registered_by TEXT NOT NULL,
      approved BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    -- ── Module 16: Self-Evolution ──

    CREATE TABLE IF NOT EXISTS evolution_proposals (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      diff TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      resolved_at TEXT
    );

    -- ── Module 20: Authored Skills ──

    CREATE TABLE IF NOT EXISTS authored_skills (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      skill_type TEXT NOT NULL DEFAULT 'prompt_template',
      template TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      approved BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_authored_skills_agent ON authored_skills(agent_id);

    -- ── Module 21: MCP Configs (DB-stored) ──

    CREATE TABLE IF NOT EXISTS mcp_configs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      approved BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_configs_agent_name ON mcp_configs(agent_id, name);

    -- ── Module 22: Code Artifacts (DB-stored agent-written files) ──

    CREATE TABLE IF NOT EXISTS code_artifacts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'text',
      proposal_id TEXT REFERENCES evolution_proposals(id),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_code_artifacts_agent ON code_artifacts(agent_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_code_artifacts_path ON code_artifacts(agent_id, file_path);

    -- ── Module 23: Tool Versioning ──

    CREATE TABLE IF NOT EXISTS tool_versions (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      version INTEGER NOT NULL,
      script_code TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'javascript',
      changed_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_tool_versions_name ON tool_versions(tool_name, version);

    -- ── Module 24: Tool Analytics ──

    CREATE TABLE IF NOT EXISTS tool_runs (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      success BOOLEAN NOT NULL DEFAULT true,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_tool_runs_name ON tool_runs(tool_name);
    CREATE INDEX IF NOT EXISTS idx_tool_runs_agent ON tool_runs(agent_id);

    -- ── Module 15: Workflows ──

    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      steps_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id),
      run_id TEXT NOT NULL,
      current_step INTEGER NOT NULL DEFAULT 0,
      step_state TEXT NOT NULL DEFAULT '{}',
      waiting_for TEXT,
      wait_until TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);

    CREATE TABLE IF NOT EXISTS side_effects_log (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      step_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      effect_type TEXT NOT NULL,
      effect_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_side_effects_unique
      ON side_effects_log(workflow_run_id, step_id, effect_type);

    -- ── Module 17: Access Control ──

    CREATE TABLE IF NOT EXISTS superadmins (
      user_id TEXT PRIMARY KEY,
      granted_by TEXT NOT NULL DEFAULT 'system',
      granted_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS agent_admins (
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      granted_by TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (NOW()::text),
      PRIMARY KEY (agent_id, user_id)
    );

    -- ── Module 19: Agent Teams ──

    CREATE TABLE IF NOT EXISTS team_runs (
      id TEXT PRIMARY KEY,
      lead_agent_id TEXT NOT NULL REFERENCES agents(id),
      lead_run_id TEXT NOT NULL,
      max_concurrent INTEGER NOT NULL DEFAULT 3,
      max_depth INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS sub_agent_runs (
      id TEXT PRIMARY KEY,
      team_run_id TEXT NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      depth INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'queued',
      task TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );
  `);

  // Create triggers for auto-updating tsvector columns
  await p.query(`
    CREATE OR REPLACE FUNCTION source_chunks_search_vector_update() RETURNS trigger AS $$
    BEGIN
      NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.file_path, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS source_chunks_search_vector_trigger ON source_chunks;
    CREATE TRIGGER source_chunks_search_vector_trigger
      BEFORE INSERT OR UPDATE ON source_chunks
      FOR EACH ROW EXECUTE FUNCTION source_chunks_search_vector_update();

    CREATE OR REPLACE FUNCTION agent_memory_search_vector_update() RETURNS trigger AS $$
    BEGIN
      NEW.search_vector := to_tsvector('english', COALESCE(NEW.fact, '') || ' ' || COALESCE(NEW.category, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS agent_memory_search_vector_trigger ON agent_memory;
    CREATE TRIGGER agent_memory_search_vector_trigger
      BEFORE INSERT OR UPDATE ON agent_memory
      FOR EACH ROW EXECUTE FUNCTION agent_memory_search_vector_update();

    CREATE OR REPLACE FUNCTION kb_chunks_search_vector_update() RETURNS trigger AS $$
    BEGIN
      NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS kb_chunks_search_vector_trigger ON kb_chunks;
    CREATE TRIGGER kb_chunks_search_vector_trigger
      BEFORE INSERT OR UPDATE ON kb_chunks
      FOR EACH ROW EXECUTE FUNCTION kb_chunks_search_vector_update();
  `);

  // Backfill search vectors for any existing rows
  await p.query(`
    UPDATE source_chunks SET search_vector = to_tsvector('english', COALESCE(content, '') || ' ' || COALESCE(file_path, ''))
    WHERE search_vector IS NULL;

    UPDATE agent_memory SET search_vector = to_tsvector('english', COALESCE(fact, '') || ' ' || COALESCE(category, ''))
    WHERE search_vector IS NULL;

    UPDATE kb_chunks SET search_vector = to_tsvector('english', COALESCE(content, ''))
    WHERE search_vector IS NULL;
  `);
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
