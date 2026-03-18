import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockGetAgent = vi.fn();
const mockUpdateAgent = vi.fn();
const mockCanModifyAgent = vi.fn();
const mockIsPlatformAdmin = vi.fn();

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
  isPlatformAdmin: (...args: any[]) => mockIsPlatformAdmin(...args),
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

const TEST_WORKSPACE_ID = 'W_TEST_123';

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
  // addToolToAgent (now includes workspaceId)
  // ────────────────────────────────────────────────
  describe('addToolToAgent', () => {
    it('adds a builtin tool to the agent', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: ['Read'] }));
      mockUpdateAgent.mockResolvedValue(undefined);

      const result = await addToolToAgent(TEST_WORKSPACE_ID, 'agent-1', 'Bash', 'user-1');

      expect(result).toEqual(['Read', 'Bash']);
      expect(mockCanModifyAgent).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'agent-1', 'user-1');
      expect(mockGetAgent).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'agent-1');
      expect(mockUpdateAgent).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'agent-1', { tools: ['Read', 'Bash'] }, 'user-1');
    });

    it('adds a custom tool to the agent after verifying it exists', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: [] }));
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ name: 'my-tool' }));
      mockUpdateAgent.mockResolvedValue(undefined);

      const result = await addToolToAgent(TEST_WORKSPACE_ID, 'agent-1', 'my-tool', 'user-1');

      expect(result).toEqual(['my-tool']);
      expect(mockUpdateAgent).toHaveBeenCalled();
    });

    it('returns existing tools unchanged when tool already attached', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: ['Bash', 'Read'] }));

      const result = await addToolToAgent(TEST_WORKSPACE_ID, 'agent-1', 'Bash', 'user-1');

      expect(result).toEqual(['Bash', 'Read']);
      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });

    it('throws when user lacks permission', async () => {
      mockCanModifyAgent.mockResolvedValue(false);

      await expect(addToolToAgent(TEST_WORKSPACE_ID, 'agent-1', 'Bash', 'user-x'))
        .rejects.toThrow('Insufficient permissions to modify agent tools');
    });

    it('throws when agent is not found', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(null);

      await expect(addToolToAgent(TEST_WORKSPACE_ID, 'missing-agent', 'Bash', 'user-1'))
        .rejects.toThrow('Agent missing-agent not found');
    });

    it('throws when custom tool does not exist', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: [] }));
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(addToolToAgent(TEST_WORKSPACE_ID, 'agent-1', 'nonexistent-tool', 'user-1'))
        .rejects.toThrow('Tool "nonexistent-tool" not found');
    });

    it('does not mutate the original agent tools array', async () => {
      const originalTools = ['Read'];
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: originalTools }));
      mockUpdateAgent.mockResolvedValue(undefined);

      await addToolToAgent(TEST_WORKSPACE_ID, 'agent-1', 'Bash', 'user-1');

      expect(originalTools).toEqual(['Read']);
    });
  });

  // ────────────────────────────────────────────────
  // removeToolFromAgent (now includes workspaceId)
  // ────────────────────────────────────────────────
  describe('removeToolFromAgent', () => {
    it('removes a tool from the agent', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: ['Bash', 'Read', 'Write'] }));
      mockUpdateAgent.mockResolvedValue(undefined);

      const result = await removeToolFromAgent(TEST_WORKSPACE_ID, 'agent-1', 'Read', 'user-1');

      expect(result).toEqual(['Bash', 'Write']);
      expect(mockUpdateAgent).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'agent-1', { tools: ['Bash', 'Write'] }, 'user-1');
    });

    it('returns same tools if tool not present (no-op removal)', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: ['Bash'] }));
      mockUpdateAgent.mockResolvedValue(undefined);

      const result = await removeToolFromAgent(TEST_WORKSPACE_ID, 'agent-1', 'NotThere', 'user-1');

      expect(result).toEqual(['Bash']);
      expect(mockUpdateAgent).toHaveBeenCalled();
    });

    it('throws when user lacks permission', async () => {
      mockCanModifyAgent.mockResolvedValue(false);

      await expect(removeToolFromAgent(TEST_WORKSPACE_ID, 'agent-1', 'Bash', 'user-x'))
        .rejects.toThrow('Insufficient permissions to modify agent tools');
    });

    it('throws when agent is not found', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      mockGetAgent.mockResolvedValue(null);

      await expect(removeToolFromAgent(TEST_WORKSPACE_ID, 'gone', 'Bash', 'user-1'))
        .rejects.toThrow('Agent gone not found');
    });
  });

  // ────────────────────────────────────────────────
  // registerCustomTool
  // ────────────────────────────────────────────────
  describe('registerCustomTool', () => {
    it('registers a new custom tool with defaults', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockExecute.mockResolvedValue(undefined);

      const result = await registerCustomTool(
        TEST_WORKSPACE_ID,
        'my-tool',
        '{"type":"object"}',
        '/scripts/my-tool.js',
        'user-1',
      );

      expect(result).toMatchObject({
        id: 'test-uuid-1234',
        name: 'my-tool',
        tool_type: 'custom',
        approved: true,
        access_level: 'read-only',
      });
    });

    it('throws when tool name already exists', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'existing-id' });

      await expect(
        registerCustomTool(TEST_WORKSPACE_ID, 'dup', '{}', null, 'user-1'),
      ).rejects.toThrow('Tool "dup" already registered');
    });
  });

  // ────────────────────────────────────────────────
  // approveCustomTool (now uses isPlatformAdmin)
  // ────────────────────────────────────────────────
  describe('approveCustomTool', () => {
    it('approves a tool when called by platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValue(undefined);

      await expect(approveCustomTool(TEST_WORKSPACE_ID, 'my-tool', 'admin-1')).resolves.toBeUndefined();
      expect(mockIsPlatformAdmin).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'admin-1');
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE custom_tools SET approved = TRUE WHERE workspace_id = $1 AND name = $2',
        [TEST_WORKSPACE_ID, 'my-tool'],
      );
    });

    it('throws when caller is not a platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(false);

      await expect(approveCustomTool(TEST_WORKSPACE_ID, 'my-tool', 'user-x'))
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

      const result = await getToolCode(TEST_WORKSPACE_ID, 'my-tool');
      expect(result).toEqual({ code: 'console.log("hi")', language: 'javascript' });
    });

    it('returns null when tool has no script_code', async () => {
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ script_code: null }));

      const result = await getToolCode(TEST_WORKSPACE_ID, 'my-tool');
      expect(result).toBeNull();
    });

    it('returns null when tool does not exist', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getToolCode(TEST_WORKSPACE_ID, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // deleteCustomTool (now uses isPlatformAdmin)
  // ────────────────────────────────────────────────
  describe('deleteCustomTool', () => {
    it('deletes a tool when called by platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValue(undefined);

      await expect(deleteCustomTool(TEST_WORKSPACE_ID, 'my-tool', 'admin-1')).resolves.toBeUndefined();
      expect(mockExecute).toHaveBeenCalledWith(
        'DELETE FROM custom_tools WHERE workspace_id = $1 AND name = $2',
        [TEST_WORKSPACE_ID, 'my-tool'],
      );
    });

    it('throws when caller is not a platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(false);

      await expect(deleteCustomTool(TEST_WORKSPACE_ID, 'my-tool', 'user-x'))
        .rejects.toThrow('Only admins can delete custom tools');
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // updateToolConfig (now uses isPlatformAdmin)
  // ────────────────────────────────────────────────
  describe('updateToolConfig', () => {
    it('updates tool config when called by platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool());
      mockExecute.mockResolvedValue(undefined);

      await expect(
        updateToolConfig(TEST_WORKSPACE_ID, 'my-tool', '{"key":"val"}', 'admin-1'),
      ).resolves.toBeUndefined();

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE custom_tools SET config_json = $1 WHERE workspace_id = $2 AND name = $3',
        ['{"key":"val"}', TEST_WORKSPACE_ID, 'my-tool'],
      );
    });

    it('throws when caller is not platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(false);

      await expect(updateToolConfig(TEST_WORKSPACE_ID, 'my-tool', '{}', 'user-x'))
        .rejects.toThrow('Only admins can update tool config');
    });

    it('throws when tool not found', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(updateToolConfig(TEST_WORKSPACE_ID, 'ghost', '{}', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // setToolConfigKey (now uses isPlatformAdmin)
  // ────────────────────────────────────────────────
  describe('setToolConfigKey', () => {
    it('sets a key in the config JSON', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ config_json: '{"existing":"value"}' }));
      mockExecute.mockResolvedValue(undefined);

      const result = await setToolConfigKey(TEST_WORKSPACE_ID, 'my-tool', 'newKey', 'newVal', 'admin-1');

      expect(result).toEqual({ existing: 'value', newKey: 'newVal' });
    });

    it('throws when caller is not platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(false);

      await expect(setToolConfigKey(TEST_WORKSPACE_ID, 'my-tool', 'k', 'v', 'user-x'))
        .rejects.toThrow('Only admins can update tool config');
    });

    it('throws when tool not found', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(setToolConfigKey(TEST_WORKSPACE_ID, 'ghost', 'k', 'v', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // removeToolConfigKey (now uses isPlatformAdmin)
  // ────────────────────────────────────────────────
  describe('removeToolConfigKey', () => {
    it('removes a key from the config JSON', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ config_json: '{"a":"1","b":"2"}' }));
      mockExecute.mockResolvedValue(undefined);

      const result = await removeToolConfigKey(TEST_WORKSPACE_ID, 'my-tool', 'a', 'admin-1');

      expect(result).toEqual({ b: '2' });
    });

    it('throws when caller is not platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(false);

      await expect(removeToolConfigKey(TEST_WORKSPACE_ID, 'my-tool', 'k', 'user-x'))
        .rejects.toThrow('Only admins can update tool config');
    });

    it('throws when tool not found', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(removeToolConfigKey(TEST_WORKSPACE_ID, 'ghost', 'k', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // getToolConfig (now uses isPlatformAdmin)
  // ────────────────────────────────────────────────
  describe('getToolConfig', () => {
    it('returns parsed config JSON for platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ config_json: '{"apiKey":"secret"}' }));

      const result = await getToolConfig(TEST_WORKSPACE_ID, 'my-tool', 'admin-1');
      expect(result).toEqual({ apiKey: 'secret' });
    });

    it('returns empty object when config_json is null', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ config_json: null }));

      const result = await getToolConfig(TEST_WORKSPACE_ID, 'my-tool', 'admin-1');
      expect(result).toEqual({});
    });

    it('returns empty object when config_json is empty string', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ config_json: '' }));

      const result = await getToolConfig(TEST_WORKSPACE_ID, 'my-tool', 'admin-1');
      expect(result).toEqual({});
    });

    it('throws when caller is not platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(false);

      await expect(getToolConfig(TEST_WORKSPACE_ID, 'my-tool', 'user-x'))
        .rejects.toThrow('Only admins can view tool config');
    });

    it('throws when tool not found', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(getToolConfig(TEST_WORKSPACE_ID, 'ghost', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // updateToolAccessLevel (now uses isPlatformAdmin)
  // ────────────────────────────────────────────────
  describe('updateToolAccessLevel', () => {
    it('updates access level for platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool());
      mockExecute.mockResolvedValue(undefined);

      await expect(
        updateToolAccessLevel(TEST_WORKSPACE_ID, 'my-tool', 'read-write', 'admin-1'),
      ).resolves.toBeUndefined();

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE custom_tools SET access_level = $1 WHERE workspace_id = $2 AND name = $3',
        ['read-write', TEST_WORKSPACE_ID, 'my-tool'],
      );
    });

    it('throws when caller is not platform admin', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(false);

      await expect(updateToolAccessLevel(TEST_WORKSPACE_ID, 'my-tool', 'read-write', 'user-x'))
        .rejects.toThrow('Only admins can change tool access level');
    });

    it('throws when tool not found', async () => {
      mockIsPlatformAdmin.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(updateToolAccessLevel(TEST_WORKSPACE_ID, 'ghost', 'read-write', 'admin-1'))
        .rejects.toThrow('Tool "ghost" not found');
    });
  });

  // ────────────────────────────────────────────────
  // getAgentToolSummary (now uses workspaceId for getAgent)
  // ────────────────────────────────────────────────
  describe('getAgentToolSummary', () => {
    it('categorizes tools into builtin, custom, and mcp', async () => {
      mockGetAgent.mockResolvedValue(makeFakeAgent({
        tools: ['Bash', 'Read', 'my-custom', 'mcp-server::tool'],
      }));
      mockQueryOne.mockResolvedValueOnce(makeFakeCustomTool({ name: 'my-custom' }));
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getAgentToolSummary(TEST_WORKSPACE_ID, 'agent-1');

      expect(result).toEqual({
        builtin: ['Bash', 'Read'],
        custom: ['my-custom'],
        mcp: ['mcp-server::tool'],
      });
      expect(mockGetAgent).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'agent-1');
    });

    it('returns empty arrays when agent has no tools', async () => {
      mockGetAgent.mockResolvedValue(makeFakeAgent({ tools: [] }));

      const result = await getAgentToolSummary(TEST_WORKSPACE_ID, 'agent-1');

      expect(result).toEqual({ builtin: [], custom: [], mcp: [] });
    });

    it('handles agent with only builtin tools', async () => {
      mockGetAgent.mockResolvedValue(makeFakeAgent({
        tools: ['Bash', 'Grep', 'Glob'],
      }));

      const result = await getAgentToolSummary(TEST_WORKSPACE_ID, 'agent-1');

      expect(result).toEqual({
        builtin: ['Bash', 'Grep', 'Glob'],
        custom: [],
        mcp: [],
      });
      expect(mockQueryOne).not.toHaveBeenCalled();
    });

    it('throws when agent is not found', async () => {
      mockGetAgent.mockResolvedValue(null);

      await expect(getAgentToolSummary(TEST_WORKSPACE_ID, 'missing'))
        .rejects.toThrow('Agent missing not found');
    });
  });

  // ────────────────────────────────────────────────
  // listCustomTools / listUserAvailableTools / listWriteTools
  // ────────────────────────────────────────────────
  describe('listCustomTools', () => {
    it('returns all custom tools', async () => {
      const tools = [makeFakeCustomTool({ name: 'a' }), makeFakeCustomTool({ name: 'b' })];
      mockQuery.mockResolvedValueOnce(tools);

      const result = await listCustomTools(TEST_WORKSPACE_ID);
      expect(result).toEqual(tools);
    });
  });

  describe('listUserAvailableTools', () => {
    it('queries for approved read-only tools', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await listUserAvailableTools(TEST_WORKSPACE_ID);
      expect(result).toEqual([]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("approved = TRUE AND access_level = 'read-only'"),
        [TEST_WORKSPACE_ID],
      );
    });
  });

  describe('listWriteTools', () => {
    it('queries for approved read-write tools', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await listWriteTools(TEST_WORKSPACE_ID);
      expect(result).toEqual([]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("approved = TRUE AND access_level = 'read-write'"),
        [TEST_WORKSPACE_ID],
      );
    });
  });

  // ────────────────────────────────────────────────
  // getCustomTool
  // ────────────────────────────────────────────────
  describe('getCustomTool', () => {
    it('returns the tool when found', async () => {
      const fakeTool = makeFakeCustomTool();
      mockQueryOne.mockResolvedValueOnce(fakeTool);

      const result = await getCustomTool(TEST_WORKSPACE_ID, 'my-tool');
      expect(result).toEqual(fakeTool);
    });

    it('returns null when tool is not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getCustomTool(TEST_WORKSPACE_ID, 'missing');
      expect(result).toBeNull();
    });
  });
});
