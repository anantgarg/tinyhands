import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockWithTransaction = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  withTransaction: (fn: any) => mockWithTransaction(fn),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetAgent = vi.fn();
const mockUpdateAgent = vi.fn();
vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
  updateAgent: (...args: any[]) => mockUpdateAgent(...args),
}));

const mockRegisterCustomTool = vi.fn();
const mockGetCustomTool = vi.fn();
const mockListCustomTools = vi.fn();
vi.mock('../../src/modules/tools', () => ({
  registerCustomTool: (...args: any[]) => mockRegisterCustomTool(...args),
  getCustomTool: (...args: any[]) => mockGetCustomTool(...args),
  listCustomTools: (...args: any[]) => mockListCustomTools(...args),
}));

const mockRegisterSkill = vi.fn();
const mockAttachSkillToAgent = vi.fn();
vi.mock('../../src/modules/skills', () => ({
  registerSkill: (...args: any[]) => mockRegisterSkill(...args),
  attachSkillToAgent: (...args: any[]) => mockAttachSkillToAgent(...args),
}));

const mockCreateProposal = vi.fn();
vi.mock('../../src/modules/self-evolution', () => ({
  createProposal: (...args: any[]) => mockCreateProposal(...args),
}));

const mockCanModifyAgent = vi.fn();
vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
}));

vi.mock('../../src/config', () => ({
  config: { docker: { baseImage: 'node:20-slim' } },
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

const mockDockerCreateContainer = vi.fn();
vi.mock('dockerode', () => ({
  default: vi.fn().mockImplementation(() => ({
    createContainer: (...args: any[]) => mockDockerCreateContainer(...args),
  })),
}));

const mockMkdtempSync = vi.fn().mockReturnValue('/tmp/tj-sandbox-test');
const mockWriteFileSyncFs = vi.fn();
const mockRmSync = vi.fn();
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdtempSync: (...args: any[]) => mockMkdtempSync(...args),
    writeFileSync: (...args: any[]) => mockWriteFileSyncFs(...args),
    unlinkSync: vi.fn(),
    rmSync: (...args: any[]) => mockRmSync(...args),
  };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    tmpdir: vi.fn().mockReturnValue('/tmp'),
  };
});

import {
  validateToolCode,
  validateToolName,
  validateArtifactPath,
  recordToolRun,
  getToolAnalytics,
  getAllToolAnalytics,
  getToolVersions,
  updateToolCode,
  rollbackTool,
  shareToolWithAgent,
  discoverTools,
  createToolPipeline,
  getToolExecutionScript,
  getMcpConfigs,
  getCodeArtifacts,
  getCodeArtifact,
  getAuthoredSkills,
  getAuthoredSkill,
  approveAuthoredSkill,
  updateAuthoredSkillTemplate,
  approveMcpConfig,
  authorTool,
  authorSkill,
} from '../../src/modules/self-authoring';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ── Helpers ──

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-1',
    name: 'test-agent',
    tools: ['Read', 'Write'],
    self_evolution_mode: 'approve-first',
    ...overrides,
  };
}

function makeCustomTool(overrides: Record<string, any> = {}) {
  return {
    id: 'tool-1',
    name: 'my-tool',
    tool_type: 'custom',
    schema_json: '{"type":"object","properties":{}}',
    script_code: 'console.log("hello")',
    script_path: null,
    language: 'javascript',
    registered_by: 'agent-1',
    approved: true,
    access_level: 'agent',
    config_json: '{}',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSkill(overrides: Record<string, any> = {}) {
  return {
    id: 'skill-1',
    agent_id: 'agent-1',
    name: 'summarize-email',
    description: 'Summarize emails',
    skill_type: 'prompt_template',
    template: 'Summarize: {{body}}',
    version: 1,
    approved: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════
//  Tests
// ══════════════════════════════════════════════════

describe('Self-Authoring Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const fakeClient = { query: vi.fn() };
      return fn(fakeClient);
    });
  });

  // ────────────────────────────────────────────
  //  validateToolName
  // ────────────────────────────────────────────
  describe('validateToolName', () => {
    it('accepts valid kebab-case names', () => {
      expect(() => validateToolName('my-tool')).not.toThrow();
      expect(() => validateToolName('csv-parser')).not.toThrow();
      expect(() => validateToolName('tool123')).not.toThrow();
      expect(() => validateToolName('abc')).not.toThrow();
      expect(() => validateToolName('a1b')).not.toThrow();
    });

    it('rejects empty names', () => {
      expect(() => validateToolName('')).toThrow('3-40 characters');
    });

    it('rejects names shorter than 3 characters', () => {
      expect(() => validateToolName('ab')).toThrow('3-40 characters');
    });

    it('rejects names longer than 40 characters', () => {
      expect(() => validateToolName('a'.repeat(41))).toThrow('3-40 characters');
    });

    it('rejects names with uppercase letters', () => {
      expect(() => validateToolName('MyTool')).toThrow('kebab-case');
    });

    it('rejects names with spaces', () => {
      expect(() => validateToolName('my tool')).toThrow('kebab-case');
    });

    it('rejects names starting with hyphen', () => {
      expect(() => validateToolName('-my-tool')).toThrow('kebab-case');
    });

    it('rejects names ending with hyphen', () => {
      expect(() => validateToolName('my-tool-')).toThrow('kebab-case');
    });

    it('rejects consecutive hyphens', () => {
      expect(() => validateToolName('my--tool')).toThrow('consecutive hyphens');
    });

    it('rejects shell injection attempts', () => {
      expect(() => validateToolName('tool;rm -rf /')).toThrow();
      expect(() => validateToolName('tool$(whoami)')).toThrow();
    });

    it('rejects path traversal attempts', () => {
      expect(() => validateToolName('../etc/passwd')).toThrow();
    });
  });

  // ────────────────────────────────────────────
  //  validateToolCode
  // ────────────────────────────────────────────
  describe('validateToolCode', () => {
    it('allows safe JavaScript code', () => {
      expect(() => validateToolCode(
        'const x = JSON.parse(process.env.INPUT); console.log(x);',
        'javascript'
      )).not.toThrow();
    });

    it('allows safe Python code', () => {
      expect(() => validateToolCode(
        'import json, os\ndata = json.loads(os.environ["INPUT"])\nprint(data)',
        'python'
      )).not.toThrow();
    });

    it('blocks process.exit', () => {
      expect(() => validateToolCode('process.exit(1)', 'javascript')).toThrow('forbidden pattern');
    });

    it('blocks child_process require', () => {
      expect(() => validateToolCode('require("child_process")', 'javascript')).toThrow('forbidden pattern');
    });

    it('blocks net module require', () => {
      expect(() => validateToolCode('require("net")', 'javascript')).toThrow('forbidden pattern');
    });

    it('blocks http module require', () => {
      expect(() => validateToolCode('require("http")', 'javascript')).toThrow('forbidden pattern');
    });

    it('blocks eval calls', () => {
      expect(() => validateToolCode('eval("alert(1)")', 'javascript')).toThrow('forbidden pattern');
    });

    it('blocks Function constructor', () => {
      expect(() => validateToolCode('new Function("return 1")()', 'javascript')).toThrow('forbidden pattern');
    });

    it('blocks rm -rf /', () => {
      expect(() => validateToolCode('rm -rf /', 'bash')).toThrow('forbidden pattern');
    });

    it('blocks fork bombs', () => {
      expect(() => validateToolCode(':(){ :|:& };:', 'bash')).toThrow('forbidden pattern');
    });

    it('blocks Python subprocess import', () => {
      expect(() => validateToolCode('import subprocess', 'python')).toThrow('forbidden pattern');
    });

    it('blocks Python os.system', () => {
      expect(() => validateToolCode('os.system("ls")', 'python')).toThrow('forbidden pattern');
    });

    it('blocks Python __import__', () => {
      expect(() => validateToolCode('__import__("os")', 'python')).toThrow('forbidden pattern');
    });

    it('blocks reading /etc files', () => {
      expect(() => validateToolCode('open("/etc/passwd")', 'python')).toThrow('forbidden pattern');
    });

    it('rejects code over 50KB', () => {
      expect(() => validateToolCode('x'.repeat(51000), 'javascript')).toThrow('maximum size');
    });

    it('rejects code over 500 lines', () => {
      expect(() => validateToolCode(Array(501).fill('x = 1').join('\n'), 'javascript')).toThrow('maximum line count');
    });

    it('accepts code at exactly 500 lines', () => {
      expect(() => validateToolCode(Array(500).fill('x = 1').join('\n'), 'javascript')).not.toThrow();
    });

    it('accepts code at exactly 50KB', () => {
      expect(() => validateToolCode('x'.repeat(50000), 'javascript')).not.toThrow();
    });
  });

  // ────────────────────────────────────────────
  //  validateArtifactPath
  // ────────────────────────────────────────────
  describe('validateArtifactPath', () => {
    it('accepts valid absolute paths', () => {
      expect(() => validateArtifactPath('/src/utils/helper.ts')).not.toThrow();
      expect(() => validateArtifactPath('/app/index.js')).not.toThrow();
      expect(() => validateArtifactPath('/home/user/project/file.txt')).not.toThrow();
    });

    it('blocks path traversal with ..', () => {
      expect(() => validateArtifactPath('/src/../../etc/passwd')).toThrow('".."');
    });

    it('blocks null bytes', () => {
      expect(() => validateArtifactPath('/src/file.ts\0.jpg')).toThrow('null bytes');
    });

    it('requires absolute paths', () => {
      expect(() => validateArtifactPath('relative/path.ts')).toThrow('absolute');
    });

    it('blocks /etc/', () => {
      expect(() => validateArtifactPath('/etc/passwd')).toThrow('/etc/');
    });

    it('blocks /proc/', () => {
      expect(() => validateArtifactPath('/proc/self/environ')).toThrow('/proc/');
    });

    it('blocks /sys/', () => {
      expect(() => validateArtifactPath('/sys/class/net')).toThrow('/sys/');
    });

    it('blocks /dev/', () => {
      expect(() => validateArtifactPath('/dev/sda')).toThrow('/dev/');
    });

    it('blocks /boot/', () => {
      expect(() => validateArtifactPath('/boot/vmlinuz')).toThrow('/boot/');
    });

    it('blocks /root/', () => {
      expect(() => validateArtifactPath('/root/.bashrc')).toThrow('/root/');
    });

    it('blocks /var/run/', () => {
      expect(() => validateArtifactPath('/var/run/docker.sock')).toThrow('/var/run/');
    });
  });

  // ────────────────────────────────────────────
  //  recordToolRun
  // ────────────────────────────────────────────
  describe('recordToolRun', () => {
    it('inserts a tool run record', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await recordToolRun(TEST_WORKSPACE_ID, 'my-tool', 'agent-1', true, 150, null);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('INSERT INTO tool_runs');
      expect(params).toContain('test-uuid-1234');
      expect(params).toContain(TEST_WORKSPACE_ID);
      expect(params).toContain('my-tool');
      expect(params).toContain('agent-1');
    });

    it('records failed run with error message', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await recordToolRun(TEST_WORKSPACE_ID, 'my-tool', 'agent-1', false, 50, 'ReferenceError: x is not defined');

      const [, params] = mockExecute.mock.calls[0];
      expect(params).toContain(false);
      expect(params).toContain('ReferenceError: x is not defined');
    });
  });

  // ────────────────────────────────────────────
  //  getToolAnalytics
  // ────────────────────────────────────────────
  describe('getToolAnalytics', () => {
    it('returns analytics for a tool with runs', async () => {
      mockQueryOne
        .mockResolvedValueOnce({
          total_runs: '10',
          successes: '8',
          avg_duration: '123.5',
          last_used: '2025-06-15T12:00:00Z',
        })
        .mockResolvedValueOnce({ error: 'Some error' });

      const result = await getToolAnalytics(TEST_WORKSPACE_ID, 'my-tool');

      expect(result).toEqual({
        toolName: 'my-tool',
        totalRuns: 10,
        successRate: 0.8,
        avgDurationMs: 124,
        lastUsed: '2025-06-15T12:00:00Z',
        lastError: 'Some error',
      });
    });

    it('returns zeroed analytics when no runs exist', async () => {
      mockQueryOne
        .mockResolvedValueOnce({
          total_runs: '0',
          successes: '0',
          avg_duration: '0',
          last_used: null,
        })
        .mockResolvedValueOnce(null);

      const result = await getToolAnalytics(TEST_WORKSPACE_ID, 'unused-tool');

      expect(result).toEqual({
        toolName: 'unused-tool',
        totalRuns: 0,
        successRate: 0,
        avgDurationMs: 0,
        lastUsed: null,
        lastError: null,
      });
    });

    it('handles null stats row gracefully', async () => {
      mockQueryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await getToolAnalytics(TEST_WORKSPACE_ID, 'no-data');

      expect(result.totalRuns).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.avgDurationMs).toBe(0);
      expect(result.lastUsed).toBeNull();
      expect(result.lastError).toBeNull();
    });

    it('computes 100% success rate when all succeed', async () => {
      mockQueryOne
        .mockResolvedValueOnce({
          total_runs: '5',
          successes: '5',
          avg_duration: '100',
          last_used: '2025-06-15T12:00:00Z',
        })
        .mockResolvedValueOnce(null);

      const result = await getToolAnalytics(TEST_WORKSPACE_ID, 'perfect-tool');
      expect(result.successRate).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  //  getAllToolAnalytics
  // ────────────────────────────────────────────
  describe('getAllToolAnalytics', () => {
    it('returns analytics for all tools when no agentId', async () => {
      mockQuery.mockResolvedValueOnce([
        { tool_name: 'tool-a' },
        { tool_name: 'tool-b' },
      ]);
      mockQueryOne
        .mockResolvedValueOnce({ total_runs: '5', successes: '5', avg_duration: '100', last_used: null })
        .mockResolvedValueOnce(null);
      mockQueryOne
        .mockResolvedValueOnce({ total_runs: '3', successes: '1', avg_duration: '200', last_used: null })
        .mockResolvedValueOnce({ error: 'fail' });

      const results = await getAllToolAnalytics(TEST_WORKSPACE_ID);

      expect(results).toHaveLength(2);
      expect(results[0].toolName).toBe('tool-a');
      expect(results[1].toolName).toBe('tool-b');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT tool_name FROM tool_runs'),
        expect.arrayContaining([TEST_WORKSPACE_ID])
      );
    });

    it('filters by agentId when provided', async () => {
      mockQuery.mockResolvedValueOnce([{ tool_name: 'tool-x' }]);
      mockQueryOne
        .mockResolvedValueOnce({ total_runs: '1', successes: '1', avg_duration: '50', last_used: null })
        .mockResolvedValueOnce(null);

      const results = await getAllToolAnalytics(TEST_WORKSPACE_ID, 'agent-1');

      expect(results).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT tool_name FROM tool_runs WHERE agent_id'),
        expect.arrayContaining(['agent-1', TEST_WORKSPACE_ID])
      );
    });

    it('returns empty array when no tools exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const results = await getAllToolAnalytics(TEST_WORKSPACE_ID);

      expect(results).toEqual([]);
    });
  });

  // ────────────────────────────────────────────
  //  getToolVersions
  // ────────────────────────────────────────────
  describe('getToolVersions', () => {
    it('returns version history ordered by version DESC', async () => {
      const versions = [
        { version: 3, changed_by: 'user1', created_at: '2025-03-01' },
        { version: 2, changed_by: 'agent-1', created_at: '2025-02-01' },
        { version: 1, changed_by: 'agent-1', created_at: '2025-01-01' },
      ];
      mockQuery.mockResolvedValueOnce(versions);

      const result = await getToolVersions(TEST_WORKSPACE_ID, 'my-tool');

      expect(result).toEqual(versions);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('tool_versions'),
        expect.arrayContaining(['my-tool'])
      );
    });

    it('returns empty array for tool with no versions', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getToolVersions(TEST_WORKSPACE_ID, 'new-tool');
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────
  //  updateToolCode
  // ────────────────────────────────────────────
  describe('updateToolCode', () => {
    it('creates a version and updates tool code within a transaction', async () => {
      const tool = makeCustomTool({ script_code: 'old code', language: 'javascript' });
      mockGetCustomTool.mockResolvedValueOnce(tool);
      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementationOnce(async (fn: any) => fn(fakeClient));

      await updateToolCode(TEST_WORKSPACE_ID, 'my-tool', 'new code', 'javascript', 'user-1');

      expect(mockGetCustomTool).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'my-tool');
      expect(fakeClient.query).toHaveBeenCalledTimes(2);
      expect(fakeClient.query.mock.calls[0][0]).toContain('INSERT INTO tool_versions');
      expect(fakeClient.query.mock.calls[1][0]).toContain('UPDATE custom_tools');
      expect(fakeClient.query.mock.calls[1][1]).toEqual(['new code', 'javascript', 'my-tool', TEST_WORKSPACE_ID]);
    });

    it('throws if tool not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);

      await expect(updateToolCode(TEST_WORKSPACE_ID, 'nonexistent', 'code', 'javascript', 'user-1'))
        .rejects.toThrow('not found');
    });

    it('throws if new code contains forbidden patterns', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool());

      await expect(updateToolCode(TEST_WORKSPACE_ID, 'my-tool', 'eval("bad")', 'javascript', 'user-1'))
        .rejects.toThrow('forbidden pattern');
    });

    it('uses empty string fallback when tool.script_code is null', async () => {
      const tool = makeCustomTool({ script_code: null, language: 'javascript' });
      mockGetCustomTool.mockResolvedValueOnce(tool);
      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementationOnce(async (fn: any) => fn(fakeClient));

      await updateToolCode(TEST_WORKSPACE_ID, 'my-tool', 'new code', 'javascript', 'user-1');

      // The INSERT INTO tool_versions should use '' (empty string) as the old script_code
      const insertParams = fakeClient.query.mock.calls[0][1];
      expect(insertParams[5]).toBe(''); // tool.script_code || '' fallback
    });
  });

  // ────────────────────────────────────────────
  //  rollbackTool
  // ────────────────────────────────────────────
  describe('rollbackTool', () => {
    it('rolls back to a specific version', async () => {
      mockQueryOne.mockResolvedValueOnce({
        script_code: 'console.log("v2")',
        language: 'javascript',
      });
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool());
      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementationOnce(async (fn: any) => fn(fakeClient));

      await rollbackTool(TEST_WORKSPACE_ID, 'my-tool', 2, 'user-1');

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('tool_versions'),
        expect.arrayContaining(['my-tool', 2])
      );
    });

    it('throws if version not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(rollbackTool(TEST_WORKSPACE_ID, 'my-tool', 99, 'user-1'))
        .rejects.toThrow('Version 99 not found');
    });
  });

  // ────────────────────────────────────────────
  //  shareToolWithAgent
  // ────────────────────────────────────────────
  describe('shareToolWithAgent', () => {
    it('adds tool to target agent tools list', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool({ registered_by: 'agent-1' }));
      mockGetAgent.mockResolvedValueOnce(makeAgent({ id: 'agent-2', tools: ['Read'] }));
      mockUpdateAgent.mockResolvedValueOnce(undefined);

      await shareToolWithAgent(TEST_WORKSPACE_ID, 'my-tool', 'agent-1', 'agent-2');

      expect(mockUpdateAgent).toHaveBeenCalledWith(
        TEST_WORKSPACE_ID,
        'agent-2',
        { tools: ['Read', 'my-tool'] },
        'agent-1'
      );
    });

    it('does not duplicate tool if already in target list', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool({ registered_by: 'agent-1' }));
      mockGetAgent.mockResolvedValueOnce(makeAgent({ id: 'agent-2', tools: ['Read', 'my-tool'] }));

      await shareToolWithAgent(TEST_WORKSPACE_ID, 'my-tool', 'agent-1', 'agent-2');

      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });

    it('throws if tool not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);

      await expect(shareToolWithAgent(TEST_WORKSPACE_ID, 'nonexistent', 'agent-1', 'agent-2'))
        .rejects.toThrow('not found');
    });

    it('throws if agent does not own the tool', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool({ registered_by: 'other-agent' }));

      await expect(shareToolWithAgent(TEST_WORKSPACE_ID, 'my-tool', 'agent-1', 'agent-2'))
        .rejects.toThrow('does not own');
    });

    it('throws if target agent not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool({ registered_by: 'agent-1' }));
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(shareToolWithAgent(TEST_WORKSPACE_ID, 'my-tool', 'agent-1', 'agent-2'))
        .rejects.toThrow('not found');
    });
  });

  // ────────────────────────────────────────────
  //  discoverTools
  // ────────────────────────────────────────────
  describe('discoverTools', () => {
    it('searches tools by name (case-insensitive)', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        makeCustomTool({ name: 'csv-parser', schema_json: '{}' }),
        makeCustomTool({ name: 'json-validator', schema_json: '{}' }),
        makeCustomTool({ name: 'csv-to-json', schema_json: '{}' }),
      ]);

      const results = await discoverTools(TEST_WORKSPACE_ID, 'CSV');

      expect(results).toHaveLength(2);
      expect(results.map((t: any) => t.name)).toEqual(['csv-parser', 'csv-to-json']);
    });

    it('searches tools by schema content', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        makeCustomTool({ name: 'tool-a', schema_json: '{"description":"parses CSV files"}' }),
        makeCustomTool({ name: 'tool-b', schema_json: '{"description":"sends emails"}' }),
      ]);

      const results = await discoverTools(TEST_WORKSPACE_ID, 'csv');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('tool-a');
    });

    it('returns empty array when nothing matches', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        makeCustomTool({ name: 'tool-a', schema_json: '{}' }),
      ]);

      const results = await discoverTools(TEST_WORKSPACE_ID, 'nonexistent');

      expect(results).toEqual([]);
    });

    it('returns all tools if query matches everything', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        makeCustomTool({ name: 'tool-abc', schema_json: '{}' }),
        makeCustomTool({ name: 'tool-abcdef', schema_json: '{}' }),
      ]);

      const results = await discoverTools(TEST_WORKSPACE_ID, 'tool');

      expect(results).toHaveLength(2);
    });
  });

  // ────────────────────────────────────────────
  //  createToolPipeline
  // ────────────────────────────────────────────
  describe('createToolPipeline', () => {
    it('creates a pipeline tool when all steps reference existing tools', async () => {
      const toolA = makeCustomTool({ name: 'fetch-data', schema_json: '{"type":"object","properties":{}}' });
      const toolB = makeCustomTool({ name: 'transform' });
      mockGetCustomTool
        .mockResolvedValueOnce(toolA)
        .mockResolvedValueOnce(toolB)
        .mockResolvedValueOnce(toolA);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'etl-pipeline' }));

      const pipeline = {
        name: 'etl-pipeline',
        description: 'Fetch then transform',
        steps: [
          { toolName: 'fetch-data', inputMapping: {} },
          { toolName: 'transform', inputMapping: { data: 'output' } },
        ],
      };

      const result = await createToolPipeline(TEST_WORKSPACE_ID, 'agent-1', pipeline);

      expect(result.name).toBe('etl-pipeline');
      expect(mockRegisterCustomTool).toHaveBeenCalledWith(
        TEST_WORKSPACE_ID,
        'etl-pipeline',
        expect.any(String),
        null,
        'agent-1',
        expect.objectContaining({ language: 'javascript', autoApprove: true })
      );
    });

    it('uses default schema when first tool returns null', async () => {
      const toolB = makeCustomTool({ name: 'transform' });
      mockGetCustomTool
        .mockResolvedValueOnce(toolB) // step validation: transform exists
        .mockResolvedValueOnce(null); // first tool lookup returns null

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'solo-pipeline' }));

      const pipeline = {
        name: 'solo-pipeline',
        description: 'Single step',
        steps: [
          { toolName: 'transform', inputMapping: {} },
        ],
      };

      const result = await createToolPipeline(TEST_WORKSPACE_ID, 'agent-1', pipeline);

      expect(result.name).toBe('solo-pipeline');
      // Should have used default schema since firstTool was null
      expect(mockRegisterCustomTool).toHaveBeenCalledWith(
        TEST_WORKSPACE_ID,
        'solo-pipeline',
        JSON.stringify({ type: 'object', properties: {} }),
        null,
        'agent-1',
        expect.any(Object),
      );
    });

    it('throws if a pipeline step references an unknown tool', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool());
      mockGetCustomTool.mockResolvedValueOnce(null);

      const pipeline = {
        name: 'broken-pipe',
        description: 'Bad pipeline',
        steps: [
          { toolName: 'exists', inputMapping: {} },
          { toolName: 'nonexistent', inputMapping: {} },
        ],
      };

      await expect(createToolPipeline(TEST_WORKSPACE_ID, 'agent-1', pipeline))
        .rejects.toThrow('unknown tool: nonexistent');
    });
  });

  // ────────────────────────────────────────────
  //  getToolExecutionScript
  // ────────────────────────────────────────────
  describe('getToolExecutionScript', () => {
    it('returns wrapped JavaScript with shebang', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: 'console.log("hi")', language: 'javascript', approved: true })
      );

      const script = await getToolExecutionScript(TEST_WORKSPACE_ID, 'my-tool');

      expect(script).not.toBeNull();
      expect(script).toContain('#!/usr/bin/env node');
      expect(script).toContain("'use strict'");
      expect(script).toContain('Agent-authored tool: my-tool');
      expect(script).toContain('console.log("hi")');
    });

    it('returns wrapped Python with shebang', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: 'print("hi")', language: 'python', approved: true })
      );

      const script = await getToolExecutionScript(TEST_WORKSPACE_ID, 'py-tool');

      expect(script).toContain('#!/usr/bin/env python3');
      expect(script).toContain('import os, json');
    });

    it('returns wrapped Bash with shebang', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: 'echo hi', language: 'bash', approved: true })
      );

      const script = await getToolExecutionScript(TEST_WORKSPACE_ID, 'sh-tool');

      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('set -euo pipefail');
    });

    it('returns null if tool has no script_code', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: null, approved: true })
      );

      const script = await getToolExecutionScript(TEST_WORKSPACE_ID, 'no-code');

      expect(script).toBeNull();
    });

    it('returns null if tool is not approved', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: 'code', approved: false })
      );

      const script = await getToolExecutionScript(TEST_WORKSPACE_ID, 'unapproved');

      expect(script).toBeNull();
    });

    it('returns null if tool not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);

      const script = await getToolExecutionScript(TEST_WORKSPACE_ID, 'nonexistent');

      expect(script).toBeNull();
    });

    it('uses default JavaScript shebang for unknown language', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: 'some code', language: 'rust', approved: true })
      );

      const script = await getToolExecutionScript(TEST_WORKSPACE_ID, 'rust-tool');

      expect(script).not.toBeNull();
      expect(script).toContain('#!/usr/bin/env node');
    });
  });

  // ────────────────────────────────────────────
  //  getMcpConfigs
  // ────────────────────────────────────────────
  describe('getMcpConfigs', () => {
    it('returns MCP configs for an agent', async () => {
      const configs = [
        { id: 'mcp-1', agent_id: 'agent-1', name: 'linear', config_json: '{}', approved: true, created_at: '', updated_at: '' },
        { id: 'mcp-2', agent_id: 'agent-1', name: 'github', config_json: '{}', approved: false, created_at: '', updated_at: '' },
      ];
      mockQuery.mockResolvedValueOnce(configs);

      const result = await getMcpConfigs(TEST_WORKSPACE_ID, 'agent-1');

      expect(result).toEqual(configs);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('mcp_configs'),
        expect.arrayContaining(['agent-1', TEST_WORKSPACE_ID])
      );
    });

    it('returns empty array when no configs exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getMcpConfigs(TEST_WORKSPACE_ID, 'agent-none');
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────
  //  approveMcpConfig
  // ────────────────────────────────────────────
  describe('approveMcpConfig', () => {
    it('approves MCP config when user has permission', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'mcp-1', agent_id: 'agent-1', name: 'test', config_json: '{}', approved: false });
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await approveMcpConfig(TEST_WORKSPACE_ID, 'mcp-1', 'user-1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE mcp_configs'),
        expect.arrayContaining(['mcp-1'])
      );
    });

    it('throws if MCP config not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(approveMcpConfig(TEST_WORKSPACE_ID, 'nonexistent', 'user-1'))
        .rejects.toThrow('not found');
    });

    it('throws if user lacks permission', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'mcp-1', agent_id: 'agent-1' });
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(approveMcpConfig(TEST_WORKSPACE_ID, 'mcp-1', 'user-1'))
        .rejects.toThrow('Insufficient permissions');
    });
  });

  // ────────────────────────────────────────────
  //  getCodeArtifacts / getCodeArtifact
  // ────────────────────────────────────────────
  describe('getCodeArtifacts', () => {
    it('returns artifacts for an agent', async () => {
      const artifacts = [
        { id: 'art-1', agent_id: 'agent-1', file_path: '/src/a.ts', content: 'code', language: 'typescript', version: 2 },
        { id: 'art-2', agent_id: 'agent-1', file_path: '/src/b.ts', content: 'code', language: 'typescript', version: 1 },
      ];
      mockQuery.mockResolvedValueOnce(artifacts);

      const result = await getCodeArtifacts(TEST_WORKSPACE_ID, 'agent-1');

      expect(result).toEqual(artifacts);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('code_artifacts'),
        expect.arrayContaining(['agent-1', TEST_WORKSPACE_ID])
      );
    });

    it('returns empty array when no artifacts exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getCodeArtifacts(TEST_WORKSPACE_ID, 'agent-none');
      expect(result).toEqual([]);
    });
  });

  describe('getCodeArtifact', () => {
    it('returns artifact by agentId and filePath', async () => {
      const artifact = { id: 'art-1', agent_id: 'agent-1', file_path: '/src/a.ts', content: 'code' };
      mockQueryOne.mockResolvedValueOnce(artifact);

      const result = await getCodeArtifact(TEST_WORKSPACE_ID, 'agent-1', '/src/a.ts');

      expect(result).toEqual(artifact);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('code_artifacts'),
        expect.arrayContaining(['agent-1', '/src/a.ts'])
      );
    });

    it('returns null when artifact not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getCodeArtifact(TEST_WORKSPACE_ID, 'agent-1', '/nonexistent');
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────
  //  getAuthoredSkills / getAuthoredSkill
  // ────────────────────────────────────────────
  describe('getAuthoredSkills', () => {
    it('returns skills for an agent', async () => {
      const skills = [makeSkill(), makeSkill({ id: 'skill-2', name: 'other-skill' })];
      mockQuery.mockResolvedValueOnce(skills);

      const result = await getAuthoredSkills(TEST_WORKSPACE_ID, 'agent-1');

      expect(result).toEqual(skills);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('authored_skills'),
        expect.arrayContaining(['agent-1', TEST_WORKSPACE_ID])
      );
    });

    it('returns empty array when no skills exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getAuthoredSkills(TEST_WORKSPACE_ID, 'agent-none');
      expect(result).toEqual([]);
    });
  });

  describe('getAuthoredSkill', () => {
    it('returns a skill by id', async () => {
      const skill = makeSkill();
      mockQueryOne.mockResolvedValueOnce(skill);

      const result = await getAuthoredSkill(TEST_WORKSPACE_ID, 'skill-1');

      expect(result).toEqual(skill);
    });

    it('returns null when skill not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getAuthoredSkill(TEST_WORKSPACE_ID, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────
  //  approveAuthoredSkill
  // ────────────────────────────────────────────
  describe('approveAuthoredSkill', () => {
    it('approves skill when user has permission', async () => {
      mockQueryOne.mockResolvedValueOnce(makeSkill({ approved: false }));
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await approveAuthoredSkill(TEST_WORKSPACE_ID, 'skill-1', 'user-1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE authored_skills'),
        expect.arrayContaining(['skill-1'])
      );
    });

    it('throws if skill not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      await expect(approveAuthoredSkill(TEST_WORKSPACE_ID, 'nonexistent', 'user-1'))
        .rejects.toThrow('not found');
    });

    it('throws if user lacks permission', async () => {
      mockQueryOne.mockResolvedValueOnce(makeSkill());
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(approveAuthoredSkill(TEST_WORKSPACE_ID, 'skill-1', 'user-1'))
        .rejects.toThrow('Insufficient permissions');
    });
  });

  // ────────────────────────────────────────────
  //  updateAuthoredSkillTemplate
  // ────────────────────────────────────────────
  describe('updateAuthoredSkillTemplate', () => {
    it('updates template and increments version', async () => {
      mockQueryOne.mockResolvedValueOnce(makeSkill({ version: 1 }));
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await updateAuthoredSkillTemplate(TEST_WORKSPACE_ID, 'skill-1', 'New template: {{var}}', 'user-1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('version = version + 1'),
        expect.arrayContaining(['New template: {{var}}', 'skill-1'])
      );
    });

    it('throws if skill not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      await expect(updateAuthoredSkillTemplate(TEST_WORKSPACE_ID, 'nonexistent', 'template', 'user-1'))
        .rejects.toThrow('not found');
    });

    it('throws if user lacks permission', async () => {
      mockQueryOne.mockResolvedValueOnce(makeSkill());
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(updateAuthoredSkillTemplate(TEST_WORKSPACE_ID, 'skill-1', 'template', 'user-1'))
        .rejects.toThrow('Insufficient permissions');
    });
  });

  // ────────────────────────────────────────────
  //  authorTool (AI-powered, lines 54-117)
  // ────────────────────────────────────────────
  describe('authorTool', () => {
    it('throws if agent not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(authorTool(TEST_WORKSPACE_ID, 'nonexistent', 'make a csv parser'))
        .rejects.toThrow('Agent nonexistent not found');
    });

    it('authors a tool end-to-end when AI returns valid JSON', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'approve-first' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      // Mock Anthropic SDK
      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'csv-parser',
            description: 'Parses CSV data',
            language: 'javascript',
            inputSchema: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] },
            code: 'const input = JSON.parse(process.env.INPUT || "{}"); console.log(JSON.stringify({rows: input.data.split("\\n")}));',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      const registeredTool = makeCustomTool({ name: 'csv-parser' });
      mockRegisterCustomTool.mockResolvedValueOnce(registeredTool);
      mockExecute.mockResolvedValue({ rowCount: 1 }); // recordToolRun
      mockCreateProposal.mockResolvedValueOnce(undefined);

      // The tool will try sandbox test which will fail in test environment (no Docker)
      // But the try/catch around sandboxTest handles this gracefully

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'make a csv parser');

      expect(result.tool).toEqual(registeredTool);
      expect(result.requiresApproval).toBe(true);
      expect(mockRegisterCustomTool).toHaveBeenCalled();
      expect(mockCreateProposal).toHaveBeenCalled();
    });

    it('sets requiresApproval=false when self_evolution_mode is autonomous', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'my-helper',
            description: 'A helper',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("hello");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'my-helper' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a helper tool');

      expect(result.requiresApproval).toBe(false);
    });

    it('exercises sandbox success path (container exits with code 0)', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'sandbox-ok',
            description: 'Sandbox test tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: { data: { type: 'string' } } },
            code: 'console.log("ok");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // Mock Docker container — exit code 0 (success)
      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue(Buffer.from('{"result":"ok"}')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'sandbox-ok' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a sandbox test');

      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(true);
    });

    it('exercises sandbox failure path (container exits with non-zero code)', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn()
        // generateToolCode
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              name: 'sandbox-fail',
              description: 'Sandbox fail tool',
              language: 'javascript',
              inputSchema: { type: 'object', properties: {} },
              code: 'console.log("fail");',
            }),
          }],
        })
        // autoFixToolCode (called because sandbox fails)
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: 'console.log("fixed");',
          }],
        });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // Mock Docker container — exit code 1 (failure), then success on retry
      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn()
          .mockResolvedValueOnce({ StatusCode: 1 })
          .mockResolvedValueOnce({ StatusCode: 0 }),
        logs: vi.fn()
          .mockResolvedValueOnce(Buffer.from('Error: something broke'))
          .mockResolvedValueOnce(Buffer.from('{"result":"fixed"}')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'sandbox-fail' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a failing sandbox test');

      expect(result.testResult).not.toBeNull();
      // After auto-fix, the second sandbox run succeeds
      expect(result.testResult!.passed).toBe(true);
    });

    it('exercises sandbox container error with cleanup (Docker throws)', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'sandbox-err',
            description: 'Sandbox error tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("err");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // Mock Docker container — start throws to trigger container cleanup catch
      const mockContainer = {
        start: vi.fn().mockRejectedValue(new Error('Docker start failed')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'sandbox-err' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a sandbox error test');

      // sandboxTest catches the error internally and returns { passed: false }
      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toContain('Docker start failed');
    });

    it('handles sandboxTest throwing (mkdtempSync error) — authorTool catch path', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'sandbox-throw',
            description: 'Sandbox throw tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("throw");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // Make mkdtempSync throw to trigger the authorTool catch (lines 70-71)
      mockMkdtempSync.mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'sandbox-throw' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a sandbox throw test');

      // sandbox threw, so testResult is null
      expect(result.testResult).toBeNull();
      // Tool was still registered (line 90+)
      expect(mockRegisterCustomTool).toHaveBeenCalled();
    });

    it('exercises sandbox container.wait rejection path', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'sandbox-reject',
            description: 'Wait rejection tool',
            language: 'bash',
            inputSchema: { type: 'object', properties: {} },
            code: 'echo "reject"',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // Mock Docker container — wait rejects
      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockRejectedValue(new Error('Container wait error')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'sandbox-reject' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a wait rejection test');

      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toContain('Container wait error');
    });

    it('exercises sandbox with unsupported language', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'sandbox-lang',
            description: 'Unknown language tool',
            language: 'rust',
            inputSchema: { type: 'object', properties: {} },
            code: 'fn main() {}',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'sandbox-lang' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'an unsupported language test');

      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toContain('Unsupported language');
    });

    it('exercises sandbox non-zero exit with empty output', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn()
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              name: 'empty-err',
              description: 'Empty error tool',
              language: 'javascript',
              inputSchema: { type: 'object', properties: {} },
              code: 'console.log("test");',
            }),
          }],
        })
        // autoFixToolCode response
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: 'console.log("fixed");',
          }],
        });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // Container exits with code 1 and empty output
      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn()
          .mockResolvedValueOnce({ StatusCode: 1 })
          .mockResolvedValueOnce({ StatusCode: 1 }),
        logs: vi.fn().mockResolvedValue(Buffer.from('')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'empty-err' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'empty error test');

      // Auto-fix also fails (2nd sandbox also returns code 1), so original code is used
      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(false);
      // Empty output should fallback to "Process exited with code 1"
      expect(result.testResult!.error).toContain('Process exited with code 1');
    });
  });

  // ────────────────────────────────────────────
  //  authorSkill (AI-powered, lines 520-566)
  // ────────────────────────────────────────────
  describe('authorSkill', () => {
    it('throws if agent not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(authorSkill(TEST_WORKSPACE_ID, 'nonexistent', 'summarize emails'))
        .rejects.toThrow('Agent nonexistent not found');
    });

    it('creates a skill when AI returns valid JSON', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'approve-first' }));

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'email-summarizer',
            description: 'Summarizes email content',
            template: 'Please summarize this email: {{email_body}}',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      mockExecute.mockResolvedValueOnce({ rowCount: 1 }); // INSERT authored_skills
      mockRegisterSkill.mockResolvedValueOnce(undefined);
      mockAttachSkillToAgent.mockResolvedValueOnce(undefined);
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorSkill(TEST_WORKSPACE_ID, 'agent-1', 'summarize emails');

      expect(result.agent_id).toBe('agent-1');
      expect(result.skill_type).toBe('prompt_template');
      expect(result.approved).toBe(false); // approve-first mode
      expect(mockRegisterSkill).toHaveBeenCalled();
      expect(mockAttachSkillToAgent).toHaveBeenCalled();
    });

    it('sets approved=true when self_evolution_mode is autonomous', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'quick-skill',
            description: 'Quick skill',
            template: 'Do {{action}}',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      mockRegisterSkill.mockResolvedValueOnce(undefined);
      mockAttachSkillToAgent.mockResolvedValueOnce(undefined);
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorSkill(TEST_WORKSPACE_ID, 'agent-1', 'quick task');

      expect(result.approved).toBe(true);
    });
  });

  // ────────────────────────────────────────────
  //  authorTool — auto-fix flow (lines 74-86)
  // ────────────────────────────────────────────
  describe('authorTool — auto-fix flow', () => {
    it('attempts auto-fix when sandbox test fails and succeeds', async () => {
      // Agent that triggers sandbox test failure then auto-fix success
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      // Mock Anthropic SDK — called for both generateToolCode AND autoFixToolCode
      const mockAnthropicCreate = vi.fn()
        // First call: generateToolCode
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              name: 'fix-tool',
              description: 'A tool to fix',
              language: 'javascript',
              inputSchema: { type: 'object', properties: { data: { type: 'string' } } },
              code: 'console.log("original");',
            }),
          }],
        })
        // Second call: autoFixToolCode
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: '```javascript\nconsole.log("fixed");\n```',
          }],
        });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // Mock Docker for sandbox test — first test fails, second succeeds
      const mockDocker = await import('dockerode');
      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn()
          .mockResolvedValueOnce({ StatusCode: 1 }) // First sandbox: failed
          .mockResolvedValueOnce({ StatusCode: 0 }), // Second sandbox (after fix): success
        logs: vi.fn().mockResolvedValue(Buffer.from('output')),
        kill: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      };

      const DockerClass = (mockDocker.default as any);
      DockerClass.mockImplementation(() => ({
        createContainer: vi.fn().mockResolvedValue(mockContainer),
      }));

      // Re-import to pick up the mocked Docker
      vi.resetModules();
      // We need to re-mock all dependencies after resetModules
      vi.doMock('../../src/db', () => ({
        query: (...args: any[]) => mockQuery(...args),
        queryOne: (...args: any[]) => mockQueryOne(...args),
        execute: (...args: any[]) => mockExecute(...args),
        withTransaction: (fn: any) => mockWithTransaction(fn),
      }));
      vi.doMock('../../src/utils/logger', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }));
      vi.doMock('../../src/modules/agents', () => ({
        getAgent: (...args: any[]) => mockGetAgent(...args),
        updateAgent: (...args: any[]) => mockUpdateAgent(...args),
      }));
      vi.doMock('../../src/modules/tools', () => ({
        registerCustomTool: (...args: any[]) => mockRegisterCustomTool(...args),
        getCustomTool: (...args: any[]) => mockGetCustomTool(...args),
        listCustomTools: (...args: any[]) => mockListCustomTools(...args),
      }));
      vi.doMock('../../src/modules/skills', () => ({
        registerSkill: (...args: any[]) => mockRegisterSkill(...args),
        attachSkillToAgent: (...args: any[]) => mockAttachSkillToAgent(...args),
      }));
      vi.doMock('../../src/modules/self-evolution', () => ({
        createProposal: (...args: any[]) => mockCreateProposal(...args),
      }));
      vi.doMock('../../src/modules/access-control', () => ({
        canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
      }));
      vi.doMock('../../src/config', () => ({
        config: { docker: { baseImage: 'node:20-slim' } },
      }));
      vi.doMock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'fix-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      // The test exercises sandbox paths even if they throw in test env.
      // The try/catch around sandboxTest will handle errors gracefully.
      const { authorTool: freshAuthorTool } = await import('../../src/modules/self-authoring');
      const result = await freshAuthorTool('agent-1', 'make a fix tool');

      expect(result.tool).toBeDefined();
      expect(mockRegisterCustomTool).toHaveBeenCalled();
    });

    it('uses original code when auto-fix attempt throws', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn()
        // generateToolCode
        .mockResolvedValueOnce({
          content: [{
            type: 'text',
            text: JSON.stringify({
              name: 'broken-tool',
              description: 'A broken tool',
              language: 'javascript',
              inputSchema: { type: 'object', properties: {} },
              code: 'console.log("original");',
            }),
          }],
        })
        // autoFixToolCode throws
        .mockRejectedValueOnce(new Error('AI service unavailable'));

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'broken-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'make a broken tool');

      expect(result.tool).toBeDefined();
      expect(result.code).toContain('console.log');
    });

    it('exercises container.remove failure in catch path', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'remove-fail-tool',
            description: 'Remove fail tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("test");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // Container start throws AND remove also throws (branch 50: catch{} on container.remove)
      const mockContainer = {
        start: vi.fn().mockRejectedValue(new Error('Docker start failed')),
        remove: vi.fn().mockRejectedValue(new Error('Container already removed')),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'remove-fail-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'remove fail test');

      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toContain('Docker start failed');
    });
  });

  // ────────────────────────────────────────────
  //  authorTool — sandbox with Python language
  // ────────────────────────────────────────────
  describe('authorTool — sandbox Python language', () => {
    it('exercises sandbox with python language (interpreter = python3)', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'py-sandbox-tool',
            description: 'Python sandbox tool',
            language: 'python',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
            code: 'print("hello")',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue(Buffer.from('hello')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'py-sandbox-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a python tool');

      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(true);
      // Verify python3 interpreter was used
      expect(mockDockerCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Cmd: ['python3', '/sandbox/test.py'],
        }),
      );
    });
  });

  // ────────────────────────────────────────────
  //  authorTool — sandbox error with no message
  // ────────────────────────────────────────────
  describe('authorTool — sandbox error with empty message', () => {
    it('uses "Unknown sandbox error" when err.message is falsy', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'no-msg-tool',
            description: 'No message error tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("test");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // Docker container start throws error with empty message
      const mockContainer = {
        start: vi.fn().mockRejectedValue({ message: '' }),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'no-msg-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'no message error test');

      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toBe('Unknown sandbox error');
    });
  });

  // ────────────────────────────────────────────
  //  authorTool — sandbox rmSync failure
  // ────────────────────────────────────────────
  describe('authorTool — sandbox cleanup failure', () => {
    it('handles rmSync throwing in finally block', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'rm-fail-tool',
            description: 'rmSync fail tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("test");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue(Buffer.from('ok')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      // Make rmSync throw to exercise the catch in finally block
      mockRmSync.mockImplementationOnce(() => { throw new Error('EPERM'); });

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'rm-fail-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      // Should still succeed despite rmSync failure
      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'rmSync fail test');

      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(true);
    });
  });

  // ────────────────────────────────────────────
  //  authorTool — sandbox container null in catch
  // ────────────────────────────────────────────
  describe('authorTool — sandbox container null in catch', () => {
    it('handles error when container is null (createContainer throws)', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'null-container-tool',
            description: 'Null container tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("test");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      // createContainer throws, so container is still null in catch
      mockDockerCreateContainer.mockRejectedValue(new Error('Docker daemon not available'));

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'null-container-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'null container test');

      expect(result.testResult).not.toBeNull();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toContain('Docker daemon not available');
    });
  });

  // ────────────────────────────────────────────
  //  generateSampleInput type branches
  // ────────────────────────────────────────────
  describe('authorTool — generateSampleInput type branches', () => {
    it('handles number type with example value', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'num-example-tool',
            description: 'Number example tool',
            language: 'javascript',
            inputSchema: {
              type: 'object',
              properties: {
                count: { type: 'number', example: 99 },
                index: { type: 'integer', default: 7 },
                flag: { type: 'boolean', example: false },
                items: { type: 'array', example: [1, 2, 3] },
                meta: { type: 'object', example: { key: 'val' } },
                other: { type: 'unknown_type' },
              },
            },
            code: 'console.log("test");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue(Buffer.from('ok')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'num-example-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a number example tool');

      // Verify the INPUT env var contains the right sample values
      const createCallArgs = mockDockerCreateContainer.mock.calls[0][0];
      const inputEnv = createCallArgs.Env.find((e: string) => e.startsWith('INPUT='));
      const inputData = JSON.parse(inputEnv.replace('INPUT=', ''));

      expect(inputData.count).toBe(99); // number with example
      expect(inputData.index).toBe(7); // integer with default
      expect(inputData.flag).toBe(false); // boolean with example
      expect(inputData.items).toEqual([1, 2, 3]); // array with example
      expect(inputData.meta).toEqual({ key: 'val' }); // object with example
      expect(inputData.other).toBe('sample'); // default case
    });

    it('handles number/integer with default fallback', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'num-default-tool',
            description: 'Number default tool',
            language: 'javascript',
            inputSchema: {
              type: 'object',
              properties: {
                plain_num: { type: 'number' },
                plain_int: { type: 'integer' },
                plain_bool: { type: 'boolean' },
                plain_arr: { type: 'array' },
                plain_obj: { type: 'object' },
              },
            },
            code: 'console.log("test");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue(Buffer.from('ok')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'num-default-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a number default tool');

      const createCallArgs = mockDockerCreateContainer.mock.calls[0][0];
      const inputEnv = createCallArgs.Env.find((e: string) => e.startsWith('INPUT='));
      const inputData = JSON.parse(inputEnv.replace('INPUT=', ''));

      expect(inputData.plain_num).toBe(42); // number fallback
      expect(inputData.plain_int).toBe(42); // integer fallback
      expect(inputData.plain_bool).toBe(true); // boolean fallback
      expect(inputData.plain_arr).toEqual(['item1', 'item2']); // array fallback
      expect(inputData.plain_obj).toEqual({}); // object fallback
    });

    it('handles boolean with default (not example)', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'bool-default-tool',
            description: 'Boolean default tool',
            language: 'javascript',
            inputSchema: {
              type: 'object',
              properties: {
                active: { type: 'boolean', default: false },
              },
            },
            code: 'console.log("test");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue(Buffer.from('ok')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'bool-default-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a boolean default tool');

      const createCallArgs = mockDockerCreateContainer.mock.calls[0][0];
      const inputEnv = createCallArgs.Env.find((e: string) => e.startsWith('INPUT='));
      const inputData = JSON.parse(inputEnv.replace('INPUT=', ''));

      expect(inputData.active).toBe(false); // boolean with default (uses ?? so picks false)
    });

    it('handles array/object with default values', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'arr-obj-default-tool',
            description: 'Array/Object default tool',
            language: 'javascript',
            inputSchema: {
              type: 'object',
              properties: {
                tags: { type: 'array', default: ['a', 'b'] },
                config: { type: 'object', default: { x: 1 } },
              },
            },
            code: 'console.log("test");',
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue(Buffer.from('ok')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'arr-obj-default-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'an array/object default tool');

      const createCallArgs = mockDockerCreateContainer.mock.calls[0][0];
      const inputEnv = createCallArgs.Env.find((e: string) => e.startsWith('INPUT='));
      const inputData = JSON.parse(inputEnv.replace('INPUT=', ''));

      expect(inputData.tags).toEqual(['a', 'b']); // array with default
      expect(inputData.config).toEqual({ x: 1 }); // object with default
    });
  });

  // ────────────────────────────────────────────
  //  generateToolCode fallback branches
  // ────────────────────────────────────────────
  describe('authorTool — generateToolCode fallback branches', () => {
    it('uses default inputSchema and language when AI response omits them', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      // AI returns JSON without inputSchema and language fields
      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'minimal-tool',
            description: 'A minimal tool',
            code: 'console.log("hello");',
            // no inputSchema, no language
          }),
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue(Buffer.from('ok')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValue(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce(makeCustomTool({ name: 'minimal-tool' }));
      mockExecute.mockResolvedValue({ rowCount: 1 });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool(TEST_WORKSPACE_ID, 'agent-1', 'a minimal tool');

      expect(result.tool).toBeDefined();
      // The tool should be registered with default schema and javascript language
      expect(mockRegisterCustomTool).toHaveBeenCalledWith(
        TEST_WORKSPACE_ID,
        'minimal-tool',
        JSON.stringify({ type: 'object', properties: {} }), // default inputSchema
        null,
        'agent-1',
        expect.objectContaining({ language: 'javascript' }), // default language
      );
    });
  });

  // ────────────────────────────────────────────
  //  authorSkill — generateSkillTemplate no JSON
  // ────────────────────────────────────────────
  describe('authorSkill — AI returns no valid JSON', () => {
    it('throws when generateSkillTemplate AI response has no JSON', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: 'Sorry, I cannot generate a skill template for that.',
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      await expect(authorSkill(TEST_WORKSPACE_ID, 'agent-1', 'something weird'))
        .rejects.toThrow('AI did not return valid JSON');
    });
  });

  // ────────────────────────────────────────────
  //  authorTool — generateToolCode no JSON
  // ────────────────────────────────────────────
  describe('authorTool — AI returns no valid JSON', () => {
    it('throws when generateToolCode AI response has no JSON', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockListCustomTools.mockResolvedValueOnce([]);

      const mockAnthropicCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: 'I cannot generate code for that task.',
        }],
      });

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn().mockImplementation(() => ({
          messages: { create: mockAnthropicCreate },
        })),
      }));

      await expect(authorTool(TEST_WORKSPACE_ID, 'agent-1', 'something impossible'))
        .rejects.toThrow('AI did not return valid JSON');
    });
  });
});
