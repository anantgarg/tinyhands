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

const mockIsSuperadmin = vi.fn();
vi.mock('../../src/modules/access-control', () => ({
  isSuperadmin: (...args: any[]) => mockIsSuperadmin(...args),
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
  getAgentVersion,
  revertAgent,
  ensureBotInAllAgentChannels,
  addAgentMember,
  removeAgentMember,
  getAgentMembers,
  isAgentMember,
  addAgentMembers,
  canAccessAgent,
  createDmConversation,
  getDmConversation,
  touchDmConversation,
  getAccessibleAgents,
} from '../../src/modules/agents';

const TEST_WORKSPACE_ID = 'W_TEST_123';

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

      const agent = await createAgent(TEST_WORKSPACE_ID, {
        name: 'test-agent',
        channelId: 'C123',
        systemPrompt: 'You are a test agent',
        createdBy: 'U001',
      });

      expect(agent.name).toBe('test-agent');
      expect(agent.channel_id).toBe('C123');
      expect(agent.channel_ids).toEqual(['C123']);
      expect(agent.model).toBe('sonnet');
      expect(agent.status).toBe('active');
      expect(agent.memory_enabled).toBe(false);
      expect(agent.respond_to_all_messages).toBe(false);
      expect(agent.tools).toEqual(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch']);
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should create with custom options', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const agent = await createAgent(TEST_WORKSPACE_ID, {
        name: 'custom-agent',
        channelId: 'C456',
        channelIds: ['C456', 'C789'],
        systemPrompt: 'Custom prompt',
        tools: ['Read', 'Glob'],
        model: 'opus',
        memoryEnabled: true,
        respondToAllMessages: true,
        relevanceKeywords: ['deploy', 'release'],
        createdBy: 'U002',
      });

      expect(agent.channel_ids).toEqual(['C456', 'C789']);
      expect(agent.model).toBe('opus');
      expect(agent.memory_enabled).toBe(true);
      expect(agent.respond_to_all_messages).toBe(true);
      expect(agent.relevance_keywords).toEqual(['deploy', 'release']);
      expect(agent.tools).toEqual(['Read', 'Glob']);
    });

    it('should throw if name already exists', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'existing-id' });

      await expect(
        createAgent(TEST_WORKSPACE_ID, {
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

      const agent = await getAgent(TEST_WORKSPACE_ID, 'a1');
      expect(agent).toBeDefined();
      expect(agent!.tools).toEqual(['Read', 'Write']);
      expect(agent!.relevance_keywords).toEqual(['test']);
      expect(agent!.channel_ids).toEqual(['C1', 'C2']);
    });

    it('should return null for missing agent', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);
      const agent = await getAgent(TEST_WORKSPACE_ID, 'nonexistent');
      expect(agent).toBeNull();
    });
  });

  describe('getAgentByName', () => {
    it('should find agent by name', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'my-agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      const agent = await getAgentByName(TEST_WORKSPACE_ID, 'my-agent');
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

      const agent = await getAgentByChannel(TEST_WORKSPACE_ID, 'C123');
      expect(agent).toBeDefined();
    });
  });

  describe('getAgentsByChannel', () => {
    it('should return multiple agents for a channel', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', name: 'agent1', channel_id: 'C1', tools: '[]', relevance_keywords: '[]' },
        { id: 'a2', name: 'agent2', channel_id: 'C1', tools: '[]', relevance_keywords: '[]' },
      ]);

      const agents = await getAgentsByChannel(TEST_WORKSPACE_ID, 'C1');
      expect(agents).toHaveLength(2);
    });
  });

  describe('listAgents', () => {
    it('should list non-archived agents', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', name: 'active-agent', status: 'active', tools: '[]', relevance_keywords: '[]' },
      ]);

      const agents = await listAgents(TEST_WORKSPACE_ID);
      expect(agents).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('status !='),
        [TEST_WORKSPACE_ID, 'archived']
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

      const updated = await updateAgent(TEST_WORKSPACE_ID, 'a1', { name: 'new-name' }, 'U001');
      expect(updated.name).toBe('new-name');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should throw if agent not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      await expect(
        updateAgent(TEST_WORKSPACE_ID, 'nonexistent', { name: 'x' }, 'U001')
      ).rejects.toThrow('not found');
    });

    it('should return existing agent when no updates', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'test', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      const result = await updateAgent(TEST_WORKSPACE_ID, 'a1', {}, 'U001');
      expect(result.name).toBe('test');
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });
  });

  describe('deleteAgent', () => {
    it('should archive the agent', async () => {
      await deleteAgent(TEST_WORKSPACE_ID, 'a1');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        ['archived', TEST_WORKSPACE_ID, 'a1']
      );
    });
  });

  describe('getAgentVersions', () => {
    it('should return versions in descending order', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'v2', agent_id: 'a1', version: 2 },
        { id: 'v1', agent_id: 'a1', version: 1 },
      ]);

      const versions = await getAgentVersions(TEST_WORKSPACE_ID, 'a1');
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

    it('should handle agents with null channel_ids', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', channel_ids: null, channel_id: 'C1', tools: '[]', relevance_keywords: '[]' },
      ]);

      await ensureBotInAllAgentChannels();
      // Should not throw - null channel_ids treated as empty
    });
  });

  describe('createAgent - private visibility', () => {
    it('should auto-add creator as member for private agents', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined); // no existing agent

      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      const agent = await createAgent(TEST_WORKSPACE_ID, {
        name: 'private-agent',
        channelId: 'C123',
        systemPrompt: 'Private prompt',
        visibility: 'private',
        createdBy: 'U001',
      });

      expect(agent.visibility).toBe('private');
      // Should have 3 queries: insert agent, insert member, insert version
      expect(fakeClient.query).toHaveBeenCalledTimes(3);
      // The second call should be the member insertion
      expect(fakeClient.query.mock.calls[1][0]).toContain('agent_members');
    });
  });

  describe('updateAgent - all field branches', () => {
    function setupUpdateMocks(existingOverrides: Record<string, any> = {}, updatedOverrides: Record<string, any> = {}) {
      // getAgent call (existing)
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1', channel_ids: ['C1'],
        system_prompt: 'old prompt',
        tools: '[]', relevance_keywords: '[]',
        status: 'active',
        ...existingOverrides,
      });
      return updatedOverrides;
    }

    it('should update channel_ids and set channel_id to first entry', async () => {
      setupUpdateMocks();
      // getAgent after update
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C2', channel_ids: ['C2', 'C3'],
        tools: '[]', relevance_keywords: '[]',
      });

      const result = await updateAgent(TEST_WORKSPACE_ID, 'a1', { channel_ids: ['C2', 'C3'] }, 'U001');
      expect(result.channel_ids).toEqual(['C2', 'C3']);
    });

    it('should update channel_id and auto-create channel_ids array', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C5', channel_ids: ['C5'],
        tools: '[]', relevance_keywords: '[]',
      });

      const result = await updateAgent(TEST_WORKSPACE_ID, 'a1', { channel_id: 'C5' }, 'U001');
      expect(result.channel_id).toBe('C5');
    });

    it('should update system_prompt and create version entry', async () => {
      const fakeClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      setupUpdateMocks({ system_prompt: 'old prompt' });
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        system_prompt: 'new prompt',
        tools: '[]', relevance_keywords: '[]',
      });

      const result = await updateAgent(TEST_WORKSPACE_ID, 'a1', { system_prompt: 'new prompt' }, 'U001');
      expect(result.system_prompt).toBe('new prompt');
      // Should have called query for UPDATE and for version tracking
      expect(fakeClient.query).toHaveBeenCalledTimes(3); // UPDATE + SELECT MAX + INSERT version
    });

    it('should not create version entry when system_prompt unchanged', async () => {
      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      setupUpdateMocks({ system_prompt: 'same prompt' });
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        system_prompt: 'same prompt',
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { system_prompt: 'same prompt' }, 'U001');
      // Only the UPDATE query, no version insert
      expect(fakeClient.query).toHaveBeenCalledTimes(1);
    });

    it('should update tools field', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '["Read","Write"]', relevance_keywords: '[]',
      });

      const result = await updateAgent(TEST_WORKSPACE_ID, 'a1', { tools: ['Read', 'Write'] }, 'U001');
      expect(result.tools).toEqual(['Read', 'Write']);
    });

    it('should update avatar_emoji', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]', avatar_emoji: ':star:',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { avatar_emoji: ':star:' }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update status', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]', status: 'paused',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { status: 'paused' }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update model', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]', model: 'opus',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { model: 'opus' }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update streaming_detail', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]', streaming_detail: true,
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { streaming_detail: true }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update self_evolution_mode', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { self_evolution_mode: 'autonomous' }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update max_turns', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { max_turns: 20 }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update memory_enabled', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { memory_enabled: true }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update respond_to_all_messages', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { respond_to_all_messages: true }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update mentions_only', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { mentions_only: true }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update visibility', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { visibility: 'private' }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should update relevance_keywords', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '["deploy"]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { relevance_keywords: ['deploy'] }, 'U001');
      expect(mockWithTransaction).toHaveBeenCalled();
    });

    it('should throw when duplicate name is found', async () => {
      // getAgent
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
      });
      // dup name check — found duplicate
      mockQueryOne.mockResolvedValueOnce({ id: 'a2' });

      await expect(
        updateAgent(TEST_WORKSPACE_ID, 'a1', { name: 'taken-name' }, 'U001')
      ).rejects.toThrow('already exists');
    });

    it('should auto-join bot to new channels when channel_ids updated', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C5', channel_ids: ['C5'],
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { channel_ids: ['C5'] }, 'U001');
      // The auto-join is async (import().then()) — just verify no error
    });

    it('should auto-join bot when channel_id is updated without channel_ids', async () => {
      setupUpdateMocks();
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C9',
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { channel_id: 'C9' }, 'U001');
      // The auto-join is async — just verify no error
    });

    it('should handle system_prompt version when max_version is null', async () => {
      const fakeClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ max_version: null }] }),
      };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      setupUpdateMocks({ system_prompt: 'old' });
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        system_prompt: 'new',
        tools: '[]', relevance_keywords: '[]',
      });

      await updateAgent(TEST_WORKSPACE_ID, 'a1', { system_prompt: 'new' }, 'U001');
      // Should create version 1 when max_version is null
      const insertCall = fakeClient.query.mock.calls[2];
      expect(insertCall[0]).toContain('agent_versions');
      expect(insertCall[1][2]).toBe(1); // nextVersion
    });
  });

  describe('getAgentVersion', () => {
    it('should return version when found', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'v1', agent_id: 'a1', version: 1,
        system_prompt: 'test prompt', change_note: 'Initial', changed_by: 'U001',
      });

      const version = await getAgentVersion(TEST_WORKSPACE_ID, 'a1', 1);
      expect(version).toBeDefined();
      expect(version!.version).toBe(1);
    });

    it('should return null when version not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const version = await getAgentVersion(TEST_WORKSPACE_ID, 'a1', 99);
      expect(version).toBeNull();
    });
  });

  describe('revertAgent', () => {
    it('should revert to target version system_prompt', async () => {
      // getAgentVersion
      mockQueryOne.mockResolvedValueOnce({
        id: 'v1', agent_id: 'a1', version: 1,
        system_prompt: 'original prompt',
      });
      // getAgent (inside updateAgent)
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        system_prompt: 'current prompt',
        tools: '[]', relevance_keywords: '[]',
      });

      const fakeClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ max_version: 2 }] }),
      };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      // getAgent after update
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        system_prompt: 'original prompt',
        tools: '[]', relevance_keywords: '[]',
      });

      const result = await revertAgent(TEST_WORKSPACE_ID, 'a1', 1, 'U001');
      expect(result.system_prompt).toBe('original prompt');
    });

    it('should throw when version not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      await expect(revertAgent(TEST_WORKSPACE_ID, 'a1', 99, 'U001')).rejects.toThrow('not found');
    });
  });

  describe('Agent Members', () => {
    describe('addAgentMember', () => {
      it('should add member with ON CONFLICT DO NOTHING', async () => {
        await addAgentMember(TEST_WORKSPACE_ID, 'a1', 'U001', 'U002');
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('agent_members'),
          ['a1', 'U001', 'U002']
        );
      });
    });

    describe('removeAgentMember', () => {
      it('should delete member from agent_members', async () => {
        await removeAgentMember(TEST_WORKSPACE_ID, 'a1', 'U001');
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('DELETE'),
          ['a1', 'U001']
        );
      });
    });

    describe('getAgentMembers', () => {
      it('should return array of user IDs', async () => {
        mockQuery.mockResolvedValueOnce([
          { user_id: 'U001' },
          { user_id: 'U002' },
        ]);

        const members = await getAgentMembers(TEST_WORKSPACE_ID, 'a1');
        expect(members).toEqual(['U001', 'U002']);
      });
    });

    describe('isAgentMember', () => {
      it('should return true when member exists', async () => {
        mockQueryOne.mockResolvedValueOnce({ '?column?': 1 });

        const result = await isAgentMember(TEST_WORKSPACE_ID, 'a1', 'U001');
        expect(result).toBe(true);
      });

      it('should return false when member does not exist', async () => {
        mockQueryOne.mockResolvedValueOnce(undefined);

        const result = await isAgentMember(TEST_WORKSPACE_ID, 'a1', 'U999');
        expect(result).toBe(false);
      });
    });

    describe('addAgentMembers', () => {
      it('should add multiple members', async () => {
        await addAgentMembers(TEST_WORKSPACE_ID, 'a1', ['U001', 'U002', 'U003'], 'U999');
        expect(mockExecute).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('canAccessAgent', () => {
    it('should return false when agent not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined); // getAgent
      const result = await canAccessAgent(TEST_WORKSPACE_ID, 'nonexistent', 'U001');
      expect(result).toBe(false);
    });

    it('should return true for public agents', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]', visibility: 'public',
      });

      const result = await canAccessAgent(TEST_WORKSPACE_ID, 'a1', 'U001');
      expect(result).toBe(true);
    });

    it('should return true for superadmins on private agents', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]', visibility: 'private',
      });
      mockIsSuperadmin.mockResolvedValueOnce(true);

      const result = await canAccessAgent(TEST_WORKSPACE_ID, 'a1', 'U-superadmin');
      expect(result).toBe(true);
    });

    it('should return true for agent admins on private agents', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]', visibility: 'private',
      });
      mockIsSuperadmin.mockResolvedValueOnce(false);
      // admin check
      mockQueryOne.mockResolvedValueOnce({ agent_id: 'a1', user_id: 'U-admin' });

      const result = await canAccessAgent(TEST_WORKSPACE_ID, 'a1', 'U-admin');
      expect(result).toBe(true);
    });

    it('should fall back to membership check for private agents', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]', visibility: 'private',
      });
      mockIsSuperadmin.mockResolvedValueOnce(false);
      // admin check — not admin
      mockQueryOne.mockResolvedValueOnce(undefined);
      // member check (isAgentMember)
      mockQueryOne.mockResolvedValueOnce({ '?column?': 1 });

      const result = await canAccessAgent(TEST_WORKSPACE_ID, 'a1', 'U-member');
      expect(result).toBe(true);
    });

    it('should return false for non-members on private agents', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]', visibility: 'private',
      });
      mockIsSuperadmin.mockResolvedValueOnce(false);
      // admin check — not admin
      mockQueryOne.mockResolvedValueOnce(undefined);
      // member check — not member
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await canAccessAgent(TEST_WORKSPACE_ID, 'a1', 'U-outsider');
      expect(result).toBe(false);
    });
  });

  describe('DM Conversations', () => {
    describe('createDmConversation', () => {
      it('should create a DM conversation record', async () => {
        const result = await createDmConversation(TEST_WORKSPACE_ID, 'U001', 'a1', 'D123', '1234.5678');
        expect(result.user_id).toBe('U001');
        expect(result.agent_id).toBe('a1');
        expect(result.dm_channel_id).toBe('D123');
        expect(result.thread_ts).toBe('1234.5678');
        expect(result.id).toBeDefined();
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('dm_conversations'),
          expect.any(Array)
        );
      });
    });

    describe('getDmConversation', () => {
      it('should return conversation when found', async () => {
        mockQueryOne.mockResolvedValueOnce({
          id: 'dm1', user_id: 'U001', agent_id: 'a1',
          dm_channel_id: 'D123', thread_ts: '1234.5678',
        });

        const result = await getDmConversation(TEST_WORKSPACE_ID, 'D123', '1234.5678');
        expect(result).toBeDefined();
        expect(result!.dm_channel_id).toBe('D123');
      });

      it('should return null when not found', async () => {
        mockQueryOne.mockResolvedValueOnce(undefined);

        const result = await getDmConversation(TEST_WORKSPACE_ID, 'D999', '0000.0000');
        expect(result).toBeNull();
      });
    });

    describe('touchDmConversation', () => {
      it('should update last_active_at', async () => {
        await touchDmConversation(TEST_WORKSPACE_ID, 'D123', '1234.5678');
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('last_active_at'),
          [TEST_WORKSPACE_ID, 'D123', '1234.5678']
        );
      });
    });
  });

  describe('getAccessibleAgents', () => {
    it('should return all agents for superadmins', async () => {
      mockIsSuperadmin.mockResolvedValueOnce(true);
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', name: 'agent1', tools: '[]', relevance_keywords: '[]' },
        { id: 'a2', name: 'agent2', tools: '[]', relevance_keywords: '[]' },
      ]);

      const agents = await getAccessibleAgents(TEST_WORKSPACE_ID, 'U-superadmin');
      expect(agents).toHaveLength(2);
    });

    it('should return filtered agents for non-superadmins', async () => {
      mockIsSuperadmin.mockResolvedValueOnce(false);
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', name: 'public-agent', visibility: 'public', tools: '[]', relevance_keywords: '[]' },
      ]);

      const agents = await getAccessibleAgents(TEST_WORKSPACE_ID, 'U-regular');
      expect(agents).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN agent_members'),
        [TEST_WORKSPACE_ID, 'U-regular']
      );
    });
  });

  describe('deserializeAgent edge cases', () => {
    it('should handle missing relevance_keywords', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: null,
      });

      const agent = await getAgent(TEST_WORKSPACE_ID, 'a1');
      expect(agent!.relevance_keywords).toEqual([]);
    });

    it('should handle missing channel_ids by falling back to channel_id', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        channel_ids: null,
        tools: '[]', relevance_keywords: '[]',
      });

      const agent = await getAgent(TEST_WORKSPACE_ID, 'a1');
      expect(agent!.channel_ids).toEqual(['C1']);
    });

    it('should handle missing visibility by defaulting to public', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1', name: 'agent', channel_id: 'C1',
        tools: '[]', relevance_keywords: '[]',
        visibility: null,
      });

      const agent = await getAgent(TEST_WORKSPACE_ID, 'a1');
      expect(agent!.visibility).toBe('public');
    });

    it('should return null for getAgentByName when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);
      const agent = await getAgentByName(TEST_WORKSPACE_ID, 'nonexistent');
      expect(agent).toBeNull();
    });

    it('should return null for getAgentByChannel when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);
      const agent = await getAgentByChannel(TEST_WORKSPACE_ID, 'C999');
      expect(agent).toBeNull();
    });
  });
});
