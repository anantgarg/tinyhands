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

vi.mock('../../src/utils/chunker', () => ({
  chunkText: vi.fn().mockReturnValue([
    { chunkIndex: 0, content: 'chunk 0', contentHash: 'hash0' },
    { chunkIndex: 1, content: 'chunk 1', contentHash: 'hash1' },
  ]),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createKBEntry,
  approveKBEntry,
  getKBEntry,
  listKBEntries,
  listPendingEntries,
  deleteKBEntry,
  searchKB,
  getCategories,
} from '../../src/modules/knowledge-base';
import { chunkText } from '../../src/utils/chunker';
import { logger } from '../../src/utils/logger';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ── Helpers ──

function makeRawRow(overrides: Record<string, any> = {}) {
  return {
    id: 'entry-1',
    title: 'Test Article',
    summary: 'A summary',
    content: 'Full content here',
    category: 'general',
    tags: '["tag1","tag2"]',
    access_scope: '"all"',
    source_type: 'manual',
    contributed_by: 'U001',
    approved: true,
    kb_source_id: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ──

describe('Knowledge Base Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const fakeClient = { query: vi.fn() };
      return fn(fakeClient);
    });
  });

  // ────────────────────────────────────────────
  // createKBEntry
  // ────────────────────────────────────────────
  describe('createKBEntry', () => {
    const baseParams = {
      title: 'New Article',
      summary: 'Article summary',
      content: 'Article content body',
      category: 'engineering',
      tags: ['node', 'typescript'],
      accessScope: 'all' as const,
      sourceType: 'manual' as const,
    };

    it('should create a manual entry with approved=true', async () => {
      const entry = await createKBEntry(TEST_WORKSPACE_ID, baseParams);

      expect(entry.title).toBe('New Article');
      expect(entry.summary).toBe('Article summary');
      expect(entry.content).toBe('Article content body');
      expect(entry.category).toBe('engineering');
      expect(entry.tags).toEqual(['node', 'typescript']);
      expect(entry.access_scope).toBe('all');
      expect(entry.source_type).toBe('manual');
      expect(entry.approved).toBe(true);
      expect(entry.contributed_by).toBeNull();
      expect(entry.kb_source_id).toBeNull();
      expect(entry.id).toBeDefined();
      expect(entry.created_at).toBeDefined();
      expect(entry.updated_at).toBeDefined();
    });

    it('should auto-approve manual source type entries', async () => {
      const entry = await createKBEntry(TEST_WORKSPACE_ID, { ...baseParams, sourceType: 'manual' });
      expect(entry.approved).toBe(true);
    });

    it('should not auto-approve non-manual source types', async () => {
      const entry = await createKBEntry(TEST_WORKSPACE_ID, { ...baseParams, sourceType: 'agent' });
      expect(entry.approved).toBe(false);
    });

    it('should allow explicit approved=true for non-manual sources', async () => {
      const entry = await createKBEntry(TEST_WORKSPACE_ID, {
        ...baseParams,
        sourceType: 'google_drive',
        approved: true,
      });
      expect(entry.approved).toBe(true);
    });

    it('should set contributedBy when provided', async () => {
      const entry = await createKBEntry(TEST_WORKSPACE_ID, {
        ...baseParams,
        contributedBy: 'U999',
      });
      expect(entry.contributed_by).toBe('U999');
    });

    it('should set kbSourceId when provided', async () => {
      const entry = await createKBEntry(TEST_WORKSPACE_ID, {
        ...baseParams,
        sourceType: 'zendesk_help_center',
        approved: true,
        kbSourceId: 'src-123',
      });
      expect(entry.kb_source_id).toBe('src-123');
    });

    it('should use withTransaction to insert entry', async () => {
      await createKBEntry(TEST_WORKSPACE_ID, baseParams);
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });

    it('should call client.query with INSERT statement and correct params', async () => {
      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      const entry = await createKBEntry(TEST_WORKSPACE_ID, baseParams);

      // First call is the INSERT
      expect(fakeClient.query).toHaveBeenCalled();
      const insertCall = fakeClient.query.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO kb_entries');
      const params = insertCall[1];
      expect(params[0]).toBe(entry.id); // id
      expect(params[1]).toBe(TEST_WORKSPACE_ID); // workspace_id
      expect(params[2]).toBe('New Article'); // title
      expect(params[6]).toBe(JSON.stringify(['node', 'typescript'])); // tags as JSON
      expect(params[7]).toBe(JSON.stringify('all')); // access_scope as JSON
      expect(params[10]).toBe(true); // approved (manual)
    });

    it('should index chunks when entry is approved', async () => {
      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      await createKBEntry(TEST_WORKSPACE_ID, baseParams); // manual → approved=true

      expect(chunkText).toHaveBeenCalledWith('Article content body', 'New Article');
      // INSERT for entry + 2 INSERT for chunks
      expect(fakeClient.query).toHaveBeenCalledTimes(3);

      const chunk0Call = fakeClient.query.mock.calls[1];
      expect(chunk0Call[0]).toContain('INSERT INTO kb_chunks');
      expect(chunk0Call[1][3]).toBe(0); // chunk_index
      expect(chunk0Call[1][4]).toBe('chunk 0'); // content
      expect(chunk0Call[1][5]).toBe('hash0'); // content_hash

      const chunk1Call = fakeClient.query.mock.calls[2];
      expect(chunk1Call[1][3]).toBe(1);
      expect(chunk1Call[1][4]).toBe('chunk 1');
      expect(chunk1Call[1][5]).toBe('hash1');
    });

    it('should NOT index chunks when entry is not approved', async () => {
      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      await createKBEntry(TEST_WORKSPACE_ID, { ...baseParams, sourceType: 'agent' }); // not approved

      expect(chunkText).not.toHaveBeenCalled();
      // Only 1 INSERT call (the entry itself, no chunk inserts)
      expect(fakeClient.query).toHaveBeenCalledTimes(1);
    });

    it('should log info after creation', async () => {
      const entry = await createKBEntry(TEST_WORKSPACE_ID, baseParams);

      expect(logger.info).toHaveBeenCalledWith('KB entry created', {
        entryId: entry.id,
        title: 'New Article',
        approved: true,
      });
    });

    it('should propagate transaction errors', async () => {
      mockWithTransaction.mockRejectedValue(new Error('DB connection failed'));

      await expect(createKBEntry(TEST_WORKSPACE_ID, baseParams)).rejects.toThrow('DB connection failed');
    });

    it('should handle access_scope as string array', async () => {
      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      const entry = await createKBEntry(TEST_WORKSPACE_ID, {
        ...baseParams,
        accessScope: ['agent-1', 'agent-2'],
      });

      expect(entry.access_scope).toEqual(['agent-1', 'agent-2']);
      const insertParams = fakeClient.query.mock.calls[0][1];
      expect(insertParams[7]).toBe(JSON.stringify(['agent-1', 'agent-2']));
    });
  });

  // ────────────────────────────────────────────
  // approveKBEntry
  // ────────────────────────────────────────────
  describe('approveKBEntry', () => {
    it('should approve an existing entry and index it', async () => {
      const rawRow = makeRawRow({ approved: false });
      mockQueryOne.mockResolvedValue(rawRow);
      mockExecute.mockResolvedValue(undefined);

      const result = await approveKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(result.approved).toBe(true);
      expect(result.id).toBe('entry-1');
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE kb_entries SET approved = TRUE, updated_at = NOW() WHERE id = $1 AND workspace_id = $2',
        ['entry-1', TEST_WORKSPACE_ID]
      );
    });

    it('should chunk and insert into kb_chunks on approval', async () => {
      const rawRow = makeRawRow({ approved: false });
      mockQueryOne.mockResolvedValue(rawRow);
      mockExecute.mockResolvedValue(undefined);

      await approveKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(chunkText).toHaveBeenCalledWith('Full content here', 'Test Article');
      // execute calls: 1 UPDATE + 2 chunk INSERTs
      expect(mockExecute).toHaveBeenCalledTimes(3);
      const chunkInsert = mockExecute.mock.calls[1];
      expect(chunkInsert[0]).toContain('INSERT INTO kb_chunks');
    });

    it('should throw if entry not found', async () => {
      mockQueryOne.mockResolvedValue(null);

      await expect(approveKBEntry(TEST_WORKSPACE_ID, 'nonexistent')).rejects.toThrow(
        'KB entry nonexistent not found'
      );
    });

    it('should log info after approval', async () => {
      mockQueryOne.mockResolvedValue(makeRawRow({ approved: false }));
      mockExecute.mockResolvedValue(undefined);

      await approveKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(logger.info).toHaveBeenCalledWith('KB entry approved', { entryId: 'entry-1' });
    });

    it('should return entry with all deserialized fields plus approved=true', async () => {
      const rawRow = makeRawRow({
        approved: false,
        tags: '["a","b"]',
        access_scope: '["agent-x"]',
      });
      mockQueryOne.mockResolvedValue(rawRow);
      mockExecute.mockResolvedValue(undefined);

      const result = await approveKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(result.approved).toBe(true);
      expect(result.tags).toEqual(['a', 'b']);
      expect(result.access_scope).toEqual(['agent-x']);
    });
  });

  // ────────────────────────────────────────────
  // getKBEntry
  // ────────────────────────────────────────────
  describe('getKBEntry', () => {
    it('should return deserialized entry when found', async () => {
      mockQueryOne.mockResolvedValue(makeRawRow());

      const entry = await getKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(entry).not.toBeNull();
      expect(entry!.id).toBe('entry-1');
      expect(entry!.tags).toEqual(['tag1', 'tag2']);
      expect(entry!.access_scope).toBe('all');
      expect(entry!.kb_source_id).toBeNull();
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT * FROM kb_entries WHERE id = $1 AND workspace_id = $2',
        ['entry-1', TEST_WORKSPACE_ID]
      );
    });

    it('should return null when not found', async () => {
      mockQueryOne.mockResolvedValue(null);

      const entry = await getKBEntry(TEST_WORKSPACE_ID, 'nonexistent');

      expect(entry).toBeNull();
    });

    it('should return null when queryOne returns undefined', async () => {
      mockQueryOne.mockResolvedValue(undefined);

      const entry = await getKBEntry(TEST_WORKSPACE_ID, 'missing');

      expect(entry).toBeNull();
    });

    it('should deserialize tags from JSON string', async () => {
      mockQueryOne.mockResolvedValue(makeRawRow({ tags: '["x","y","z"]' }));

      const entry = await getKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(entry!.tags).toEqual(['x', 'y', 'z']);
    });

    it('should deserialize access_scope as array from JSON string', async () => {
      mockQueryOne.mockResolvedValue(makeRawRow({ access_scope: '["agent-a","agent-b"]' }));

      const entry = await getKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(entry!.access_scope).toEqual(['agent-a', 'agent-b']);
    });

    it('should handle empty tags gracefully (fallback to [])', async () => {
      mockQueryOne.mockResolvedValue(makeRawRow({ tags: null }));

      const entry = await getKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(entry!.tags).toEqual([]);
    });

    it('should handle empty access_scope gracefully (fallback to "all")', async () => {
      mockQueryOne.mockResolvedValue(makeRawRow({ access_scope: null }));

      const entry = await getKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(entry!.access_scope).toBe('all');
    });

    it('should preserve kb_source_id when present', async () => {
      mockQueryOne.mockResolvedValue(makeRawRow({ kb_source_id: 'src-42' }));

      const entry = await getKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      expect(entry!.kb_source_id).toBe('src-42');
    });
  });

  // ────────────────────────────────────────────
  // listKBEntries
  // ────────────────────────────────────────────
  describe('listKBEntries', () => {
    it('should return approved entries with default limit', async () => {
      const rows = [makeRawRow({ id: 'e1' }), makeRawRow({ id: 'e2' })];
      mockQuery.mockResolvedValue(rows);

      const entries = await listKBEntries(TEST_WORKSPACE_ID);

      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('e1');
      expect(entries[1].id).toBe('e2');
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM kb_entries WHERE approved = TRUE AND workspace_id = $1 ORDER BY created_at DESC LIMIT $2',
        [TEST_WORKSPACE_ID, 50]
      );
    });

    it('should respect custom limit', async () => {
      mockQuery.mockResolvedValue([]);

      await listKBEntries(TEST_WORKSPACE_ID, 10);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        [TEST_WORKSPACE_ID, 10]
      );
    });

    it('should deserialize all returned rows', async () => {
      const rows = [
        makeRawRow({ id: 'e1', tags: '["a"]' }),
        makeRawRow({ id: 'e2', tags: '["b","c"]' }),
      ];
      mockQuery.mockResolvedValue(rows);

      const entries = await listKBEntries(TEST_WORKSPACE_ID);

      expect(entries[0].tags).toEqual(['a']);
      expect(entries[1].tags).toEqual(['b', 'c']);
    });

    it('should return empty array when no entries exist', async () => {
      mockQuery.mockResolvedValue([]);

      const entries = await listKBEntries(TEST_WORKSPACE_ID);

      expect(entries).toEqual([]);
    });
  });

  // ────────────────────────────────────────────
  // listPendingEntries
  // ────────────────────────────────────────────
  describe('listPendingEntries', () => {
    it('should return unapproved entries', async () => {
      const rows = [makeRawRow({ id: 'p1', approved: false }), makeRawRow({ id: 'p2', approved: false })];
      mockQuery.mockResolvedValue(rows);

      const entries = await listPendingEntries(TEST_WORKSPACE_ID);

      expect(entries).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM kb_entries WHERE approved = FALSE AND workspace_id = $1 ORDER BY created_at DESC',
        [TEST_WORKSPACE_ID]
      );
    });

    it('should return empty array when no pending entries', async () => {
      mockQuery.mockResolvedValue([]);

      const entries = await listPendingEntries(TEST_WORKSPACE_ID);

      expect(entries).toEqual([]);
    });

    it('should deserialize returned rows', async () => {
      mockQuery.mockResolvedValue([makeRawRow({ tags: '["pending"]' })]);

      const entries = await listPendingEntries(TEST_WORKSPACE_ID);

      expect(entries[0].tags).toEqual(['pending']);
    });
  });

  // ────────────────────────────────────────────
  // deleteKBEntry
  // ────────────────────────────────────────────
  describe('deleteKBEntry', () => {
    it('should delete chunks first, then the entry', async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteKBEntry(TEST_WORKSPACE_ID, 'entry-1');

      // The two DELETEs + one wiki archive UPDATE (fire-and-forget) all
      // hit execute() after plan-016. Assert both DELETEs ran.
      const sqls = mockExecute.mock.calls.map((c: any[]) => c[0]);
      expect(sqls).toContain('DELETE FROM kb_chunks WHERE entry_id = $1 AND entry_id IN (SELECT id FROM kb_entries WHERE workspace_id = $2)');
      expect(sqls).toContain('DELETE FROM kb_entries WHERE id = $1 AND workspace_id = $2');
    });

    it('should log info after deletion', async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteKBEntry(TEST_WORKSPACE_ID, 'entry-42');

      expect(logger.info).toHaveBeenCalledWith('KB entry deleted', { entryId: 'entry-42' });
    });

    it('should propagate errors from chunk deletion', async () => {
      mockExecute.mockRejectedValueOnce(new Error('FK error'));

      await expect(deleteKBEntry('entry-1')).rejects.toThrow('FK error');
    });

    it('should propagate errors from entry deletion', async () => {
      mockExecute
        .mockResolvedValueOnce(undefined) // chunks deleted ok
        .mockRejectedValueOnce(new Error('Entry delete failed'));

      await expect(deleteKBEntry('entry-1')).rejects.toThrow('Entry delete failed');
    });
  });

  // ────────────────────────────────────────────
  // searchKB
  // ────────────────────────────────────────────
  describe('searchKB', () => {
    it('should perform FTS search and return matching entries', async () => {
      const chunkRows = [
        { entry_id: 'e1', content: 'chunk text', rank: 0.8 },
        { entry_id: 'e2', content: 'another chunk', rank: 0.5 },
      ];
      mockQuery.mockResolvedValueOnce(chunkRows); // FTS query
      // getKBEntry calls for each unique entry_id
      mockQueryOne
        .mockResolvedValueOnce(makeRawRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeRawRow({ id: 'e2' }));

      const results = await searchKB(TEST_WORKSPACE_ID, 'test query words');

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('e1');
      expect(results[1].id).toBe('e2');
    });

    it('should build FTS query from words longer than 2 chars joined by |', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await searchKB(TEST_WORKSPACE_ID, 'hello my world');

      const ftsCall = mockQuery.mock.calls[0];
      // "my" is excluded (length <= 2), "hello" and "world" remain
      expect(ftsCall[1][0]).toBe('hello | world');
    });

    it('should strip special characters from query', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await searchKB(TEST_WORKSPACE_ID, 'hello! world? foo@bar');

      const ftsCall = mockQuery.mock.calls[0];
      expect(ftsCall[1][0]).toBe('hello | world | foo | bar');
    });

    it('should return empty array for empty/short query', async () => {
      const results = await searchKB(TEST_WORKSPACE_ID, 'hi');

      expect(results).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return empty array for query with only special characters', async () => {
      const results = await searchKB(TEST_WORKSPACE_ID, '!@#$%');

      expect(results).toEqual([]);
    });

    it('should deduplicate entries by entry_id', async () => {
      const chunkRows = [
        { entry_id: 'e1', content: 'chunk a', rank: 0.9 },
        { entry_id: 'e1', content: 'chunk b', rank: 0.7 }, // same entry
        { entry_id: 'e2', content: 'chunk c', rank: 0.5 },
      ];
      mockQuery.mockResolvedValueOnce(chunkRows);
      mockQueryOne
        .mockResolvedValueOnce(makeRawRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeRawRow({ id: 'e2' }));

      const results = await searchKB(TEST_WORKSPACE_ID, 'some query text');

      expect(results).toHaveLength(2);
      // getKBEntry called only twice (deduplicated)
      expect(mockQueryOne).toHaveBeenCalledTimes(2);
    });

    it('should skip unapproved entries', async () => {
      mockQuery.mockResolvedValueOnce([{ entry_id: 'e1', content: 'c', rank: 1 }]);
      mockQueryOne.mockResolvedValueOnce(makeRawRow({ id: 'e1', approved: false }));

      const results = await searchKB(TEST_WORKSPACE_ID, 'test query words');

      expect(results).toHaveLength(0);
    });

    it('should skip entries not found (null)', async () => {
      mockQuery.mockResolvedValueOnce([{ entry_id: 'e1', content: 'c', rank: 1 }]);
      mockQueryOne.mockResolvedValueOnce(null);

      const results = await searchKB(TEST_WORKSPACE_ID, 'test query words');

      expect(results).toHaveLength(0);
    });

    it('should filter by access_scope when agentId provided', async () => {
      mockQuery.mockResolvedValueOnce([
        { entry_id: 'e1', content: 'c', rank: 0.9 },
        { entry_id: 'e2', content: 'c', rank: 0.8 },
      ]);
      // e1 scoped to agent-x only, e2 is accessible to 'all'
      mockQueryOne
        .mockResolvedValueOnce(makeRawRow({ id: 'e1', access_scope: '["agent-x"]' }))
        .mockResolvedValueOnce(makeRawRow({ id: 'e2', access_scope: '"all"' }));

      const results = await searchKB(TEST_WORKSPACE_ID, 'test query words', 'agent-y');

      // e1 is scoped to agent-x, and we're searching as agent-y → excluded
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('e2');
    });

    it('should include entry when agentId is in access_scope', async () => {
      mockQuery.mockResolvedValueOnce([
        { entry_id: 'e1', content: 'c', rank: 0.9 },
      ]);
      mockQueryOne.mockResolvedValueOnce(
        makeRawRow({ id: 'e1', access_scope: '["agent-a","agent-b"]' })
      );

      const results = await searchKB(TEST_WORKSPACE_ID, 'test query words', 'agent-b');

      expect(results).toHaveLength(1);
    });

    it('should include all entries when no agentId provided (no scope filter)', async () => {
      mockQuery.mockResolvedValueOnce([
        { entry_id: 'e1', content: 'c', rank: 0.9 },
      ]);
      mockQueryOne.mockResolvedValueOnce(
        makeRawRow({ id: 'e1', access_scope: '["agent-x"]' })
      );

      const results = await searchKB(TEST_WORKSPACE_ID, 'test query words');

      // No agentId → scope check skipped
      expect(results).toHaveLength(1);
    });

    it('should fallback to LIKE search when FTS throws', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('FTS syntax error')) // FTS fails
        .mockResolvedValueOnce([makeRawRow({ id: 'e1' })]); // LIKE fallback

      const results = await searchKB(TEST_WORKSPACE_ID, 'test query words');

      expect(results).toHaveLength(1);
      const fallbackCall = mockQuery.mock.calls[1];
      expect(fallbackCall[0]).toContain('LIKE');
      expect(fallbackCall[1][0]).toBe(TEST_WORKSPACE_ID);
      expect(fallbackCall[1][1]).toBe('%test query words%');
    });

    it('should truncate LIKE query to 50 chars in fallback', async () => {
      const longQuery = 'a'.repeat(100);
      mockQuery
        .mockRejectedValueOnce(new Error('FTS error'))
        .mockResolvedValueOnce([]);

      await searchKB(TEST_WORKSPACE_ID, longQuery);

      const fallbackCall = mockQuery.mock.calls[1];
      expect(fallbackCall[1][0]).toBe(TEST_WORKSPACE_ID);
      expect(fallbackCall[1][1]).toBe(`%${'a'.repeat(50)}%`);
    });

    it('should limit FTS query terms to 10 words', async () => {
      const manyWords = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
      mockQuery.mockResolvedValueOnce([]);

      await searchKB(TEST_WORKSPACE_ID, manyWords);

      const ftsQuery = mockQuery.mock.calls[0][1][0]; // first param is ftsQuery
      const terms = ftsQuery.split(' | ');
      expect(terms).toHaveLength(10);
    });

    it('should deserialize entries in LIKE fallback', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('FTS error'))
        .mockResolvedValueOnce([makeRawRow({ tags: '["fallback"]' })]);

      const results = await searchKB(TEST_WORKSPACE_ID, 'test query words');

      expect(results[0].tags).toEqual(['fallback']);
    });
  });

  // ────────────────────────────────────────────
  // getCategories
  // ────────────────────────────────────────────
  describe('getCategories', () => {
    it('should return distinct categories from approved entries', async () => {
      mockQuery.mockResolvedValue([
        { category: 'billing' },
        { category: 'engineering' },
        { category: 'support' },
      ]);

      const categories = await getCategories(TEST_WORKSPACE_ID);

      expect(categories).toEqual(['billing', 'engineering', 'support']);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT DISTINCT category FROM kb_entries WHERE approved = TRUE AND workspace_id = $1 ORDER BY category',
        [TEST_WORKSPACE_ID]
      );
    });

    it('should return empty array when no categories exist', async () => {
      mockQuery.mockResolvedValue([]);

      const categories = await getCategories(TEST_WORKSPACE_ID);

      expect(categories).toEqual([]);
    });
  });
});
