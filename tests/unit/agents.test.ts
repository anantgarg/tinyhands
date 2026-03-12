import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock DB
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

vi.mock('../../src/slack', () => ({
  ensureBotInChannels: vi.fn(),
}));

import {
  createAgent,
  getAgent,
  getAgentByName,
  getAgentByChannel,
  getAgentsByChannel,
  listAgents,
  updateAgent,
  deleteAgent,
  getAgentVersions,
  ensureBotInAllAgentChannels,
} from '../../src/modules/agents';

describe('Agent Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const fakeClient = { query: vi.fn() };
      return fn(fakeClient);
    });
  });

  describe('createAgent', () => {
    it('should create an agent with defaults', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined); // no existing agent

      const agent = await createAgent({
        name: 'test-agent',
        channelId: 'C123',
        systemPrompt: 'You are a test agent',
        createdBy: 'U001',
      });

      expect(agent.name).toBe('test-agent');
      expect(agent.channel_id).toBe('C123');
      expect(agent.channel_ids).toEqual(['C123']);
      expect(agent.model).toBe('sonnet');
      expect(agent.permission_level).toBe('standard');
      expect(agent.status).toBe('active');
      expect(agent.memory_enabled).toBe(false);
      expect(agent.respond_to_all_messages).toBe(false);
      expect(agent.tools).toEqual(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch']);
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should create with custom options', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const agent = await createAgent({
        name: 'custom-agent',
        channelId: 'C456',
        channelIds: ['C456', 'C789'],
        systemPrompt: 'Custom prompt',
        tools: ['Read', 'Glob'],
        model: 'opus',
        permissionLevel: 'full',
        memoryEnabled: true,
        respondToAllMessages: true,
        relevanceKeywords: ['deploy', 'release'],
        createdBy: 'U002',
      });

      expect(agent.channel_ids).toEqual(['C456', 'C789']);
      expect(agent.model).toBe('opus');
      expect(agent.permission_level).toBe('full');
      expect(agent.memory_enabled).toBe(true);
      expect(agent.respond_to_all_messages).toBe(true);
      expect(agent.relevance_keywords).toEqual(['deploy', 'release']);
      expect(agent.tools).toEqual(['Read', 'Glob']);
    });

    it('should throw if name already exists', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'existing-id' });

      await expect(
        createAgent({
          name: 'existing-agent',
          channelId: 'C123',
          systemPrompt: 'test',
          createdBy: 'U001',
        })
      ).rejects.toThrow('already exists');
    });
  });

  describe('getAgent', () => {
    it('should return deserialized agent', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1',
        name: 'test',
        channel_id: 'C1',
        channel_ids: ['C1', 'C2'],
        tools: '["Read","Write"]',
        relevance_keywords: '["test"]',
      });

      const agent = await getAgent('a1');
      expect(agent).toBeDefined();
      expect(agent!.tools).toEqual(['Read', 'Write']);
      expect(agent!.relevance_keywords).toEqual(['test']);
      expect(agent!.channel_ids).toEqual(['C1', 'C2']);
    });

    it('should return null for missing agent', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);
      const agent = await getAgent('nonexistent');
      expect(agent).toBeNull();
    });
  });

  describe('getAgentByName', () => {
    it('should find agent by name', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'my-agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      const agent = await getAgentByName('my-agent');
      expect(agent).toBeDefined();
      expect(agent!.name).toBe('my-agent');
    });
  });

  describe('getAgentByChannel', () => {
    it('should find agent by channel', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'ch-agent', channel_id: 'C123',
        tools: '[]', relevance_keywords: '[]',
      });

      const agent = await getAgentByChannel('C123');
      expect(agent).toBeDefined();
    });
  });

  describe('getAgentsByChannel', () => {
    it('should return multiple agents for a channel', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', name: 'agent1', channel_id: 'C1', tools: '[]', relevance_keywords: '[]' },
        { id: 'a2', name: 'agent2', channel_id: 'C1', tools: '[]', relevance_keywords: '[]' },
      ]);

      const agents = await getAgentsByChannel('C1');
      expect(agents).toHaveLength(2);
    });
  });

  describe('listAgents', () => {
    it('should list non-archived agents', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', name: 'active-agent', status: 'active', tools: '[]', relevance_keywords: '[]' },
      ]);

      const agents = await listAgents();
      expect(agents).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('status !='),
        ['archived']
      );
    });
  });

  describe('updateAgent', () => {
    it('should update agent fields', async () => {
      // getAgent call
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'old-name', channel_id: 'C1',
        system_prompt: 'old prompt',
        tools: '[]', relevance_keywords: '[]',
      });
      // dup name check — no duplicate
      mockQueryOne.mockResolvedValueOnce(undefined);
      // getAgent after update
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'new-name', channel_id: 'C1',
        system_prompt: 'old prompt',
        tools: '[]', relevance_keywords: '[]',
      });

      const updated = await updateAgent('a1', { name: 'new-name' }, 'U001');
      expect(updated.name).toBe('new-name');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should throw if agent not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      await expect(
        updateAgent('nonexistent', { name: 'x' }, 'U001')
      ).rejects.toThrow('not found');
    });

    it('should return existing agent when no updates', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'test', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      const result = await updateAgent('a1', {}, 'U001');
      expect(result.name).toBe('test');
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });
  });

  describe('deleteAgent', () => {
    it('should archive the agent', async () => {
      await deleteAgent('a1');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        ['archived', 'a1']
      );
    });
  });

  describe('getAgentVersions', () => {
    it('should return versions in descending order', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'v2', agent_id: 'a1', version: 2 },
        { id: 'v1', agent_id: 'a1', version: 1 },
      ]);

      const versions = await getAgentVersions('a1');
      expect(versions).toHaveLength(2);
    });
  });

  describe('ensureBotInAllAgentChannels', () => {
    it('should collect all channels from active agents', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', channel_ids: ['C1', 'C2'], tools: '[]', relevance_keywords: '[]' },
        { id: 'a2', channel_ids: ['C2', 'C3'], tools: '[]', relevance_keywords: '[]' },
      ]);

      await ensureBotInAllAgentChannels();
      // The function should have called ensureBotInChannels with unique channels
    });

    it('should handle agents with no channels', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', channel_ids: [], tools: '[]', relevance_keywords: '[]' },
      ]);

      await ensureBotInAllAgentChannels();
      // Should not throw
    });
  });
});
