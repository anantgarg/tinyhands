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

vi.mock('dockerode', () => {
  return { default: vi.fn().mockImplementation(() => ({})) };
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

      await recordToolRun('my-tool', 'agent-1', true, 150, null);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('INSERT INTO tool_runs');
      expect(params).toEqual([
        'test-uuid-1234', 'my-tool', 'agent-1', true, 150, null,
      ]);
    });

    it('records failed run with error message', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await recordToolRun('my-tool', 'agent-1', false, 50, 'ReferenceError: x is not defined');

      const [, params] = mockExecute.mock.calls[0];
      expect(params[3]).toBe(false);
      expect(params[5]).toBe('ReferenceError: x is not defined');
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

      const result = await getToolAnalytics('my-tool');

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

      const result = await getToolAnalytics('unused-tool');

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

      const result = await getToolAnalytics('no-data');

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

      const result = await getToolAnalytics('perfect-tool');
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

      const results = await getAllToolAnalytics();

      expect(results).toHaveLength(2);
      expect(results[0].toolName).toBe('tool-a');
      expect(results[1].toolName).toBe('tool-b');
      expect(mockQuery).toHaveBeenCalledWith('SELECT DISTINCT tool_name FROM tool_runs');
    });

    it('filters by agentId when provided', async () => {
      mockQuery.mockResolvedValueOnce([{ tool_name: 'tool-x' }]);
      mockQueryOne
        .mockResolvedValueOnce({ total_runs: '1', successes: '1', avg_duration: '50', last_used: null })
        .mockResolvedValueOnce(null);

      const results = await getAllToolAnalytics('agent-1');

      expect(results).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT DISTINCT tool_name FROM tool_runs WHERE agent_id = $1',
        ['agent-1']
      );
    });

    it('returns empty array when no tools exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const results = await getAllToolAnalytics();

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

      const result = await getToolVersions('my-tool');

      expect(result).toEqual(versions);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('tool_versions'),
        ['my-tool']
      );
    });

    it('returns empty array for tool with no versions', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getToolVersions('new-tool');
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

      await updateToolCode('my-tool', 'new code', 'javascript', 'user-1');

      expect(mockGetCustomTool).toHaveBeenCalledWith('my-tool');
      expect(fakeClient.query).toHaveBeenCalledTimes(2);
      expect(fakeClient.query.mock.calls[0][0]).toContain('INSERT INTO tool_versions');
      expect(fakeClient.query.mock.calls[1][0]).toContain('UPDATE custom_tools');
      expect(fakeClient.query.mock.calls[1][1]).toEqual(['new code', 'javascript', 'my-tool']);
    });

    it('throws if tool not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);

      await expect(updateToolCode('nonexistent', 'code', 'javascript', 'user-1'))
        .rejects.toThrow('not found');
    });

    it('throws if new code contains forbidden patterns', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool());

      await expect(updateToolCode('my-tool', 'eval("bad")', 'javascript', 'user-1'))
        .rejects.toThrow('forbidden pattern');
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

      await rollbackTool('my-tool', 2, 'user-1');

      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('tool_versions'),
        ['my-tool', 2]
      );
    });

    it('throws if version not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(rollbackTool('my-tool', 99, 'user-1'))
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

      await shareToolWithAgent('my-tool', 'agent-1', 'agent-2');

      expect(mockUpdateAgent).toHaveBeenCalledWith(
        'agent-2',
        { tools: ['Read', 'my-tool'] },
        'agent-1'
      );
    });

    it('does not duplicate tool if already in target list', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool({ registered_by: 'agent-1' }));
      mockGetAgent.mockResolvedValueOnce(makeAgent({ id: 'agent-2', tools: ['Read', 'my-tool'] }));

      await shareToolWithAgent('my-tool', 'agent-1', 'agent-2');

      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });

    it('throws if tool not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);

      await expect(shareToolWithAgent('nonexistent', 'agent-1', 'agent-2'))
        .rejects.toThrow('not found');
    });

    it('throws if agent does not own the tool', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool({ registered_by: 'other-agent' }));

      await expect(shareToolWithAgent('my-tool', 'agent-1', 'agent-2'))
        .rejects.toThrow('does not own');
    });

    it('throws if target agent not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(makeCustomTool({ registered_by: 'agent-1' }));
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(shareToolWithAgent('my-tool', 'agent-1', 'agent-2'))
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

      const results = await discoverTools('CSV');

      expect(results).toHaveLength(2);
      expect(results.map((t: any) => t.name)).toEqual(['csv-parser', 'csv-to-json']);
    });

    it('searches tools by schema content', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        makeCustomTool({ name: 'tool-a', schema_json: '{"description":"parses CSV files"}' }),
        makeCustomTool({ name: 'tool-b', schema_json: '{"description":"sends emails"}' }),
      ]);

      const results = await discoverTools('csv');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('tool-a');
    });

    it('returns empty array when nothing matches', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        makeCustomTool({ name: 'tool-a', schema_json: '{}' }),
      ]);

      const results = await discoverTools('nonexistent');

      expect(results).toEqual([]);
    });

    it('returns all tools if query matches everything', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        makeCustomTool({ name: 'tool-abc', schema_json: '{}' }),
        makeCustomTool({ name: 'tool-abcdef', schema_json: '{}' }),
      ]);

      const results = await discoverTools('tool');

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

      const result = await createToolPipeline('agent-1', pipeline);

      expect(result.name).toBe('etl-pipeline');
      expect(mockRegisterCustomTool).toHaveBeenCalledWith(
        'etl-pipeline',
        expect.any(String),
        null,
        'agent-1',
        expect.objectContaining({ language: 'javascript', autoApprove: true })
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

      await expect(createToolPipeline('agent-1', pipeline))
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

      const script = await getToolExecutionScript('my-tool');

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

      const script = await getToolExecutionScript('py-tool');

      expect(script).toContain('#!/usr/bin/env python3');
      expect(script).toContain('import os, json');
    });

    it('returns wrapped Bash with shebang', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: 'echo hi', language: 'bash', approved: true })
      );

      const script = await getToolExecutionScript('sh-tool');

      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('set -euo pipefail');
    });

    it('returns null if tool has no script_code', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: null, approved: true })
      );

      const script = await getToolExecutionScript('no-code');

      expect(script).toBeNull();
    });

    it('returns null if tool is not approved', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: 'code', approved: false })
      );

      const script = await getToolExecutionScript('unapproved');

      expect(script).toBeNull();
    });

    it('returns null if tool not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);

      const script = await getToolExecutionScript('nonexistent');

      expect(script).toBeNull();
    });

    it('uses default JavaScript shebang for unknown language', async () => {
      mockGetCustomTool.mockResolvedValueOnce(
        makeCustomTool({ script_code: 'some code', language: 'rust', approved: true })
      );

      const script = await getToolExecutionScript('rust-tool');

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

      const result = await getMcpConfigs('agent-1');

      expect(result).toEqual(configs);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('mcp_configs'),
        ['agent-1']
      );
    });

    it('returns empty array when no configs exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getMcpConfigs('agent-none');
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

      await approveMcpConfig('mcp-1', 'user-1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE mcp_configs'),
        ['mcp-1']
      );
    });

    it('throws if MCP config not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(approveMcpConfig('nonexistent', 'user-1'))
        .rejects.toThrow('not found');
    });

    it('throws if user lacks permission', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'mcp-1', agent_id: 'agent-1' });
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(approveMcpConfig('mcp-1', 'user-1'))
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

      const result = await getCodeArtifacts('agent-1');

      expect(result).toEqual(artifacts);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('code_artifacts'),
        ['agent-1']
      );
    });

    it('returns empty array when no artifacts exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getCodeArtifacts('agent-none');
      expect(result).toEqual([]);
    });
  });

  describe('getCodeArtifact', () => {
    it('returns artifact by agentId and filePath', async () => {
      const artifact = { id: 'art-1', agent_id: 'agent-1', file_path: '/src/a.ts', content: 'code' };
      mockQueryOne.mockResolvedValueOnce(artifact);

      const result = await getCodeArtifact('agent-1', '/src/a.ts');

      expect(result).toEqual(artifact);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('code_artifacts'),
        ['agent-1', '/src/a.ts']
      );
    });

    it('returns null when artifact not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getCodeArtifact('agent-1', '/nonexistent');
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

      const result = await getAuthoredSkills('agent-1');

      expect(result).toEqual(skills);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('authored_skills'),
        ['agent-1']
      );
    });

    it('returns empty array when no skills exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getAuthoredSkills('agent-none');
      expect(result).toEqual([]);
    });
  });

  describe('getAuthoredSkill', () => {
    it('returns a skill by id', async () => {
      const skill = makeSkill();
      mockQueryOne.mockResolvedValueOnce(skill);

      const result = await getAuthoredSkill('skill-1');

      expect(result).toEqual(skill);
    });

    it('returns null when skill not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getAuthoredSkill('nonexistent');
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

      await approveAuthoredSkill('skill-1', 'user-1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE authored_skills'),
        ['skill-1']
      );
    });

    it('throws if skill not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      await expect(approveAuthoredSkill('nonexistent', 'user-1'))
        .rejects.toThrow('not found');
    });

    it('throws if user lacks permission', async () => {
      mockQueryOne.mockResolvedValueOnce(makeSkill());
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(approveAuthoredSkill('skill-1', 'user-1'))
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

      await updateAuthoredSkillTemplate('skill-1', 'New template: {{var}}', 'user-1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('version = version + 1'),
        ['New template: {{var}}', 'skill-1']
      );
    });

    it('throws if skill not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      await expect(updateAuthoredSkillTemplate('nonexistent', 'template', 'user-1'))
        .rejects.toThrow('not found');
    });

    it('throws if user lacks permission', async () => {
      mockQueryOne.mockResolvedValueOnce(makeSkill());
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(updateAuthoredSkillTemplate('skill-1', 'template', 'user-1'))
        .rejects.toThrow('Insufficient permissions');
    });
  });

  // ────────────────────────────────────────────
  //  authorTool (AI-powered, lines 54-117)
  // ────────────────────────────────────────────
  describe('authorTool', () => {
    it('throws if agent not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(authorTool('nonexistent', 'make a csv parser'))
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

      const result = await authorTool('agent-1', 'make a csv parser');

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

      const result = await authorTool('agent-1', 'a helper tool');

      expect(result.requiresApproval).toBe(false);
    });
  });

  // ────────────────────────────────────────────
  //  authorSkill (AI-powered, lines 520-566)
  // ────────────────────────────────────────────
  describe('authorSkill', () => {
    it('throws if agent not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(authorSkill('nonexistent', 'summarize emails'))
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

      const result = await authorSkill('agent-1', 'summarize emails');

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

      const result = await authorSkill('agent-1', 'quick task');

      expect(result.approved).toBe(true);
    });
  });
});
