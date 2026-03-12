import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockGetAgent = vi.fn();
const mockUpdateAgent = vi.fn();
const mockCanModifyAgent = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
  updateAgent: (...args: any[]) => mockUpdateAgent(...args),
}));

vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

import {
  isBuiltinTool,
  getBuiltinTools,
  addToolToAgent,
  removeToolFromAgent,
  registerCustomTool,
  approveCustomTool,
  getToolCode,
  getCustomTool,
  listCustomTools,
  listUserAvailableTools,
  listWriteTools,
  deleteCustomTool,
  updateToolConfig,
  setToolConfigKey,
  removeToolConfigKey,
  getToolConfig,
  updateToolAccessLevel,
  getAgentToolSummary,
} from '../../src/modules/tools';

// ── Helpers ──

function makeFakeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    tools: ['Bash', 'Read'],
    ...overrides,
  };
}

function makeFakeCustomTool(overrides: Record<string, any> = {}) {
  return {
    id: 'tool-id-1',
    name: 'my-tool',
    tool_type: 'custom',
    schema_json: '{"type":"object"}',
    script_code: 'console.log("hello")',
    script_path: null,
    language: 'javascript',
    registered_by: 'user-1',
    approved: true,
    access_level: 'read-only',
    config_json: '{}',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ──

describe('Tools Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // isBuiltinTool
  // ────────────────────────────────────────────────
  describe('isBuiltinTool', () => {
    it('returns true for each known builtin tool', () => {
      const builtins = [
        'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch', 'NotebookEdit', 'TodoWrite', 'Agent', 'Mcp',
      ];
      for (const name of builtins) {
        expect(isBuiltinTool(name)).toBe(true);
      }
    });

    it('returns false for an unknown tool name', () => {
      expect(isBuiltinTool('FooBar')).toBe(false);
    });

    it('is case-sensitive', () => {
      expect(isBuiltinTool('bash')).toBe(false);
      expect(isBuiltinTool('BASH')).toBe(false);
      expect(isBuiltinTool('bAsh')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isBuiltinTool('')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────
  // getBuiltinTools
  // ────────────────────────────────────────────────
  describe('getBuiltinTools', () => {
    it('returns all 12 builtin tools', () => {
      const tools = getBuiltinTools();
      expect(tools).toHaveLength(12);
      expect(tools).toContain('Bash');
      expect(tools).toContain('Mcp');
    });

    it('returns a copy (mutating it does not affect subsequent calls)', () => {
      const first = getBuiltinTools();
      first.push('HackedTool');
      const second = getBuiltinTools();
      expect(second).not.toContain('HackedTool');
      expect(second).toHaveLength(12);
    });
  });

  // ────────────────────────────────────────────────
  // addToolToAgent
  // ────────────────────────────────────────────────
  describe('addToolToAgent', () => {
    it('adds a builtin tool to the agent', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: ['Read'] }));
      mockUpdateAgent.mockResolvedValue(undefined);

      const result = await addToolToAgent('agent-1', 'Bash', 'user-1');

      expect(result).toEqual(['Read', 'Bash']);
      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-1', { tools: ['Read', 'Bash'] }, 'user-1');
    });

    it('adds a custom tool to the agent after verifying it exists', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: [] }));
      // getCustomTool query
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ name: 'my-tool' }));
      mockUpdateAgent.mockResolvedValue(undefined);

      const result = await addToolToAgent('agent-1', 'my-tool', 'user-1');

      expect(result).toEqual(['my-tool']);
      expect(mockUpdateAgent).toHaveBeenCalled();
    });

    it('returns existing tools unchanged when tool already attached', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: ['Bash', 'Read'] }));

      const result = await addToolToAgent('agent-1', 'Bash', 'user-1');

      expect(result).toEqual(['Bash', 'Read']);
      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });

    it('throws when user lacks permission', async () => {
      mockCanModifyAgent.mockResolvedValue(false);

      await expect(addToolToAgent('agent-1', 'Bash', 'user-x'))
        .rejects.toThrow('Insufficient permissions to modify agent tools');
    });

    it('throws when agent is not found', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(null);

      await expect(addToolToAgent('missing-agent', 'Bash', 'user-1'))
        .rejects.toThrow('Agent missing-agent not found');
    });

    it('throws when custom tool does not exist', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: [] }));
      // getCustomTool returns null
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(addToolToAgent('agent-1', 'nonexistent-tool', 'user-1'))
        .rejects.toThrow('Tool "nonexistent-tool" not found');
    });

    it('does not mutate the original agent tools array', async () => {
      const originalTools = ['Read'];
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: originalTools }));
      mockUpdateAgent.mockResolvedValue(undefined);

      await addToolToAgent('agent-1', 'Bash', 'user-1');

      // The original array should not have been mutated
      expect(originalTools).toEqual(['Read']);
    });
  });

  // ────────────────────────────────────────────────
  // removeToolFromAgent
  // ────────────────────────────────────────────────
  describe('removeToolFromAgent', () => {
    it('removes a tool from the agent', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: ['Bash', 'Read', 'Write'] }));
      mockUpdateAgent.mockResolvedValue(undefined);

      const result = await removeToolFromAgent('agent-1', 'Read', 'user-1');

      expect(result).toEqual(['Bash', 'Write']);
      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-1', { tools: ['Bash', 'Write'] }, 'user-1');
    });

    it('returns same tools if tool not present (no-op removal)', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: ['Bash'] }));
      mockUpdateAgent.mockResolvedValue(undefined);

      const result = await removeToolFromAgent('agent-1', 'NotThere', 'user-1');

      expect(result).toEqual(['Bash']);
      // updateAgent is still called (filters and saves)
      expect(mockUpdateAgent).toHaveBeenCalled();
    });

    it('throws when user lacks permission', async () => {
      mockCanModifyAgent.mockResolvedValue(false);

      await expect(removeToolFromAgent('agent-1', 'Bash', 'user-x'))
        .rejects.toThrow('Insufficient permissions to modify agent tools');
    });

    it('throws when agent is not found', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(null);

      await expect(removeToolFromAgent('gone', 'Bash', 'user-1'))
        .rejects.toThrow('Agent gone not found');
    });
  });

  // ────────────────────────────────────────────────
  // registerCustomTool
  // ────────────────────────────────────────────────
  describe('registerCustomTool', () => {
    it('registers a new custom tool with defaults', async () => {
      mockQueryOne.mockResolvedValueOnce(null); // no existing tool
      mockExecute.mockResolvedValue(undefined);

      const result = await registerCustomTool(
        'my-tool',
        '{"type":"object"}',
        '/scripts/my-tool.js',
        'user-1',
      );

      expect(result).toMatchObject({
        id: 'test-uuid-1234',
        name: 'my-tool',
        tool_type: 'custom',
        schema_json: '{"type":"object"}',
        script_code: null,
        script_path: '/scripts/my-tool.js',
        language: 'javascript',
        registered_by: 'user-1',
        approved: true,
        access_level: 'read-only',
        config_json: '{}',
      });
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('registers a tool with inline code (script_path becomes null)', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockExecute.mockResolvedValue(undefined);

      const result = await registerCustomTool(
        'code-tool',
        '{}',
        null,
        'user-1',
        { code: 'print("hi")', language: 'python' },
      );

      expect(result.script_code).toBe('print("hi")');
      expect(result.script_path).toBeNull();
      expect(result.language).toBe('python');
    });

    it('respects autoApprove: false', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockExecute.mockResolvedValue(undefined);

      const result = await registerCustomTool(
        'unapproved',
        '{}',
        null,
        'user-1',
        { autoApprove: false },
      );

      expect(result.approved).toBe(false);
    });

    it('respects accessLevel: read-write', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockExecute.mockResolvedValue(undefined);

      const result = await registerCustomTool(
        'rw-tool',
        '{}',
        null,
        'user-1',
        { accessLevel: 'read-write' },
      );

      expect(result.access_level).toBe('read-write');
    });

    it('accepts a custom configJson', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockExecute.mockResolvedValue(undefined);

      const result = await registerCustomTool(
        'config-tool',
        '{}',
        null,
        'user-1',
        { configJson: '{"apiKey":"abc"}' },
      );

      expect(result.config_json).toBe('{"apiKey":"abc"}');
    });

    it('throws when tool name already exists', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'existing-id' });

      await expect(
        registerCustomTool('dup', '{}', null, 'user-1'),
      ).rejects.toThrow('Tool "dup" already registered');
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('uses script_path when no code option is provided', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockExecute.mockResolvedValue(undefined);

      const result = await registerCustomTool(
        'path-tool',
        '{}',
        '/usr/local/tools/mytool.sh',
        'user-1',
        { language: 'bash' },
      );

      expect(result.script_code).toBeNull();
      expect(result.script_path).toBe('/usr/local/tools/mytool.sh');
      expect(result.language).toBe('bash');
    });

    it('sets script_path to null when code option is given even if scriptPathOrCode is provided', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockExecute.mockResolvedValue(undefined);

      const result = await registerCustomTool(
        'code-over-path',
        '{}',
        '/some/path.js',
        'user-1',
        { code: 'module.exports = {}' },
      );

      expect(result.script_code).toBe('module.exports = {}');
      expect(result.script_path).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // approveCustomTool
  // ────────────────────────────────────────────────
  describe('approveCustomTool', () => {
    it('approves a tool when called by superadmin', async () => {
      mockQueryOne.mockResolvedValueOnce({ user_id: 'admin-1' }); // superadmin check
      mockExecute.mockResolvedValue(undefined);

      await expect(approveCustomTool('my-tool', 'admin-1')).resolves.toBeUndefined();
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE custom_tools SET approved = TRUE WHERE name = $1',
        ['my-tool'],
      );
    });

    it('throws when caller is not a superadmin', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(approveCustomTool('my-tool', 'user-x'))
        .rejects.toThrow('Only admins can approve tools');
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // getToolCode
  // ────────────────────────────────────────────────
  describe('getToolCode', () => {
    it('returns code and language when tool has script_code', async () => {
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({
        script_code: 'console.log("hi")',
        language: 'javascript',
      }));

      const result = await getToolCode('my-tool');
      expect(result).toEqual({ code: 'console.log("hi")', language: 'javascript' });
    });

    it('returns null when tool has no script_code', async () => {
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({
        script_code: null,
      }));

      const result = await getToolCode('my-tool');
      expect(result).toBeNull();
    });

    it('returns null when tool does not exist', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getToolCode('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // getCustomTool
  // ────────────────────────────────────────────────
  describe('getCustomTool', () => {
    it('returns the tool when found', async () => {
      const fakeTool = makeFakeCustomTool();
      mockQueryOne.mockResolvedValueOnce(fakeTool);

      const result = await getCustomTool('my-tool');
      expect(result).toEqual(fakeTool);
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT * FROM custom_tools WHERE name = $1',
        ['my-tool'],
      );
    });

    it('returns null when tool is not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getCustomTool('missing');
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // listCustomTools
  // ────────────────────────────────────────────────
  describe('listCustomTools', () => {
    it('returns all custom tools', async () => {
      const tools = [makeFakeCustomTool({ name: 'a' }), makeFakeCustomTool({ name: 'b' })];
      mockQuery.mockResolvedValueOnce(tools);

      const result = await listCustomTools();
      expect(result).toEqual(tools);
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM custom_tools ORDER BY name');
    });

    it('returns empty array when no tools exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await listCustomTools();
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────
  // listUserAvailableTools
  // ────────────────────────────────────────────────
  describe('listUserAvailableTools', () => {
    it('queries for approved read-only tools', async () => {
      const tools = [makeFakeCustomTool({ approved: true, access_level: 'read-only' })];
      mockQuery.mockResolvedValueOnce(tools);

      const result = await listUserAvailableTools();
      expect(result).toEqual(tools);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("approved = TRUE AND access_level = 'read-only'"),
      );
    });

    it('returns empty array when no approved read-only tools exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await listUserAvailableTools();
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────
  // listWriteTools
  // ────────────────────────────────────────────────
  describe('listWriteTools', () => {
    it('queries for approved read-write tools', async () => {
      const tools = [makeFakeCustomTool({ access_level: 'read-write' })];
      mockQuery.mockResolvedValueOnce(tools);

      const result = await listWriteTools();
      expect(result).toEqual(tools);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("approved = TRUE AND access_level = 'read-write'"),
      );
    });

    it('returns empty array when no write tools exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await listWriteTools();
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────
  // deleteCustomTool
  // ────────────────────────────────────────────────
  describe('deleteCustomTool', () => {
    it('deletes a tool when called by superadmin', async () => {
      mockQueryOne.mockResolvedValueOnce({ user_id: 'admin-1' });
      mockExecute.mockResolvedValue(undefined);

      await expect(deleteCustomTool('my-tool', 'admin-1')).resolves.toBeUndefined();
      expect(mockExecute).toHaveBeenCalledWith(
        'DELETE FROM custom_tools WHERE name = $1',
        ['my-tool'],
      );
    });

    it('throws when caller is not a superadmin', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(deleteCustomTool('my-tool', 'user-x'))
        .rejects.toThrow('Only admins can delete custom tools');
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // updateToolConfig
  // ────────────────────────────────────────────────
  describe('updateToolConfig', () => {
    it('updates tool config when called by superadmin', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' }) // superadmin check
        .mockResolvedValueOnce(makeFakeCustomTool());   // getCustomTool
      mockExecute.mockResolvedValue(undefined);

      await expect(
        updateToolConfig('my-tool', '{"key":"val"}', 'admin-1'),
      ).resolves.toBeUndefined();

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE custom_tools SET config_json = $1 WHERE name = $2',
        ['{"key":"val"}', 'my-tool'],
      );
    });

    it('throws when caller is not superadmin', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(updateToolConfig('my-tool', '{}', 'user-x'))
        .rejects.toThrow('Only admins can update tool config');
    });

    it('throws when tool not found', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(null); // getCustomTool returns null

      await expect(updateToolConfig('ghost', '{}', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // setToolConfigKey
  // ────────────────────────────────────────────────
  describe('setToolConfigKey', () => {
    it('sets a key in the config JSON', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool({ config_json: '{"existing":"value"}' }));
      mockExecute.mockResolvedValue(undefined);

      const result = await setToolConfigKey('my-tool', 'newKey', 'newVal', 'admin-1');

      expect(result).toEqual({ existing: 'value', newKey: 'newVal' });
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE custom_tools SET config_json = $1 WHERE name = $2',
        ['{"existing":"value","newKey":"newVal"}', 'my-tool'],
      );
    });

    it('overwrites an existing key', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool({ config_json: '{"key":"old"}' }));
      mockExecute.mockResolvedValue(undefined);

      const result = await setToolConfigKey('my-tool', 'key', 'new', 'admin-1');
      expect(result).toEqual({ key: 'new' });
    });

    it('handles empty/null config_json by defaulting to {}', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool({ config_json: null }));
      mockExecute.mockResolvedValue(undefined);

      // config_json is null → JSON.parse(null || '{}') → {}
      const result = await setToolConfigKey('my-tool', 'k', 'v', 'admin-1');
      expect(result).toEqual({ k: 'v' });
    });

    it('throws when caller is not superadmin', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(setToolConfigKey('my-tool', 'k', 'v', 'user-x'))
        .rejects.toThrow('Only admins can update tool config');
    });

    it('throws when tool not found', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(null);

      await expect(setToolConfigKey('ghost', 'k', 'v', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // removeToolConfigKey
  // ────────────────────────────────────────────────
  describe('removeToolConfigKey', () => {
    it('removes a key from the config JSON', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool({ config_json: '{"a":"1","b":"2"}' }));
      mockExecute.mockResolvedValue(undefined);

      const result = await removeToolConfigKey('my-tool', 'a', 'admin-1');

      expect(result).toEqual({ b: '2' });
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE custom_tools SET config_json = $1 WHERE name = $2',
        ['{"b":"2"}', 'my-tool'],
      );
    });

    it('returns unchanged config if key does not exist', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool({ config_json: '{"a":"1"}' }));
      mockExecute.mockResolvedValue(undefined);

      const result = await removeToolConfigKey('my-tool', 'nonexistent', 'admin-1');

      expect(result).toEqual({ a: '1' });
    });

    it('throws when caller is not superadmin', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(removeToolConfigKey('my-tool', 'k', 'user-x'))
        .rejects.toThrow('Only admins can update tool config');
    });

    it('throws when tool not found', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(null);

      await expect(removeToolConfigKey('ghost', 'k', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // getToolConfig
  // ────────────────────────────────────────────────
  describe('getToolConfig', () => {
    it('returns parsed config JSON for superadmin', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool({ config_json: '{"apiKey":"secret"}' }));

      const result = await getToolConfig('my-tool', 'admin-1');
      expect(result).toEqual({ apiKey: 'secret' });
    });

    it('returns empty object when config_json is null', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool({ config_json: null }));

      const result = await getToolConfig('my-tool', 'admin-1');
      expect(result).toEqual({});
    });

    it('returns empty object when config_json is empty string', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool({ config_json: '' }));

      const result = await getToolConfig('my-tool', 'admin-1');
      expect(result).toEqual({});
    });

    it('throws when caller is not superadmin', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(getToolConfig('my-tool', 'user-x'))
        .rejects.toThrow('Only admins can view tool config');
    });

    it('throws when tool not found', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(null);

      await expect(getToolConfig('ghost', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // updateToolAccessLevel
  // ────────────────────────────────────────────────
  describe('updateToolAccessLevel', () => {
    it('updates access level to read-write for superadmin', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool());
      mockExecute.mockResolvedValue(undefined);

      await expect(
        updateToolAccessLevel('my-tool', 'read-write', 'admin-1'),
      ).resolves.toBeUndefined();

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE custom_tools SET access_level = $1 WHERE name = $2',
        ['read-write', 'my-tool'],
      );
    });

    it('updates access level to read-only for superadmin', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(makeFakeCustomTool({ access_level: 'read-write' }));
      mockExecute.mockResolvedValue(undefined);

      await updateToolAccessLevel('my-tool', 'read-only', 'admin-1');

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE custom_tools SET access_level = $1 WHERE name = $2',
        ['read-only', 'my-tool'],
      );
    });

    it('throws when caller is not superadmin', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(updateToolAccessLevel('my-tool', 'read-write', 'user-x'))
        .rejects.toThrow('Only admins can change tool access level');
    });

    it('throws when tool not found', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ user_id: 'admin-1' })
        .mockResolvedValueOnce(null);

      await expect(updateToolAccessLevel('ghost', 'read-write', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // getAgentToolSummary
  // ────────────────────────────────────────────────
  describe('getAgentToolSummary', () => {
    it('categorizes tools into builtin, custom, and mcp', async () => {
      mockGetAgent.mockResolvedValue(makeFakeAgent({
        tools: ['Bash', 'Read', 'my-custom', 'mcp-server::tool'],
      }));
      // getCustomTool calls for non-builtin tools:
      // 'my-custom' -> found
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ name: 'my-custom' }));
      // 'mcp-server::tool' -> not found
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getAgentToolSummary('agent-1');

      expect(result).toEqual({
        builtin: ['Bash', 'Read'],
        custom: ['my-custom'],
        mcp: ['mcp-server::tool'],
      });
    });

    it('returns empty arrays when agent has no tools', async () => {
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: [] }));

      const result = await getAgentToolSummary('agent-1');

      expect(result).toEqual({ builtin: [], custom: [], mcp: [] });
    });

    it('handles agent with only builtin tools', async () => {
      mockGetAgent.mockResolvedValue(makeFakeAgent({
        tools: ['Bash', 'Grep', 'Glob'],
      }));

      const result = await getAgentToolSummary('agent-1');

      expect(result).toEqual({
        builtin: ['Bash', 'Grep', 'Glob'],
        custom: [],
        mcp: [],
      });
      // No DB queries should be made for builtins
      expect(mockQueryOne).not.toHaveBeenCalled();
    });

    it('handles agent with only mcp tools (none found in DB)', async () => {
      mockGetAgent.mockResolvedValue(makeFakeAgent({
        tools: ['slack::post', 'github::create-issue'],
      }));
      mockQueryOne.mockResolvedValueOnce(null); // slack::post
      mockQueryOne.mockResolvedValueOnce(null); // github::create-issue

      const result = await getAgentToolSummary('agent-1');

      expect(result).toEqual({
        builtin: [],
        custom: [],
        mcp: ['slack::post', 'github::create-issue'],
      });
    });

    it('throws when agent is not found', async () => {
      mockGetAgent.mockResolvedValue(null);

      await expect(getAgentToolSummary('missing'))
        .rejects.toThrow('Agent missing not found');
    });
  });
});
