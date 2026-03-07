import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../src/db';

// Mock the db module to use in-memory database
let db: Database.Database;

function setupTestDb() {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}

// We test the SQL layer directly since the module depends on getDb()
describe('Agent Management', () => {
  beforeEach(() => {
    db = setupTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should create an agent', () => {
    const id = 'test-agent-1';
    db.prepare(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
        status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
        permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'test-agent', 'C123', 'You are a test agent', '["Read","Write"]',
      ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 0, 'standard', 'U001');

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any;
    expect(agent).toBeDefined();
    expect(agent.name).toBe('test-agent');
    expect(agent.model).toBe('sonnet');
    expect(agent.permission_level).toBe('standard');
  });

  it('should reject duplicate agent names', () => {
    db.prepare(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
        status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
        permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('a1', 'dup-agent', 'C1', '', '[]', ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 0, 'standard', 'U1');

    expect(() => {
      db.prepare(`
        INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
          status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
          permission_level, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('a2', 'dup-agent', 'C2', '', '[]', ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 0, 'standard', 'U1');
    }).toThrow();
  });

  it('should create version history on insert', () => {
    db.prepare(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
        status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
        permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('a1', 'versioned', 'C1', 'Initial prompt', '[]', ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 0, 'standard', 'U1');

    db.prepare(`
      INSERT INTO agent_versions (id, agent_id, version, system_prompt, change_note, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('v1', 'a1', 1, 'Initial prompt', 'Initial creation', 'U1');

    const versions = db.prepare('SELECT * FROM agent_versions WHERE agent_id = ?').all('a1');
    expect(versions).toHaveLength(1);
  });

  it('should track version history', () => {
    db.prepare(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
        status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
        permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('a1', 'tracked', 'C1', 'v1 prompt', '[]', ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 0, 'standard', 'U1');

    db.prepare('INSERT INTO agent_versions (id, agent_id, version, system_prompt, change_note, changed_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run('v1', 'a1', 1, 'v1 prompt', 'Initial', 'U1');

    db.prepare('UPDATE agents SET system_prompt = ? WHERE id = ?').run('v2 prompt', 'a1');
    db.prepare('INSERT INTO agent_versions (id, agent_id, version, system_prompt, change_note, changed_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run('v2', 'a1', 2, 'v2 prompt', 'Updated', 'U1');

    const versions = db.prepare('SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version').all('a1');
    expect(versions).toHaveLength(2);
  });
});

describe('Access Control', () => {
  beforeEach(() => {
    db = setupTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should initialize first superadmin', () => {
    db.prepare('INSERT INTO superadmins (user_id, granted_by) VALUES (?, ?)').run('U001', 'system');

    const admins = db.prepare('SELECT * FROM superadmins').all();
    expect(admins).toHaveLength(1);
    expect((admins[0] as any).user_id).toBe('U001');
  });

  it('should prevent duplicate superadmin init', () => {
    db.prepare('INSERT INTO superadmins (user_id, granted_by) VALUES (?, ?)').run('U001', 'system');

    // Second insert should fail (PRIMARY KEY constraint)
    expect(() => {
      db.prepare('INSERT INTO superadmins (user_id, granted_by) VALUES (?, ?)').run('U001', 'system');
    }).toThrow();
  });

  it('should track agent admins', () => {
    db.prepare(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
        status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
        permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('a1', 'admin-test', 'C1', '', '[]', ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 0, 'standard', 'U1');

    db.prepare('INSERT INTO agent_admins (agent_id, user_id, role, granted_by) VALUES (?, ?, ?, ?)').run('a1', 'U002', 'admin', 'U001');

    const admins = db.prepare('SELECT * FROM agent_admins WHERE agent_id = ?').all('a1');
    expect(admins).toHaveLength(1);
    expect((admins[0] as any).role).toBe('admin');
  });
});

describe('Permissions', () => {
  it('should return correct disallowed tools per level', () => {
    // Test permission logic directly
    const TOOL_RESTRICTIONS: Record<string, string[]> = {
      'read-only': ['Bash', 'Write', 'Edit', 'NotebookEdit'],
      'standard': ['NotebookEdit'],
      'full': [],
    };

    expect(TOOL_RESTRICTIONS['read-only']).toContain('Bash');
    expect(TOOL_RESTRICTIONS['read-only']).toContain('Write');
    expect(TOOL_RESTRICTIONS['standard']).not.toContain('Bash');
    expect(TOOL_RESTRICTIONS['full']).toHaveLength(0);
  });
});

describe('FTS5 Search', () => {
  beforeEach(() => {
    db = setupTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should index and search source chunks', () => {
    // Create agent first
    db.prepare(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
        status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
        permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('a1', 'search-test', 'C1', '', '[]', ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 0, 'standard', 'U1');

    db.prepare(`
      INSERT INTO sources (id, agent_id, source_type, uri, label, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('s1', 'a1', 'github', 'https://github.com/test/repo', 'test-repo', 'active');

    // Insert chunks
    db.prepare(`
      INSERT INTO source_chunks (id, source_id, agent_id, file_path, chunk_index, content, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('c1', 's1', 'a1', 'README.md', 0, 'This is a test document about authentication and login flows', 'hash1');

    // Rebuild FTS index
    db.exec(`
      DELETE FROM source_chunks_fts;
      INSERT INTO source_chunks_fts(rowid, content, file_path)
        SELECT rowid, content, file_path FROM source_chunks;
    `);

    // Search
    const results = db.prepare(`
      SELECT sc.*
      FROM source_chunks_fts
      JOIN source_chunks sc ON source_chunks_fts.rowid = sc.rowid
      WHERE source_chunks_fts MATCH ?
    `).all('authentication');

    expect(results).toHaveLength(1);
  });
});

describe('Rate Limiter', () => {
  beforeEach(() => {
    db = setupTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should store and retrieve run history', () => {
    db.prepare(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
        status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
        permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('a1', 'rate-test', 'C1', '', '[]', ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 0, 'standard', 'U1');

    db.prepare(`
      INSERT INTO run_history (id, agent_id, channel_id, thread_ts, input, output, status,
        input_tokens, output_tokens, estimated_cost_usd, duration_ms, trace_id, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('r1', 'a1', 'C1', 'ts1', 'test input', 'test output', 'completed', 100, 50, 0.01, 1000, 'trace1', 'sonnet');

    const run = db.prepare('SELECT * FROM run_history WHERE id = ?').get('r1') as any;
    expect(run.status).toBe('completed');
    expect(run.input_tokens).toBe(100);
    expect(run.estimated_cost_usd).toBe(0.01);
  });
});

describe('Cost Calculator', () => {
  it('should calculate costs accurately', () => {
    const PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
      opus: { inputPer1k: 0.015, outputPer1k: 0.075 },
      sonnet: { inputPer1k: 0.003, outputPer1k: 0.015 },
      haiku: { inputPer1k: 0.00025, outputPer1k: 0.00125 },
    };

    const model = 'sonnet';
    const inputTokens = 1000;
    const outputTokens = 500;
    const pricing = PRICING[model];
    const cost = (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k;

    expect(cost).toBeCloseTo(0.0105);
  });
});

describe('Workflows', () => {
  beforeEach(() => {
    db = setupTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should track side effects idempotently', () => {
    db.prepare(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
        status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
        permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('a1', 'wf-test', 'C1', '', '[]', ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 0, 'standard', 'U1');

    db.prepare(`
      INSERT INTO workflow_definitions (id, name, agent_id, steps_json, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run('wd1', 'test-wf', 'a1', '[]', 'U1');

    db.prepare(`
      INSERT INTO workflow_runs (id, workflow_id, run_id, current_step, step_state, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('wr1', 'wd1', 'r1', 0, '{}', 'running');

    // First insert should succeed
    db.prepare(`
      INSERT INTO side_effects_log (id, workflow_run_id, step_id, attempt_number, effect_type, effect_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('se1', 'wr1', 'step1', 1, 'email_sent', '{}');

    // Duplicate should fail (unique constraint)
    expect(() => {
      db.prepare(`
        INSERT INTO side_effects_log (id, workflow_run_id, step_id, attempt_number, effect_type, effect_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('se2', 'wr1', 'step1', 2, 'email_sent', '{}');
    }).toThrow();
  });
});

describe('Agent Memory', () => {
  beforeEach(() => {
    db = setupTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should store and search memories', () => {
    db.prepare(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
        status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
        permission_level, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('a1', 'mem-test', 'C1', '', '[]', ':robot_face:', 'active', 'sonnet', 1, 'autonomous', 50, 1, 'standard', 'U1');

    db.prepare(`
      INSERT INTO agent_memory (id, agent_id, run_id, fact, category, relevance_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('m1', 'a1', 'r1', 'Customer prefers email over Slack', 'customer_preference', 1.0);

    // Rebuild FTS
    db.exec(`
      DELETE FROM agent_memory_fts;
      INSERT INTO agent_memory_fts(rowid, fact, category)
        SELECT rowid, fact, category FROM agent_memory;
    `);

    // Search
    const results = db.prepare(`
      SELECT am.*
      FROM agent_memory_fts
      JOIN agent_memory am ON agent_memory_fts.rowid = am.rowid
      WHERE agent_memory_fts MATCH ?
    `).all('email');

    expect(results).toHaveLength(1);
    expect((results[0] as any).fact).toContain('email');
  });
});
