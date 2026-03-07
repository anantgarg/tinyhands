import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../src/db';

// ══════════════════════════════════════════════════════════════════════════════
//  END-TO-END SMOKE TESTS
//
//  These tests exercise actual module functions against a real in-memory SQLite
//  database. They cover the full lifecycle of all self-authoring features,
//  self-evolution DB storage, tool management, access control, and cross-module
//  interactions. External services (Docker, Anthropic API) are mocked.
// ══════════════════════════════════════════════════════════════════════════════

let db: Database.Database;

function setupTestDb(): Database.Database {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}

// Mock getDb() across all modules to use our in-memory DB
vi.mock('../../src/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/db')>();
  return {
    ...original,
    getDb: () => db,
  };
});

// Mock logger to suppress output during tests
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config for Docker base image reference
vi.mock('../../src/config', () => ({
  config: {
    docker: { baseImage: 'tinyjobs-base:latest' },
    anthropic: { apiKey: 'test-key' },
  },
}));

// ──────────────────────────────────────────────────
//  Helper: create a test agent in the DB
// ──────────────────────────────────────────────────
function createTestAgent(overrides: Partial<{
  id: string; name: string; channelId: string; selfEvolutionMode: string;
  createdBy: string; permissionLevel: string;
}> = {}) {
  const id = overrides.id || 'agent-test-001';
  const name = overrides.name || 'test-agent';
  const channelId = overrides.channelId || 'C123';
  const mode = overrides.selfEvolutionMode || 'autonomous';
  const createdBy = overrides.createdBy || 'U001';
  const permLevel = overrides.permissionLevel || 'standard';

  db.prepare(`
    INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji,
      status, model, streaming_detail, self_evolution_mode, max_turns, memory_enabled,
      permission_level, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, channelId, 'You are a test agent', '["Read","Write","Bash"]',
    ':robot_face:', 'active', 'sonnet', 1, mode, 50, 0, permLevel, createdBy);

  return { id, name, channelId, createdBy };
}

function makeSuperadmin(userId: string) {
  db.prepare('INSERT OR IGNORE INTO superadmins (user_id, granted_by) VALUES (?, ?)').run(userId, 'system');
}

function makeAgentAdmin(agentId: string, userId: string, role: string = 'admin') {
  db.prepare('INSERT OR REPLACE INTO agent_admins (agent_id, user_id, role, granted_by) VALUES (?, ?, ?, ?)').run(
    agentId, userId, role, 'system'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. TOOL REGISTRATION & LIFECYCLE (tools module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Tool Registration & Lifecycle', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('registers a custom tool with code stored in DB', async () => {
    const { registerCustomTool, getCustomTool, getToolCode } = await import('../../src/modules/tools');

    createTestAgent();
    const tool = registerCustomTool(
      'calc-sum', '{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}}}',
      null, 'agent-test-001',
      { code: 'const {a,b} = JSON.parse(process.env.INPUT); console.log(a+b);', language: 'javascript', autoApprove: true }
    );

    expect(tool.name).toBe('calc-sum');
    expect(tool.script_code).toContain('a+b');
    expect(tool.script_path).toBeNull();
    expect(tool.approved).toBeTruthy();
    expect(tool.language).toBe('javascript');

    const fetched = getCustomTool('calc-sum');
    expect(fetched).not.toBeNull();
    expect(fetched!.script_code).toBe(tool.script_code);

    const codeResult = getToolCode('calc-sum');
    expect(codeResult).not.toBeNull();
    expect(codeResult!.code).toContain('a+b');
    expect(codeResult!.language).toBe('javascript');
  });

  it('prevents duplicate tool registration', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    createTestAgent();

    registerCustomTool('my-tool', '{}', null, 'agent-test-001', { code: 'code', autoApprove: true });
    expect(() => {
      registerCustomTool('my-tool', '{}', null, 'agent-test-001', { code: 'code2', autoApprove: true });
    }).toThrow(/already registered/);
  });

  it('requires superadmin to approve tools', async () => {
    const { registerCustomTool, approveCustomTool, getCustomTool } = await import('../../src/modules/tools');
    createTestAgent();

    registerCustomTool('pending-tool', '{}', null, 'agent-test-001', { code: 'code' });
    const before = getCustomTool('pending-tool');
    expect(before!.approved).toBeFalsy(); // agent-authored, not auto-approved

    // Non-superadmin can't approve
    expect(() => approveCustomTool('pending-tool', 'random-user')).toThrow(/admin/i);

    // Superadmin can approve
    makeSuperadmin('admin-user');
    approveCustomTool('pending-tool', 'admin-user');
    const after = getCustomTool('pending-tool');
    expect(after!.approved).toBeTruthy();
  });

  it('superadmin can delete tools', async () => {
    const { registerCustomTool, deleteCustomTool, getCustomTool } = await import('../../src/modules/tools');
    createTestAgent();
    makeSuperadmin('admin-user');

    registerCustomTool('doomed-tool', '{}', null, 'agent-test-001', { code: 'x', autoApprove: true });
    expect(getCustomTool('doomed-tool')).not.toBeNull();

    deleteCustomTool('doomed-tool', 'admin-user');
    expect(getCustomTool('doomed-tool')).toBeFalsy();
  });

  it('classifies agent tools into builtin/custom/mcp', async () => {
    const { registerCustomTool, getAgentToolSummary } = await import('../../src/modules/tools');

    createTestAgent(); // tools: ["Read", "Write", "Bash"]
    registerCustomTool('my-custom', '{}', null, 'agent-test-001', { code: 'x', autoApprove: true });

    // Add custom tool to agent's tool list
    db.prepare('UPDATE agents SET tools = ? WHERE id = ?').run(
      '["Read","Write","Bash","my-custom","unknown-mcp"]', 'agent-test-001'
    );

    const summary = getAgentToolSummary('agent-test-001');
    expect(summary.builtin).toContain('Read');
    expect(summary.builtin).toContain('Write');
    expect(summary.builtin).toContain('Bash');
    expect(summary.custom).toContain('my-custom');
    expect(summary.mcp).toContain('unknown-mcp');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  2. TOOL VERSIONING & ROLLBACK (self-authoring module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Tool Versioning & Rollback', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('full version lifecycle: create → update → update → rollback', async () => {
    const { registerCustomTool, getCustomTool } = await import('../../src/modules/tools');
    const { updateToolCode, rollbackTool, getToolVersions } = await import('../../src/modules/self-authoring');

    createTestAgent();
    makeSuperadmin('admin-user');

    // V1: initial registration
    registerCustomTool('versioned-tool', '{}', null, 'agent-test-001', {
      code: 'console.log("v1")', language: 'javascript', autoApprove: true
    });

    // V2: update
    updateToolCode('versioned-tool', 'console.log("v2")', 'javascript', 'admin-user');
    let tool = getCustomTool('versioned-tool');
    expect(tool!.script_code).toBe('console.log("v2")');

    // V3: update
    updateToolCode('versioned-tool', 'console.log("v3")', 'javascript', 'admin-user');
    tool = getCustomTool('versioned-tool');
    expect(tool!.script_code).toBe('console.log("v3")');

    // Check version history
    const versions = getToolVersions('versioned-tool');
    expect(versions.length).toBe(2); // v1 archived, v2 archived (v3 is current)
    expect(versions[0].version).toBeGreaterThan(versions[1].version);

    // Rollback to version 1
    rollbackTool('versioned-tool', 1, 'admin-user');
    tool = getCustomTool('versioned-tool');
    expect(tool!.script_code).toBe('console.log("v1")');

    // Version history should now have 3 entries (v3 also archived on rollback)
    const versionsAfterRollback = getToolVersions('versioned-tool');
    expect(versionsAfterRollback.length).toBe(3);
  });

  it('rejects rollback to nonexistent version', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { rollbackTool } = await import('../../src/modules/self-authoring');

    createTestAgent();
    registerCustomTool('simple-tool', '{}', null, 'agent-test-001', {
      code: 'x', language: 'javascript', autoApprove: true
    });

    expect(() => rollbackTool('simple-tool', 999, 'admin-user')).toThrow(/Version 999 not found/);
  });

  it('validates code on update — blocks forbidden patterns', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { updateToolCode } = await import('../../src/modules/self-authoring');

    createTestAgent();
    registerCustomTool('safe-tool', '{}', null, 'agent-test-001', {
      code: 'console.log("safe")', language: 'javascript', autoApprove: true
    });

    expect(() => {
      updateToolCode('safe-tool', 'process.exit(1)', 'javascript', 'admin-user');
    }).toThrow(/forbidden pattern/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  3. TOOL ANALYTICS (self-authoring module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Tool Analytics', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('tracks runs and computes analytics correctly', async () => {
    const { recordToolRun, getToolAnalytics, getAllToolAnalytics } = await import('../../src/modules/self-authoring');

    createTestAgent();

    // Record some runs
    recordToolRun('calc-tool', 'agent-test-001', true, 100, null);
    recordToolRun('calc-tool', 'agent-test-001', true, 200, null);
    recordToolRun('calc-tool', 'agent-test-001', false, 50, 'TypeError: x is not defined');
    recordToolRun('calc-tool', 'agent-test-001', true, 150, null);

    const analytics = getToolAnalytics('calc-tool');
    expect(analytics.toolName).toBe('calc-tool');
    expect(analytics.totalRuns).toBe(4);
    expect(analytics.successRate).toBe(0.75);
    expect(analytics.avgDurationMs).toBe(125); // (100+200+50+150)/4
    expect(analytics.lastError).toBe('TypeError: x is not defined');
    expect(analytics.lastUsed).not.toBeNull();

    // Record for a different tool
    recordToolRun('other-tool', 'agent-test-001', true, 300, null);

    // Get all analytics
    const all = getAllToolAnalytics();
    expect(all.length).toBe(2);
    expect(all.map(a => a.toolName).sort()).toEqual(['calc-tool', 'other-tool']);

    // Filter by agent
    const agentAll = getAllToolAnalytics('agent-test-001');
    expect(agentAll.length).toBe(2);
  });

  it('handles zero runs gracefully', async () => {
    const { getToolAnalytics } = await import('../../src/modules/self-authoring');
    createTestAgent();

    const analytics = getToolAnalytics('nonexistent-tool');
    expect(analytics.totalRuns).toBe(0);
    expect(analytics.successRate).toBe(0);
    expect(analytics.avgDurationMs).toBe(0);
    expect(analytics.lastUsed).toBeNull();
    expect(analytics.lastError).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  4. TOOL SHARING ACROSS AGENTS (self-authoring module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Tool Sharing', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('shares a tool from one agent to another', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { shareToolWithAgent } = await import('../../src/modules/self-authoring');
    const { getAgent } = await import('../../src/modules/agents');

    const agent1 = createTestAgent({ id: 'agent-001', name: 'agent-one', channelId: 'C1' });
    const agent2 = createTestAgent({ id: 'agent-002', name: 'agent-two', channelId: 'C2' });
    makeSuperadmin(agent1.id); // Agent needs permission to modify target

    registerCustomTool('shared-tool', '{}', null, 'agent-001', {
      code: 'console.log("shared")', language: 'javascript', autoApprove: true
    });

    shareToolWithAgent('shared-tool', 'agent-001', 'agent-002');

    const updated = getAgent('agent-002');
    expect(updated!.tools).toContain('shared-tool');
  });

  it('rejects sharing if agent does not own the tool', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { shareToolWithAgent } = await import('../../src/modules/self-authoring');

    createTestAgent({ id: 'agent-001', name: 'agent-one', channelId: 'C1' });
    createTestAgent({ id: 'agent-002', name: 'agent-two', channelId: 'C2' });

    registerCustomTool('owned-tool', '{}', null, 'agent-001', { code: 'x', autoApprove: true });

    expect(() => {
      shareToolWithAgent('owned-tool', 'agent-002', 'agent-001'); // agent-002 doesn't own it
    }).toThrow(/does not own/);
  });

  it('does not duplicate tool in target agent list', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { shareToolWithAgent } = await import('../../src/modules/self-authoring');
    const { getAgent } = await import('../../src/modules/agents');

    createTestAgent({ id: 'agent-001', name: 'agent-one', channelId: 'C1' });
    createTestAgent({ id: 'agent-002', name: 'agent-two', channelId: 'C2' });
    makeSuperadmin('agent-001');

    registerCustomTool('dupe-tool', '{}', null, 'agent-001', { code: 'x', autoApprove: true });

    shareToolWithAgent('dupe-tool', 'agent-001', 'agent-002');
    shareToolWithAgent('dupe-tool', 'agent-001', 'agent-002'); // share again

    const updated = getAgent('agent-002');
    expect(updated!.tools.filter(t => t === 'dupe-tool')).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  5. TOOL DISCOVERY / SEARCH (self-authoring module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Tool Discovery', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('finds tools by name substring', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { discoverTools } = await import('../../src/modules/self-authoring');

    createTestAgent();

    registerCustomTool('csv-parser', '{"description":"Parses CSV files"}', null, 'agent-test-001', { code: 'x', autoApprove: true });
    registerCustomTool('json-validator', '{"description":"Validates JSON"}', null, 'agent-test-001', { code: 'x', autoApprove: true });
    registerCustomTool('csv-to-json', '{"description":"Converts CSV to JSON"}', null, 'agent-test-001', { code: 'x', autoApprove: true });

    const csvResults = discoverTools('csv');
    expect(csvResults.length).toBe(2);
    expect(csvResults.map(t => t.name).sort()).toEqual(['csv-parser', 'csv-to-json']);

    const jsonResults = discoverTools('json');
    expect(jsonResults.length).toBe(2); // json-validator + csv-to-json (name match)
  });

  it('finds tools by schema content', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { discoverTools } = await import('../../src/modules/self-authoring');

    createTestAgent();

    registerCustomTool('tool-alpha', '{"description":"analyzes sentiment of text"}', null, 'agent-test-001', { code: 'x', autoApprove: true });
    registerCustomTool('tool-beta', '{"description":"sends email notifications"}', null, 'agent-test-001', { code: 'x', autoApprove: true });

    const results = discoverTools('sentiment');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('tool-alpha');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  6. TOOL PIPELINES / COMPOSITION (self-authoring module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Tool Pipelines', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('creates a pipeline tool that chains existing tools', async () => {
    const { registerCustomTool, getCustomTool } = await import('../../src/modules/tools');
    const { createToolPipeline } = await import('../../src/modules/self-authoring');

    createTestAgent();

    registerCustomTool('fetch-data', '{"type":"object","properties":{"url":{"type":"string"}}}', null, 'agent-test-001', { code: 'x', autoApprove: true });
    registerCustomTool('transform-data', '{}', null, 'agent-test-001', { code: 'x', autoApprove: true });

    const pipelineTool = createToolPipeline('agent-test-001', {
      name: 'etl-pipeline',
      description: 'Fetch and transform data',
      steps: [
        { toolName: 'fetch-data', inputMapping: {} },
        { toolName: 'transform-data', inputMapping: { data: 'output' } },
      ],
    });

    expect(pipelineTool.name).toBe('etl-pipeline');
    expect(pipelineTool.script_code).toContain('vm.runInNewContext');
    expect(pipelineTool.script_code).toContain('fetch-data');
    expect(pipelineTool.script_code).toContain('transform-data');

    // Pipeline tool is stored in DB
    const stored = getCustomTool('etl-pipeline');
    expect(stored).not.toBeNull();
    expect(stored!.script_code).toBe(pipelineTool.script_code);
  });

  it('rejects pipeline referencing nonexistent tools', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { createToolPipeline } = await import('../../src/modules/self-authoring');

    createTestAgent();
    registerCustomTool('real-tool', '{}', null, 'agent-test-001', { code: 'x', autoApprove: true });

    expect(() => {
      createToolPipeline('agent-test-001', {
        name: 'bad-pipeline',
        description: 'Broken pipeline',
        steps: [
          { toolName: 'real-tool', inputMapping: {} },
          { toolName: 'ghost-tool', inputMapping: {} },
        ],
      });
    }).toThrow(/unknown tool/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  7. EXECUTION SCRIPT GENERATION (self-authoring module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Execution Script Generation', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('generates executable script for approved JS tool', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { getToolExecutionScript } = await import('../../src/modules/self-authoring');

    createTestAgent();

    registerCustomTool('js-tool', '{}', null, 'agent-test-001', {
      code: 'const x = input.value * 2; console.log(JSON.stringify({result: x}));',
      language: 'javascript', autoApprove: true,
    });

    const script = getToolExecutionScript('js-tool');
    expect(script).not.toBeNull();
    expect(script).toContain('#!/usr/bin/env node');
    expect(script).toContain("'use strict'");
    expect(script).toContain('Agent-authored tool: js-tool');
    expect(script).toContain('input.value * 2');
  });

  it('generates executable script for approved Python tool', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { getToolExecutionScript } = await import('../../src/modules/self-authoring');

    createTestAgent();

    registerCustomTool('py-tool', '{}', null, 'agent-test-001', {
      code: 'print(json.dumps({"result": input_data["value"] * 2}))',
      language: 'python', autoApprove: true,
    });

    const script = getToolExecutionScript('py-tool');
    expect(script).toContain('#!/usr/bin/env python3');
    expect(script).toContain('import os, json');
    expect(script).toContain('input_data');
  });

  it('generates executable script for approved Bash tool', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { getToolExecutionScript } = await import('../../src/modules/self-authoring');

    createTestAgent();

    registerCustomTool('sh-tool', '{}', null, 'agent-test-001', {
      code: 'echo "hello"',
      language: 'bash', autoApprove: true,
    });

    const script = getToolExecutionScript('sh-tool');
    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain('set -euo pipefail');
  });

  it('returns null for unapproved tools', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { getToolExecutionScript } = await import('../../src/modules/self-authoring');

    createTestAgent();

    // Agent-authored tools without autoApprove default to unapproved
    registerCustomTool('unapproved-tool', '{}', null, 'agent-test-001', {
      code: 'console.log("blocked")', language: 'javascript',
    });

    const script = getToolExecutionScript('unapproved-tool');
    expect(script).toBeNull();
  });

  it('returns null for tools without code', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { getToolExecutionScript } = await import('../../src/modules/self-authoring');

    createTestAgent();
    makeSuperadmin('admin-user');

    // Script-path-based tool (no inline code)
    registerCustomTool('path-tool', '{}', '/scripts/tool.js', 'admin-user');

    const script = getToolExecutionScript('path-tool');
    expect(script).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  8. SELF-EVOLUTION: DB-ONLY STORAGE (self-evolution module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Self-Evolution DB-Only Storage', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('autonomous agent auto-executes write_tool proposals', async () => {
    const { createProposal, getProposal } = await import('../../src/modules/self-evolution');
    const { getCustomTool } = await import('../../src/modules/tools');

    createTestAgent({ selfEvolutionMode: 'autonomous' });

    const proposal = createProposal(
      'agent-test-001', 'write_tool', 'Create a calculator tool',
      JSON.stringify({
        name: 'auto-calc',
        schema: { type: 'object', properties: { a: { type: 'number' } } },
        code: 'console.log(JSON.parse(process.env.INPUT).a * 2)',
        language: 'javascript',
      })
    );

    expect(proposal.status).toBe('executed');
    expect(proposal.resolved_at).not.toBeNull();

    // Tool should exist in DB
    const tool = getCustomTool('auto-calc');
    expect(tool).not.toBeNull();
    expect(tool!.script_code).toContain('a * 2');
  });

  it('approve-first agent creates pending proposals', async () => {
    const { createProposal, getProposal, getPendingProposals } = await import('../../src/modules/self-evolution');

    createTestAgent({ selfEvolutionMode: 'approve-first' });

    const proposal = createProposal(
      'agent-test-001', 'write_tool', 'Create tool',
      JSON.stringify({ name: 'pending-tool', code: 'x', language: 'javascript' })
    );

    expect(proposal.status).toBe('pending');

    const pending = getPendingProposals('agent-test-001');
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(proposal.id);
  });

  it('autonomous agent auto-executes create_mcp proposals → stored in DB', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');
    const { getMcpConfigs } = await import('../../src/modules/self-authoring');

    createTestAgent({ selfEvolutionMode: 'autonomous' });

    createProposal(
      'agent-test-001', 'create_mcp', 'Add Linear MCP',
      JSON.stringify({
        name: 'linear-mcp',
        url: 'http://localhost:3001/sse',
        apiKey: 'test-key',
      })
    );

    const configs = getMcpConfigs('agent-test-001');
    expect(configs.length).toBe(1);
    expect(configs[0].name).toBe('linear-mcp');
    expect(configs[0].config_json).toContain('linear-mcp');
    // Autonomous agent auto-approves MCP configs
    expect(configs[0].approved).toBeTruthy();
  });

  it('autonomous agent auto-executes commit_code proposals → stored in code_artifacts', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');
    const { getCodeArtifacts, getCodeArtifact } = await import('../../src/modules/self-authoring');

    createTestAgent({ selfEvolutionMode: 'autonomous' });

    createProposal(
      'agent-test-001', 'commit_code', 'Add utility files',
      JSON.stringify({
        files: [
          { path: '/src/utils/helper.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
          { path: '/src/utils/format.py', content: 'def fmt(s): return s.strip()' },
        ],
      })
    );

    const artifacts = getCodeArtifacts('agent-test-001');
    expect(artifacts.length).toBe(2);

    const helper = getCodeArtifact('agent-test-001', '/src/utils/helper.ts');
    expect(helper).not.toBeNull();
    expect(helper!.content).toContain('export function add');
    expect(helper!.language).toBe('typescript');
    expect(helper!.version).toBe(1);

    const pyFile = getCodeArtifact('agent-test-001', '/src/utils/format.py');
    expect(pyFile).not.toBeNull();
    expect(pyFile!.language).toBe('python');
  });

  it('code artifacts support versioned upserts', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');
    const { getCodeArtifact } = await import('../../src/modules/self-authoring');

    createTestAgent({ selfEvolutionMode: 'autonomous' });

    // First version
    createProposal('agent-test-001', 'commit_code', 'v1', JSON.stringify({
      files: [{ path: '/src/app.js', content: 'v1 code' }],
    }));

    let artifact = getCodeArtifact('agent-test-001', '/src/app.js');
    expect(artifact!.version).toBe(1);
    expect(artifact!.content).toBe('v1 code');

    // Second version — same path triggers upsert
    createProposal('agent-test-001', 'commit_code', 'v2', JSON.stringify({
      files: [{ path: '/src/app.js', content: 'v2 updated code' }],
    }));

    artifact = getCodeArtifact('agent-test-001', '/src/app.js');
    expect(artifact!.version).toBe(2);
    expect(artifact!.content).toBe('v2 updated code');
  });

  it('commit_code validates artifact paths — blocks traversal', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');

    createTestAgent({ selfEvolutionMode: 'autonomous' });

    expect(() => {
      createProposal('agent-test-001', 'commit_code', 'malicious', JSON.stringify({
        files: [{ path: '/src/../../etc/passwd', content: 'hacked' }],
      }));
    }).toThrow(/\.\./);
  });

  it('commit_code validates artifact paths — blocks system dirs', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');

    createTestAgent({ selfEvolutionMode: 'autonomous' });

    expect(() => {
      createProposal('agent-test-001', 'commit_code', 'malicious', JSON.stringify({
        files: [{ path: '/etc/shadow', content: 'hacked' }],
      }));
    }).toThrow(/\/etc\//);
  });

  it('write_tool validates tool names', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');

    createTestAgent({ selfEvolutionMode: 'autonomous' });

    expect(() => {
      createProposal('agent-test-001', 'write_tool', 'Bad name', JSON.stringify({
        name: 'AB', // too short
        code: 'x', language: 'javascript',
      }));
    }).toThrow(/3-40 characters/);
  });

  it('update_prompt modifies agent system prompt', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');
    const { getAgent } = await import('../../src/modules/agents');

    createTestAgent({ selfEvolutionMode: 'autonomous' });
    makeSuperadmin('agent-test-001'); // Agent needs permission to update itself

    createProposal('agent-test-001', 'update_prompt', 'Update prompt', 'You are an improved agent.');

    const agent = getAgent('agent-test-001');
    expect(agent!.system_prompt).toBe('You are an improved agent.');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  9. PROPOSAL LIFECYCLE: approve, reject, expire (self-evolution module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Proposal Lifecycle', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('approve-first → approve → executes', async () => {
    const { createProposal, approveProposal, getProposal } = await import('../../src/modules/self-evolution');
    const { getCustomTool } = await import('../../src/modules/tools');

    createTestAgent({ selfEvolutionMode: 'approve-first' });
    makeSuperadmin('admin-user');

    const proposal = createProposal('agent-test-001', 'write_tool', 'Approved tool', JSON.stringify({
      name: 'approved-tool', code: 'console.log("ok")', language: 'javascript',
      schema: {},
    }));

    expect(proposal.status).toBe('pending');
    expect(getCustomTool('approved-tool')).toBeFalsy(); // Not yet executed

    const approved = approveProposal(proposal.id, 'admin-user');
    expect(approved.status).toBe('approved');

    // Tool should now exist
    const tool = getCustomTool('approved-tool');
    expect(tool).not.toBeNull();
  });

  it('reject prevents execution', async () => {
    const { createProposal, rejectProposal, getProposal } = await import('../../src/modules/self-evolution');

    createTestAgent({ selfEvolutionMode: 'approve-first' });
    makeSuperadmin('admin-user');

    const proposal = createProposal('agent-test-001', 'write_tool', 'Rejected tool', JSON.stringify({
      name: 'rejected-tool', code: 'x', language: 'javascript',
    }));

    rejectProposal(proposal.id, 'admin-user');

    const updated = getProposal(proposal.id);
    expect(updated!.status).toBe('rejected');
    expect(updated!.resolved_at).not.toBeNull();
  });

  it('cannot approve non-pending proposals', async () => {
    const { createProposal, approveProposal } = await import('../../src/modules/self-evolution');

    createTestAgent({ selfEvolutionMode: 'autonomous' }); // auto-executes
    makeSuperadmin('admin-user');

    const proposal = createProposal('agent-test-001', 'update_prompt', 'Auto', 'new prompt');
    expect(proposal.status).toBe('executed');

    expect(() => approveProposal(proposal.id, 'admin-user')).toThrow(/cannot approve/i);
  });

  it('expires old pending proposals', async () => {
    const { expireOldProposals, getProposal } = await import('../../src/modules/self-evolution');

    createTestAgent({ selfEvolutionMode: 'approve-first' });

    // Insert a proposal with old timestamp
    const oldTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO evolution_proposals (id, agent_id, action, description, diff, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('old-proposal', 'agent-test-001', 'update_prompt', 'Old proposal', 'old prompt', 'pending', oldTime);

    const expired = expireOldProposals();
    expect(expired).toBe(1);

    const proposal = getProposal('old-proposal');
    expect(proposal!.status).toBe('rejected');
  });

  it('proposal history tracks all proposals for agent', async () => {
    const { createProposal, getProposalHistory } = await import('../../src/modules/self-evolution');

    createTestAgent({ selfEvolutionMode: 'autonomous' });
    makeSuperadmin('agent-test-001');

    createProposal('agent-test-001', 'update_prompt', 'First', 'prompt1');
    createProposal('agent-test-001', 'update_prompt', 'Second', 'prompt2');
    createProposal('agent-test-001', 'add_to_kb', 'Third', JSON.stringify({
      title: 'KB Entry', content: 'some knowledge',
    }));

    const history = getProposalHistory('agent-test-001');
    expect(history.length).toBe(3);
    expect(history.every(p => p.agent_id === 'agent-test-001')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  10. MCP CONFIG MANAGEMENT (self-authoring + self-evolution)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: MCP Config Management', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('stores and retrieves MCP configs per agent', async () => {
    const { getMcpConfigs } = await import('../../src/modules/self-authoring');

    createTestAgent({ id: 'agent-001', name: 'agent-1', channelId: 'C1' });
    createTestAgent({ id: 'agent-002', name: 'agent-2', channelId: 'C2' });

    // Insert MCP configs directly
    db.prepare(`INSERT INTO mcp_configs (id, agent_id, name, config_json, approved) VALUES (?, ?, ?, ?, ?)`)
      .run('mcp-1', 'agent-001', 'linear', '{"url":"http://linear:3001"}', 1);
    db.prepare(`INSERT INTO mcp_configs (id, agent_id, name, config_json, approved) VALUES (?, ?, ?, ?, ?)`)
      .run('mcp-2', 'agent-001', 'github', '{"url":"http://github:3002"}', 0);
    db.prepare(`INSERT INTO mcp_configs (id, agent_id, name, config_json, approved) VALUES (?, ?, ?, ?, ?)`)
      .run('mcp-3', 'agent-002', 'slack', '{"url":"http://slack:3003"}', 1);

    const agent1Configs = getMcpConfigs('agent-001');
    expect(agent1Configs.length).toBe(2);
    expect(agent1Configs.map(c => c.name).sort()).toEqual(['github', 'linear']);

    const agent2Configs = getMcpConfigs('agent-002');
    expect(agent2Configs.length).toBe(1);
    expect(agent2Configs[0].name).toBe('slack');
  });

  it('approves MCP config with proper permissions', async () => {
    const { getMcpConfigs, approveMcpConfig } = await import('../../src/modules/self-authoring');

    createTestAgent();
    makeSuperadmin('admin-user');

    db.prepare(`INSERT INTO mcp_configs (id, agent_id, name, config_json, approved) VALUES (?, ?, ?, ?, ?)`)
      .run('mcp-pending', 'agent-test-001', 'pending-mcp', '{}', 0);

    approveMcpConfig('mcp-pending', 'admin-user');

    const configs = getMcpConfigs('agent-test-001');
    expect(configs.find(c => c.name === 'pending-mcp')!.approved).toBeTruthy();
  });

  it('rejects MCP approval without permissions', async () => {
    const { approveMcpConfig } = await import('../../src/modules/self-authoring');

    createTestAgent();

    db.prepare(`INSERT INTO mcp_configs (id, agent_id, name, config_json, approved) VALUES (?, ?, ?, ?, ?)`)
      .run('mcp-x', 'agent-test-001', 'x-mcp', '{}', 0);

    expect(() => approveMcpConfig('mcp-x', 'random-user')).toThrow(/permissions/i);
  });

  it('MCP config upsert on duplicate (agent_id, name)', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');
    const { getMcpConfigs } = await import('../../src/modules/self-authoring');

    createTestAgent({ selfEvolutionMode: 'autonomous' });

    // First creation
    createProposal('agent-test-001', 'create_mcp', 'MCP v1', JSON.stringify({
      name: 'upsert-mcp', url: 'http://v1',
    }));

    // Second creation — should upsert
    createProposal('agent-test-001', 'create_mcp', 'MCP v2', JSON.stringify({
      name: 'upsert-mcp', url: 'http://v2',
    }));

    const configs = getMcpConfigs('agent-test-001');
    const mcp = configs.find(c => c.name === 'upsert-mcp');
    expect(mcp).toBeDefined();
    // Should have only one entry for this name
    expect(configs.filter(c => c.name === 'upsert-mcp').length).toBe(1);
    // Should have updated content
    expect(mcp!.config_json).toContain('v2');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  11. AUTHORED SKILLS (self-authoring module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Authored Skills', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('stores and retrieves authored skills', async () => {
    const { getAuthoredSkills, getAuthoredSkill } = await import('../../src/modules/self-authoring');

    createTestAgent();

    // Insert directly
    db.prepare(`
      INSERT INTO authored_skills (id, agent_id, name, description, skill_type, template, version, approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('skill-1', 'agent-test-001', 'summarize-email', 'Summarize emails',
      'prompt_template', 'Summarize: {{email_body}}', 1, 0);

    const skills = getAuthoredSkills('agent-test-001');
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe('summarize-email');
    expect(skills[0].template).toContain('{{email_body}}');

    const single = getAuthoredSkill('skill-1');
    expect(single).not.toBeNull();
    expect(single!.name).toBe('summarize-email');
  });

  it('approves authored skill with proper permissions', async () => {
    const { approveAuthoredSkill, getAuthoredSkill } = await import('../../src/modules/self-authoring');

    createTestAgent();
    makeSuperadmin('admin-user');

    db.prepare(`
      INSERT INTO authored_skills (id, agent_id, name, description, skill_type, template, version, approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('skill-pending', 'agent-test-001', 'pending-skill', 'desc', 'prompt_template', 'template', 1, 0);

    approveAuthoredSkill('skill-pending', 'admin-user');

    const skill = getAuthoredSkill('skill-pending');
    expect(skill!.approved).toBeTruthy();
  });

  it('updates skill template and increments version', async () => {
    const { updateAuthoredSkillTemplate, getAuthoredSkill } = await import('../../src/modules/self-authoring');

    createTestAgent();
    makeSuperadmin('admin-user');

    db.prepare(`
      INSERT INTO authored_skills (id, agent_id, name, description, skill_type, template, version, approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('skill-v', 'agent-test-001', 'versioned-skill', 'desc', 'prompt_template', 'v1 template', 1, 1);

    updateAuthoredSkillTemplate('skill-v', 'v2 improved template', 'admin-user');

    const skill = getAuthoredSkill('skill-v');
    expect(skill!.template).toBe('v2 improved template');
    expect(skill!.version).toBe(2);
  });

  it('rejects skill update without permissions', async () => {
    const { updateAuthoredSkillTemplate } = await import('../../src/modules/self-authoring');

    createTestAgent();

    db.prepare(`
      INSERT INTO authored_skills (id, agent_id, name, description, skill_type, template, version, approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('skill-locked', 'agent-test-001', 'locked-skill', 'desc', 'prompt_template', 'template', 1, 1);

    expect(() => {
      updateAuthoredSkillTemplate('skill-locked', 'new template', 'random-user');
    }).toThrow(/permissions/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  12. CODE ARTIFACT MANAGEMENT (self-authoring module)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Code Artifact Management', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('stores and queries code artifacts with language detection', async () => {
    const { getCodeArtifacts, getCodeArtifact } = await import('../../src/modules/self-authoring');

    createTestAgent();

    // Insert directly with language detection
    const files = [
      { id: 'art-1', path: '/src/index.ts', content: 'const x = 1;', language: 'typescript' },
      { id: 'art-2', path: '/scripts/deploy.sh', content: 'echo deploy', language: 'bash' },
      { id: 'art-3', path: '/data/config.json', content: '{"key":"val"}', language: 'json' },
    ];

    for (const f of files) {
      db.prepare(`
        INSERT INTO code_artifacts (id, agent_id, file_path, content, language, version)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(f.id, 'agent-test-001', f.path, f.content, f.language, 1);
    }

    const all = getCodeArtifacts('agent-test-001');
    expect(all.length).toBe(3);

    const tsFile = getCodeArtifact('agent-test-001', '/src/index.ts');
    expect(tsFile).not.toBeNull();
    expect(tsFile!.language).toBe('typescript');
    expect(tsFile!.content).toBe('const x = 1;');

    // Non-existent path returns null
    expect(getCodeArtifact('agent-test-001', '/missing/file.txt')).toBeFalsy();

    // Different agent has no artifacts
    expect(getCodeArtifacts('other-agent').length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  13. ACCESS CONTROL INTEGRATION
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Access Control Integration', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('superadmin can modify any agent', async () => {
    const { canModifyAgent } = await import('../../src/modules/access-control');

    createTestAgent();
    makeSuperadmin('admin-user');

    expect(canModifyAgent('agent-test-001', 'admin-user')).toBe(true);
  });

  it('agent admin can modify their agent', async () => {
    const { canModifyAgent } = await import('../../src/modules/access-control');

    createTestAgent();
    makeAgentAdmin('agent-test-001', 'team-member', 'admin');

    expect(canModifyAgent('agent-test-001', 'team-member')).toBe(true);
  });

  it('regular member cannot modify agent', async () => {
    const { canModifyAgent } = await import('../../src/modules/access-control');

    createTestAgent();

    expect(canModifyAgent('agent-test-001', 'random-user')).toBe(false);
  });

  it('owner can modify their agent', async () => {
    const { canModifyAgent } = await import('../../src/modules/access-control');

    createTestAgent();
    makeAgentAdmin('agent-test-001', 'owner-user', 'owner');

    expect(canModifyAgent('agent-test-001', 'owner-user')).toBe(true);
  });

  it('addAgentAdmin requires permission', async () => {
    const { addAgentAdmin } = await import('../../src/modules/access-control');

    createTestAgent();

    expect(() => {
      addAgentAdmin('agent-test-001', 'new-admin', 'admin', 'random-user');
    }).toThrow(/permissions/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  14. SECURITY VALIDATION (self-authoring module — actual functions)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Security Validation', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('validateToolCode blocks all forbidden patterns', async () => {
    const { validateToolCode } = await import('../../src/modules/self-authoring');

    const dangerous = [
      'process.exit(1)',
      'require("child_process")',
      'eval("alert(1)")',
      'new Function("return 1")()',
      'rm -rf /',
      ':(){ :|:& };:',
      'import subprocess',
      'os.system("ls")',
      'open("/etc/passwd")',
      '__import__("os")',
    ];

    for (const code of dangerous) {
      expect(() => validateToolCode(code, 'javascript'), `Should block: ${code}`).toThrow(/forbidden pattern/);
    }
  });

  it('validateToolCode allows safe code', async () => {
    const { validateToolCode } = await import('../../src/modules/self-authoring');

    expect(() => validateToolCode('const x = JSON.parse(process.env.INPUT); console.log(x);', 'javascript')).not.toThrow();
    expect(() => validateToolCode('import json, os\ndata = json.loads(os.environ["INPUT"])\nprint(data)', 'python')).not.toThrow();
    expect(() => validateToolCode('echo "$INPUT" | jq .', 'bash')).not.toThrow();
  });

  it('validateToolCode enforces size limits', async () => {
    const { validateToolCode } = await import('../../src/modules/self-authoring');

    expect(() => validateToolCode('x'.repeat(51000), 'javascript')).toThrow(/50KB/);
    expect(() => validateToolCode(Array(501).fill('x = 1').join('\n'), 'python')).toThrow(/500 lines/);
  });

  it('validateToolName enforces naming rules', async () => {
    const { validateToolName } = await import('../../src/modules/self-authoring');

    // Valid names
    expect(() => validateToolName('my-tool')).not.toThrow();
    expect(() => validateToolName('csv-parser')).not.toThrow();
    expect(() => validateToolName('tool123')).not.toThrow();

    // Invalid names
    expect(() => validateToolName('ab')).toThrow(); // too short
    expect(() => validateToolName('a'.repeat(41))).toThrow(); // too long
    expect(() => validateToolName('MyTool')).toThrow(); // uppercase
    expect(() => validateToolName('-my-tool')).toThrow(); // leading hyphen
    expect(() => validateToolName('my-tool-')).toThrow(); // trailing hyphen
    expect(() => validateToolName('my--tool')).toThrow(); // consecutive hyphens
    expect(() => validateToolName('tool;rm -rf /')).toThrow(); // injection
    expect(() => validateToolName('../etc/passwd')).toThrow(); // traversal
  });

  it('validateArtifactPath enforces path safety', async () => {
    const { validateArtifactPath } = await import('../../src/modules/self-authoring');

    // Valid paths
    expect(() => validateArtifactPath('/src/utils/helper.ts')).not.toThrow();
    expect(() => validateArtifactPath('/app/index.js')).not.toThrow();

    // Blocked paths
    expect(() => validateArtifactPath('/src/../../etc/passwd')).toThrow(); // traversal
    expect(() => validateArtifactPath('/src/file.ts\0.jpg')).toThrow(); // null byte
    expect(() => validateArtifactPath('relative/path.ts')).toThrow(); // not absolute
    expect(() => validateArtifactPath('/etc/shadow')).toThrow(); // system dir
    expect(() => validateArtifactPath('/proc/self/environ')).toThrow(); // system dir
    expect(() => validateArtifactPath('/sys/class/net')).toThrow(); // system dir
    expect(() => validateArtifactPath('/dev/sda')).toThrow(); // system dir
    expect(() => validateArtifactPath('/root/.bashrc')).toThrow(); // system dir
    expect(() => validateArtifactPath('/boot/vmlinuz')).toThrow(); // system dir
    expect(() => validateArtifactPath('/var/run/docker.sock')).toThrow(); // system dir
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  15. CROSS-MODULE INTEGRATION: Full Tool Authoring Lifecycle
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Full Cross-Module Integration', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('tool lifecycle: register → version → analytics → share → discover → execution script', async () => {
    const { registerCustomTool, getCustomTool } = await import('../../src/modules/tools');
    const {
      updateToolCode, getToolVersions, recordToolRun, getToolAnalytics,
      shareToolWithAgent, discoverTools, getToolExecutionScript,
    } = await import('../../src/modules/self-authoring');
    const { getAgent } = await import('../../src/modules/agents');

    // Setup
    createTestAgent({ id: 'agent-a', name: 'alpha', channelId: 'CA' });
    createTestAgent({ id: 'agent-b', name: 'beta', channelId: 'CB' });
    makeSuperadmin('agent-a');

    // 1. Register tool
    registerCustomTool('data-parser', '{"description":"Parses structured data"}', null, 'agent-a', {
      code: 'console.log(JSON.parse(process.env.INPUT))',
      language: 'javascript', autoApprove: true,
    });

    // 2. Update code twice (creates version history)
    updateToolCode('data-parser', 'console.log("v2")', 'javascript', 'agent-a');
    updateToolCode('data-parser', 'console.log("v3 - final")', 'javascript', 'agent-a');

    const versions = getToolVersions('data-parser');
    expect(versions.length).toBe(2);

    // 3. Record some runs
    recordToolRun('data-parser', 'agent-a', true, 120, null);
    recordToolRun('data-parser', 'agent-a', true, 80, null);
    recordToolRun('data-parser', 'agent-a', false, 30, 'SyntaxError');

    const analytics = getToolAnalytics('data-parser');
    expect(analytics.totalRuns).toBe(3);
    expect(analytics.successRate).toBeCloseTo(0.667, 2);
    expect(analytics.lastError).toBe('SyntaxError');

    // 4. Share with agent-b
    shareToolWithAgent('data-parser', 'agent-a', 'agent-b');
    const betaAgent = getAgent('agent-b');
    expect(betaAgent!.tools).toContain('data-parser');

    // 5. Discover the tool
    const found = discoverTools('parser');
    expect(found.length).toBe(1);
    expect(found[0].name).toBe('data-parser');

    const foundBySchema = discoverTools('structured');
    expect(foundBySchema.length).toBe(1);

    // 6. Get execution script
    const script = getToolExecutionScript('data-parser');
    expect(script).not.toBeNull();
    expect(script).toContain('#!/usr/bin/env node');
    expect(script).toContain('v3 - final');
  });

  it('self-evolution lifecycle: proposal → MCP + artifacts + tool in single agent', async () => {
    const { createProposal, getProposalHistory } = await import('../../src/modules/self-evolution');
    const { getMcpConfigs, getCodeArtifacts, getCodeArtifact } = await import('../../src/modules/self-authoring');
    const { getCustomTool } = await import('../../src/modules/tools');

    createTestAgent({ selfEvolutionMode: 'autonomous' });
    makeSuperadmin('agent-test-001');

    // 1. Agent creates an MCP config
    createProposal('agent-test-001', 'create_mcp', 'Linear integration', JSON.stringify({
      name: 'linear',
      url: 'http://linear-mcp:3001/sse',
    }));

    // 2. Agent writes code artifacts
    createProposal('agent-test-001', 'commit_code', 'Add helpers', JSON.stringify({
      files: [
        { path: '/src/helpers/math.js', content: 'module.exports.add = (a,b) => a+b;' },
        { path: '/src/helpers/string.py', content: 'def upper(s): return s.upper()' },
      ],
    }));

    // 3. Agent creates a tool
    createProposal('agent-test-001', 'write_tool', 'Calculator', JSON.stringify({
      name: 'quick-calc',
      schema: { type: 'object' },
      code: 'const {a,b} = JSON.parse(process.env.INPUT); console.log(a+b);',
      language: 'javascript',
    }));

    // 4. Agent updates its prompt
    createProposal('agent-test-001', 'update_prompt', 'Improve', 'You are a math expert.');

    // Verify everything was stored in DB
    const mcps = getMcpConfigs('agent-test-001');
    expect(mcps.length).toBe(1);
    expect(mcps[0].name).toBe('linear');

    const artifacts = getCodeArtifacts('agent-test-001');
    expect(artifacts.length).toBe(2);
    expect(getCodeArtifact('agent-test-001', '/src/helpers/math.js')!.language).toBe('javascript');
    expect(getCodeArtifact('agent-test-001', '/src/helpers/string.py')!.language).toBe('python');

    const tool = getCustomTool('quick-calc');
    expect(tool).not.toBeNull();
    expect(tool!.script_code).toContain('a+b');

    // Verify proposal history
    const history = getProposalHistory('agent-test-001');
    expect(history.length).toBe(4);
    expect(history.every(p => p.status === 'executed')).toBe(true);
  });

  it('multi-agent isolation: agents cannot see each other artifacts', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');
    const { getMcpConfigs, getCodeArtifacts } = await import('../../src/modules/self-authoring');

    createTestAgent({ id: 'agent-x', name: 'x-agent', channelId: 'CX', selfEvolutionMode: 'autonomous' });
    createTestAgent({ id: 'agent-y', name: 'y-agent', channelId: 'CY', selfEvolutionMode: 'autonomous' });

    // Agent X creates MCP + artifact
    createProposal('agent-x', 'create_mcp', 'X MCP', JSON.stringify({ name: 'x-mcp' }));
    createProposal('agent-x', 'commit_code', 'X code', JSON.stringify({
      files: [{ path: '/src/x.js', content: 'x code' }],
    }));

    // Agent Y creates MCP + artifact
    createProposal('agent-y', 'create_mcp', 'Y MCP', JSON.stringify({ name: 'y-mcp' }));
    createProposal('agent-y', 'commit_code', 'Y code', JSON.stringify({
      files: [{ path: '/src/y.js', content: 'y code' }],
    }));

    // Verify isolation
    expect(getMcpConfigs('agent-x').length).toBe(1);
    expect(getMcpConfigs('agent-x')[0].name).toBe('x-mcp');
    expect(getMcpConfigs('agent-y').length).toBe(1);
    expect(getMcpConfigs('agent-y')[0].name).toBe('y-mcp');

    expect(getCodeArtifacts('agent-x').length).toBe(1);
    expect(getCodeArtifacts('agent-x')[0].file_path).toBe('/src/x.js');
    expect(getCodeArtifacts('agent-y').length).toBe(1);
    expect(getCodeArtifacts('agent-y')[0].file_path).toBe('/src/y.js');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  16. ENTRYPOINT.SH ARTIFACT INJECTION (JSON parsing logic)
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Entrypoint Artifact Injection Format', () => {
  it('CUSTOM_TOOLS_CONFIG JSON format matches entrypoint expectations', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { getToolExecutionScript } = await import('../../src/modules/self-authoring');

    setupTestDb();
    createTestAgent();

    registerCustomTool('inject-tool', '{}', null, 'agent-test-001', {
      code: 'console.log("injected")', language: 'javascript', autoApprove: true,
    });

    const script = getToolExecutionScript('inject-tool');

    // Simulate what execution/index.ts does — build the config array
    const toolConfig = {
      name: 'inject-tool',
      script_code: script,
      language: 'javascript',
    };

    const configJson = JSON.stringify([toolConfig]);
    const parsed = JSON.parse(configJson);

    // Verify entrypoint.sh can parse this
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('inject-tool');
    expect(parsed[0].script_code).toContain('#!/usr/bin/env node');
    expect(parsed[0].language).toBe('javascript');

    db.close();
  });

  it('CODE_ARTIFACTS_CONFIG JSON format matches entrypoint expectations', async () => {
    const { getCodeArtifacts } = await import('../../src/modules/self-authoring');

    setupTestDb();
    createTestAgent();

    db.prepare(`
      INSERT INTO code_artifacts (id, agent_id, file_path, content, language, version)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('art-inj', 'agent-test-001', '/src/utils/helper.ts', 'export const x = 1;', 'typescript', 1);

    const artifacts = getCodeArtifacts('agent-test-001');
    const configJson = JSON.stringify(artifacts.map(a => ({
      file_path: a.file_path,
      content: a.content,
      language: a.language,
    })));

    const parsed = JSON.parse(configJson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file_path).toBe('/src/utils/helper.ts');
    expect(parsed[0].content).toBe('export const x = 1;');

    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  17. SQLITE BOOLEAN HANDLING — end-to-end through actual DB
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: SQLite Boolean Handling', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('approved=0 in DB is treated as falsy throughout the system', async () => {
    const { getCustomTool, registerCustomTool } = await import('../../src/modules/tools');
    const { getToolExecutionScript } = await import('../../src/modules/self-authoring');

    createTestAgent();

    // Agent-authored without autoApprove → stored as 0
    registerCustomTool('unapproved', '{}', null, 'agent-test-001', { code: 'x', language: 'javascript' });

    const tool = getCustomTool('unapproved');
    // SQLite stores as INTEGER 0
    expect(tool!.approved).toBe(0);
    // Truthiness check works for both 0 and false
    expect(!tool!.approved).toBe(true);

    // getToolExecutionScript uses truthiness — should return null
    expect(getToolExecutionScript('unapproved')).toBeFalsy();
  });

  it('approved=1 in DB is treated as truthy throughout the system', async () => {
    const { getCustomTool, registerCustomTool, approveCustomTool } = await import('../../src/modules/tools');
    const { getToolExecutionScript } = await import('../../src/modules/self-authoring');

    createTestAgent();
    makeSuperadmin('admin-user');

    registerCustomTool('will-approve', '{}', null, 'agent-test-001', { code: 'console.log("ok")', language: 'javascript' });
    approveCustomTool('will-approve', 'admin-user');

    const tool = getCustomTool('will-approve');
    // SQLite stores as INTEGER 1
    expect(tool!.approved).toBe(1);
    expect(!tool!.approved).toBe(false);

    // getToolExecutionScript should return script
    const script = getToolExecutionScript('will-approve');
    expect(script).not.toBeNull();
    expect(script).toContain('ok');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  18. ERROR HANDLING & EDGE CASES
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E: Error Handling & Edge Cases', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => db.close());

  it('getAgent returns null for nonexistent agent', async () => {
    const { getAgent } = await import('../../src/modules/agents');
    expect(getAgent('nonexistent')).toBeFalsy();
  });

  it('getCustomTool returns null for nonexistent tool', async () => {
    const { getCustomTool } = await import('../../src/modules/tools');
    expect(getCustomTool('nonexistent')).toBeFalsy();
  });

  it('getCodeArtifact returns null for nonexistent path', async () => {
    const { getCodeArtifact } = await import('../../src/modules/self-authoring');
    createTestAgent();
    expect(getCodeArtifact('agent-test-001', '/nonexistent/file.ts')).toBeFalsy();
  });

  it('getAuthoredSkill returns null for nonexistent id', async () => {
    const { getAuthoredSkill } = await import('../../src/modules/self-authoring');
    expect(getAuthoredSkill('nonexistent-id')).toBeFalsy();
  });

  it('updateToolCode throws for nonexistent tool', async () => {
    const { updateToolCode } = await import('../../src/modules/self-authoring');
    expect(() => updateToolCode('ghost', 'code', 'javascript', 'user')).toThrow(/not found/);
  });

  it('approveAuthoredSkill throws for nonexistent skill', async () => {
    const { approveAuthoredSkill } = await import('../../src/modules/self-authoring');
    expect(() => approveAuthoredSkill('ghost-id', 'admin')).toThrow(/not found/);
  });

  it('shareToolWithAgent throws for nonexistent target agent', async () => {
    const { registerCustomTool } = await import('../../src/modules/tools');
    const { shareToolWithAgent } = await import('../../src/modules/self-authoring');

    createTestAgent();
    registerCustomTool('orphan-tool', '{}', null, 'agent-test-001', { code: 'x', autoApprove: true });

    expect(() => shareToolWithAgent('orphan-tool', 'agent-test-001', 'ghost-agent')).toThrow(/not found/);
  });

  it('createProposal throws for nonexistent agent', async () => {
    const { createProposal } = await import('../../src/modules/self-evolution');
    expect(() => createProposal('nonexistent', 'update_prompt', 'x', 'y')).toThrow(/not found/);
  });

  it('approveMcpConfig throws for nonexistent config', async () => {
    const { approveMcpConfig } = await import('../../src/modules/self-authoring');
    createTestAgent();
    makeSuperadmin('admin-user');
    expect(() => approveMcpConfig('ghost-mcp', 'admin-user')).toThrow(/not found/);
  });

  it('empty tool list returns empty discovery results', async () => {
    const { discoverTools } = await import('../../src/modules/self-authoring');
    createTestAgent();

    const results = discoverTools('anything');
    expect(results).toEqual([]);
  });

  it('getAllToolAnalytics returns empty for agent with no runs', async () => {
    const { getAllToolAnalytics } = await import('../../src/modules/self-authoring');
    createTestAgent();

    const analytics = getAllToolAnalytics('agent-test-001');
    expect(analytics).toEqual([]);
  });
});
