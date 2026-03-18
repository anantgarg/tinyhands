import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock uuid ──
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mem-uuid-1234'),
}));

// ── Mock DB ──
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  storeMemory,
  storeMemories,
  retrieveMemories,
  getAgentMemories,
  forgetMemory,
  clearAgentMemory,
} from '../../src/modules/sources/memory';

const TEST_WORKSPACE_ID = 'W_TEST_123';

describe('Agent Memory Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: pruneMemories finds count under limit
    mockQueryOne.mockResolvedValue({ count: '10' });
    // Default: execute returns a rowCount
    mockExecute.mockResolvedValue({ rowCount: 0 });
  });

  // ── storeMemory ──

  describe('storeMemory', () => {
    it('should insert a memory with generated UUID', async () => {
      const result = await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: 'The customer prefers email communication',
        category: 'customer_preference',
      });

      expect(result.id).toBe('mem-uuid-1234');
      expect(result.agent_id).toBe('agent-1');
      expect(result.run_id).toBe('run-1');
      expect(result.fact).toBe('The customer prefers email communication');
      expect(result.category).toBe('customer_preference');
      expect(result.relevance_score).toBe(1.0);
      expect(result.created_at).toBeDefined();

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agent_memory'),
        expect.arrayContaining(['mem-uuid-1234', 'agent-1', 'run-1'])
      );
    });

    it('should use custom relevance score when provided', async () => {
      const result = await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: 'A technical detail',
        category: 'technical',
        relevanceScore: 0.8,
      });

      expect(result.relevance_score).toBe(0.8);
    });

    it('should default relevance_score to 1.0', async () => {
      const result = await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: 'some fact',
        category: 'general',
      });

      expect(result.relevance_score).toBe(1.0);
    });

    it('should prune memories after storing', async () => {
      await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: 'fact',
        category: 'general',
      });

      // pruneMemories calls queryOne for count
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        ['agent-1', TEST_WORKSPACE_ID]
      );
    });

    it('should prune excess memories when over the 500 cap', async () => {
      // Simulate 510 memories
      mockQueryOne.mockResolvedValue({ count: '510' });

      await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: 'fact',
        category: 'general',
      });

      // First execute call is the INSERT, second is the DELETE for pruning
      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(mockExecute).toHaveBeenLastCalledWith(
        expect.stringContaining('DELETE FROM agent_memory'),
        ['agent-1', TEST_WORKSPACE_ID, 10] // 510 - 500 = 10 excess
      );
    });

    it('should not prune when memory count is at or under the cap', async () => {
      mockQueryOne.mockResolvedValue({ count: '500' });

      await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: 'fact',
        category: 'general',
      });

      // Only the INSERT execute call, no prune DELETE
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('should accept all valid memory categories', async () => {
      const categories = [
        'customer_preference', 'decision', 'context', 'technical',
        'general', 'preference', 'procedure', 'correction', 'entity',
      ] as const;

      for (const category of categories) {
        vi.clearAllMocks();
        mockQueryOne.mockResolvedValue({ count: '10' });
        mockExecute.mockResolvedValue({ rowCount: 0 });

        const result = await storeMemory(TEST_WORKSPACE_ID, {
          agentId: 'agent-1',
          runId: 'run-1',
          fact: `fact for ${category}`,
          category,
        });

        expect(result.category).toBe(category);
      }
    });
  });

  // ── storeMemories (batch) ──

  describe('storeMemories', () => {
    it('should store multiple memories and return all results', async () => {
      const facts = [
        { fact: 'Fact one', category: 'general' as const },
        { fact: 'Fact two', category: 'technical' as const },
        { fact: 'Fact three', category: 'decision' as const },
      ];

      const results = await storeMemories(TEST_WORKSPACE_ID, 'agent-1', 'run-1', facts);

      expect(results).toHaveLength(3);
      // Each memory triggers an INSERT + a prune check
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });

    it('should return empty array for empty facts list', async () => {
      const results = await storeMemories(TEST_WORKSPACE_ID, 'agent-1', 'run-1', []);
      expect(results).toEqual([]);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should pass agent and run IDs to each store call', async () => {
      const facts = [
        { fact: 'Fact A', category: 'context' as const },
      ];

      const results = await storeMemories(TEST_WORKSPACE_ID, 'agent-99', 'run-42', facts);

      expect(results[0].agent_id).toBe('agent-99');
      expect(results[0].run_id).toBe('run-42');
    });
  });

  // ── retrieveMemories ──

  describe('retrieveMemories', () => {
    it('should perform FTS query with OR-joined terms', async () => {
      mockQuery.mockResolvedValue([
        { id: 'm1', fact: 'Customer likes email', category: 'customer_preference', relevance_score: 1.0, rank: 0.5 },
      ]);

      const results = await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', 'customer email preference');

      expect(results).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ts_rank'),
        expect.arrayContaining(['customer | email | preference', 'agent-1', 10])
      );
    });

    it('should filter out short words (2 chars or less)', async () => {
      mockQuery.mockResolvedValue([]);

      await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', 'the a to big data');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['the | big | data', 'agent-1', 10])
      );
    });

    it('should return empty array when query produces no FTS terms', async () => {
      const results = await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', 'a b c');

      expect(results).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should strip special characters from query text', async () => {
      mockQuery.mockResolvedValue([]);

      await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', 'hello@world! how are you?');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([expect.stringContaining('hello'), 'agent-1', 10])
      );
      // The query should not contain @, !, ?
      const ftsArg = mockQuery.mock.calls[0][1][0];
      expect(ftsArg).not.toContain('@');
      expect(ftsArg).not.toContain('!');
      expect(ftsArg).not.toContain('?');
    });

    it('should limit to 10 search terms', async () => {
      mockQuery.mockResolvedValue([]);

      const longQuery = 'one two three four five six seven eight nine ten eleven twelve thirteen';
      await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', longQuery);

      const ftsArg = mockQuery.mock.calls[0][1][0] as string;
      const terms = ftsArg.split(' | ');
      expect(terms.length).toBeLessThanOrEqual(10);
    });

    it('should respect token budget and filter out memories that exceed it', async () => {
      mockQuery.mockResolvedValue([
        { id: 'm1', fact: 'Short fact', category: 'general', relevance_score: 1.0, rank: 0.9 },
        { id: 'm2', fact: 'A'.repeat(8000), category: 'general', relevance_score: 1.0, rank: 0.8 },
        { id: 'm3', fact: 'Another short fact', category: 'general', relevance_score: 1.0, rank: 0.7 },
      ]);

      // Use a small token budget: 'Short fact' is ~3 tokens (10 chars / 4)
      // The 8000-char fact is ~2000 tokens
      const results = await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', 'some query', 50);

      // First fact fits (~3 tokens), second doesn't (2000 tokens > 50 budget remaining),
      // third fits (~5 tokens)
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('m1');
      expect(results[1].id).toBe('m3');
    });

    it('should fall back to LIKE search when FTS query fails', async () => {
      // First call (FTS) throws, second call (LIKE fallback) succeeds
      mockQuery
        .mockRejectedValueOnce(new Error('syntax error in tsquery'))
        .mockResolvedValueOnce([
          { id: 'm1', fact: 'fallback result', category: 'general', relevance_score: 0.9 },
        ]);

      const results = await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', 'search term');

      expect(results).toHaveLength(1);
      expect(results[0].fact).toBe('fallback result');

      // LIKE fallback uses $2 with % wildcards
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIKE'),
        expect.arrayContaining(['agent-1', '%search term%', 10])
      );
    });

    it('should use default token budget of 2000 when not specified', async () => {
      mockQuery.mockResolvedValue([
        { id: 'm1', fact: 'A'.repeat(7996), category: 'general', relevance_score: 1.0, rank: 0.9 },
        { id: 'm2', fact: 'extra', category: 'general', relevance_score: 1.0, rank: 0.8 },
      ]);

      // 7996 chars / 4 = 1999 tokens, fits. Second fact is 5 chars / 4 = 2 tokens, total 2001 > 2000
      const results = await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', 'some query');

      expect(results).toHaveLength(1);
    });
  });

  // ── getAgentMemories ──

  describe('getAgentMemories', () => {
    it('should return all memories for an agent in descending order', async () => {
      const mockMemories = [
        { id: 'm2', agent_id: 'agent-1', fact: 'newer', created_at: '2024-02-01' },
        { id: 'm1', agent_id: 'agent-1', fact: 'older', created_at: '2024-01-01' },
      ];
      mockQuery.mockResolvedValue(mockMemories);

      const results = await getAgentMemories(TEST_WORKSPACE_ID, 'agent-1');

      expect(results).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['agent-1', TEST_WORKSPACE_ID]
      );
    });

    it('should return empty array for agent with no memories', async () => {
      mockQuery.mockResolvedValue([]);

      const results = await getAgentMemories(TEST_WORKSPACE_ID, 'agent-empty');
      expect(results).toEqual([]);
    });
  });

  // ── forgetMemory ──

  describe('forgetMemory', () => {
    it('should delete memories matching search term with LIKE', async () => {
      mockExecute.mockResolvedValue({ rowCount: 3 });

      const count = await forgetMemory(TEST_WORKSPACE_ID, 'agent-1', 'customer preference');

      expect(count).toBe(3);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM agent_memory'),
        ['agent-1', TEST_WORKSPACE_ID, '%customer preference%']
      );
    });

    it('should return 0 when no memories match', async () => {
      mockExecute.mockResolvedValue({ rowCount: 0 });

      const count = await forgetMemory(TEST_WORKSPACE_ID, 'agent-1', 'nonexistent topic');
      expect(count).toBe(0);
    });

    it('should use the agentId to scope deletion', async () => {
      mockExecute.mockResolvedValue({ rowCount: 1 });

      await forgetMemory(TEST_WORKSPACE_ID, 'agent-specific', 'some fact');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('agent_id = $1'),
        ['agent-specific', TEST_WORKSPACE_ID, '%some fact%']
      );
    });
  });

  // ── clearAgentMemory ──

  describe('clearAgentMemory', () => {
    it('should delete all memories for the agent', async () => {
      mockExecute.mockResolvedValue({ rowCount: 42 });

      const count = await clearAgentMemory(TEST_WORKSPACE_ID, 'agent-1');

      expect(count).toBe(42);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM agent_memory WHERE agent_id = $1'),
        ['agent-1', TEST_WORKSPACE_ID]
      );
    });

    it('should return 0 when agent has no memories', async () => {
      mockExecute.mockResolvedValue({ rowCount: 0 });

      const count = await clearAgentMemory(TEST_WORKSPACE_ID, 'agent-empty');
      expect(count).toBe(0);
    });
  });

  // ── pruneMemories (tested via storeMemory) ──

  describe('pruneMemories (via storeMemory)', () => {
    it('should delete lowest-relevance memories first when pruning', async () => {
      mockQueryOne.mockResolvedValue({ count: '505' });

      await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: 'new fact',
        category: 'general',
      });

      // The DELETE for pruning should order by relevance_score ASC, created_at ASC
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY relevance_score ASC, created_at ASC'),
        ['agent-1', TEST_WORKSPACE_ID, 5] // 505 - 500 = 5
      );
    });

    it('should handle null count from queryOne gracefully', async () => {
      mockQueryOne.mockResolvedValue(null);

      // Should not throw
      await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: 'fact',
        category: 'general',
      });

      // Only the INSERT execute, no prune (count parsed as 0)
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('should handle count result with undefined count field', async () => {
      mockQueryOne.mockResolvedValue({ count: undefined });

      await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: 'fact',
        category: 'general',
      });

      // NaN from parseInt of undefined becomes 0, which is < 500, so no pruning
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('should handle empty fact string', async () => {
      const result = await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: '',
        category: 'general',
      });

      expect(result.fact).toBe('');
      expect(mockExecute).toHaveBeenCalled();
    });

    it('should handle very long fact strings', async () => {
      const longFact = 'A'.repeat(10000);
      const result = await storeMemory(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        runId: 'run-1',
        fact: longFact,
        category: 'technical',
      });

      expect(result.fact).toBe(longFact);
    });

    it('should truncate search term in LIKE fallback to 50 chars', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('tsquery error'))
        .mockResolvedValueOnce([]);

      const longQuery = 'A'.repeat(100);
      await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', longQuery);

      // The LIKE fallback should use .slice(0, 50)
      const likeArg = mockQuery.mock.calls[1][1][2];
      // %...% wraps the 50-char slice
      expect(likeArg.length).toBe(52); // % + 50 chars + %
    });

    it('retrieveMemories should handle query with only special chars', async () => {
      const results = await retrieveMemories(TEST_WORKSPACE_ID, 'agent-1', '!@#$%');
      expect(results).toEqual([]);
    });
  });
});
