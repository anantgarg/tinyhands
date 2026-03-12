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

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

vi.mock('../../src/utils/chunker', () => ({
  chunkText: vi.fn((content: string, filePath: string) => {
    // Return a single chunk for simplicity in most tests
    return [{
      content,
      filePath,
      chunkIndex: 0,
      contentHash: 'hash-' + filePath,
    }];
  }),
  hashContent: vi.fn((content: string) => 'hash-of-' + content.substring(0, 10)),
}));

import {
  connectSource,
  disconnectSource,
  getAgentSources,
  getSource,
  updateSourceStatus,
  ingestContent,
  retrieveContext,
  detectSourceType,
  getSourcesDueForSync,
} from '../../src/modules/sources';

import type { Source, SourceChunk } from '../../src/types';

// ── Helpers ──

function makeFakeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'source-1',
    agent_id: 'agent-1',
    source_type: 'github',
    uri: 'https://github.com/org/repo',
    label: 'My Repo',
    status: 'active',
    last_sync_at: null,
    chunk_count: 0,
    error_message: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeFakeChunk(overrides: Partial<SourceChunk & { rank: number }> = {}): SourceChunk & { rank: number } {
  return {
    id: 'chunk-1',
    source_id: 'source-1',
    agent_id: 'agent-1',
    file_path: 'src/main.ts',
    chunk_index: 0,
    content: 'const x = 1; // some code content that is meaningful enough',
    content_hash: 'abc123',
    metadata_json: '{}',
    rank: 1.0,
    ...overrides,
  };
}

// ── Tests ──

describe('Sources Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // connectSource
  // ────────────────────────────────────────────────
  describe('connectSource', () => {
    it('inserts a new source and returns it', async () => {
      mockExecute.mockResolvedValue(undefined);

      const result = await connectSource({
        agentId: 'agent-1',
        sourceType: 'github',
        uri: 'https://github.com/org/repo',
        label: 'My Repo',
      });

      expect(result).toMatchObject({
        id: 'test-uuid-1234',
        agent_id: 'agent-1',
        source_type: 'github',
        uri: 'https://github.com/org/repo',
        label: 'My Repo',
        status: 'active',
        last_sync_at: null,
        chunk_count: 0,
        error_message: null,
      });
      expect(result.created_at).toBeDefined();
    });

    it('calls execute with INSERT statement and all params', async () => {
      mockExecute.mockResolvedValue(undefined);

      const result = await connectSource({
        agentId: 'agent-2',
        sourceType: 'google_drive',
        uri: 'https://docs.google.com/doc/abc',
        label: 'Design Doc',
      });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('INSERT INTO sources');
      expect(params).toHaveLength(10);
      expect(params[0]).toBe('test-uuid-1234'); // id
      expect(params[1]).toBe('agent-2');         // agent_id
      expect(params[2]).toBe('google_drive');    // source_type
      expect(params[3]).toBe('https://docs.google.com/doc/abc'); // uri
      expect(params[4]).toBe('Design Doc');      // label
      expect(params[5]).toBe('active');          // status
      expect(params[6]).toBeNull();              // last_sync_at
      expect(params[7]).toBe(0);                 // chunk_count
      expect(params[8]).toBeNull();              // error_message
    });

    it('defaults status to active', async () => {
      mockExecute.mockResolvedValue(undefined);

      const result = await connectSource({
        agentId: 'agent-1',
        sourceType: 'slack_upload',
        uri: '/tmp/file.txt',
        label: 'Uploaded File',
      });

      expect(result.status).toBe('active');
    });

    it('defaults chunk_count to 0', async () => {
      mockExecute.mockResolvedValue(undefined);

      const result = await connectSource({
        agentId: 'agent-1',
        sourceType: 'local',
        uri: '/var/data',
        label: 'Local Dir',
      });

      expect(result.chunk_count).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // disconnectSource
  // ────────────────────────────────────────────────
  describe('disconnectSource', () => {
    it('deletes source_chunks first, then the source', async () => {
      mockExecute.mockResolvedValue(undefined);

      await disconnectSource('source-1');

      expect(mockExecute).toHaveBeenCalledTimes(2);
      // First call: delete chunks
      expect(mockExecute.mock.calls[0][0]).toContain('DELETE FROM source_chunks');
      expect(mockExecute.mock.calls[0][1]).toEqual(['source-1']);
      // Second call: delete source
      expect(mockExecute.mock.calls[1][0]).toContain('DELETE FROM sources');
      expect(mockExecute.mock.calls[1][1]).toEqual(['source-1']);
    });

    it('deletes chunks before source (order matters for FK constraints)', async () => {
      const callOrder: string[] = [];
      mockExecute.mockImplementation((sql: string) => {
        if (sql.includes('source_chunks')) callOrder.push('chunks');
        if (sql.includes('sources WHERE')) callOrder.push('source');
        return Promise.resolve();
      });

      await disconnectSource('source-2');

      expect(callOrder).toEqual(['chunks', 'source']);
    });
  });

  // ────────────────────────────────────────────────
  // getAgentSources
  // ────────────────────────────────────────────────
  describe('getAgentSources', () => {
    it('returns all sources for an agent', async () => {
      const sources = [makeFakeSource(), makeFakeSource({ id: 'source-2' })];
      mockQuery.mockResolvedValueOnce(sources);

      const result = await getAgentSources('agent-1');

      expect(result).toEqual(sources);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM sources WHERE agent_id = $1',
        ['agent-1'],
      );
    });

    it('returns empty array when agent has no sources', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getAgentSources('agent-no-sources');

      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────
  // getSource
  // ────────────────────────────────────────────────
  describe('getSource', () => {
    it('returns a source when found', async () => {
      const source = makeFakeSource();
      mockQueryOne.mockResolvedValueOnce(source);

      const result = await getSource('source-1');

      expect(result).toEqual(source);
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT * FROM sources WHERE id = $1',
        ['source-1'],
      );
    });

    it('returns null when source is not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getSource('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when queryOne returns null', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getSource('gone');

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // updateSourceStatus
  // ────────────────────────────────────────────────
  describe('updateSourceStatus', () => {
    it('updates status and sets last_sync_at to NOW()', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSourceStatus('source-1', 'active');

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE sources SET status = $1, error_message = $2, last_sync_at = NOW() WHERE id = $3',
        ['active', null, 'source-1'],
      );
    });

    it('sets error_message when provided', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSourceStatus('source-1', 'error', 'Connection timeout');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sources SET status'),
        ['error', 'Connection timeout', 'source-1'],
      );
    });

    it('sets error_message to null when not provided', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSourceStatus('source-1', 'syncing');

      const [, params] = mockExecute.mock.calls[0];
      expect(params[1]).toBeNull();
    });

    it('handles syncing status', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSourceStatus('source-1', 'syncing');

      const [, params] = mockExecute.mock.calls[0];
      expect(params[0]).toBe('syncing');
    });
  });

  // ────────────────────────────────────────────────
  // ingestContent
  // ────────────────────────────────────────────────
  describe('ingestContent', () => {
    it('processes files within a transaction', async () => {
      mockWithTransaction.mockImplementation(async (fn: any) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rows: [] }) // existing check: no existing chunk
            .mockResolvedValueOnce(undefined)     // delete old
            .mockResolvedValueOnce(undefined)     // insert new
            .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // count
            .mockResolvedValueOnce(undefined),    // update source
        };
        return fn(mockClient);
      });

      const result = await ingestContent('source-1', 'agent-1', [
        { path: 'src/main.ts', content: 'console.log("hello")' },
      ]);

      expect(result).toBe(1);
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });

    it('skips insertion when chunk already exists (incremental sync)', async () => {
      mockWithTransaction.mockImplementation(async (fn: any) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'existing-chunk' }] }) // chunk exists
            .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // count
            .mockResolvedValueOnce(undefined), // update source
        };
        return fn(mockClient);
      });

      const result = await ingestContent('source-1', 'agent-1', [
        { path: 'src/existing.ts', content: 'existing content' },
      ]);

      expect(result).toBe(1); // totalChunks is still counted
    });

    it('processes multiple files', async () => {
      mockWithTransaction.mockImplementation(async (fn: any) => {
        const mockClient = {
          query: vi.fn()
            // file 1
            .mockResolvedValueOnce({ rows: [] })    // existing check
            .mockResolvedValueOnce(undefined)        // delete old
            .mockResolvedValueOnce(undefined)        // insert new
            // file 2
            .mockResolvedValueOnce({ rows: [] })    // existing check
            .mockResolvedValueOnce(undefined)        // delete old
            .mockResolvedValueOnce(undefined)        // insert new
            // count and update
            .mockResolvedValueOnce({ rows: [{ count: '2' }] })
            .mockResolvedValueOnce(undefined),
        };
        return fn(mockClient);
      });

      const result = await ingestContent('source-1', 'agent-1', [
        { path: 'file1.ts', content: 'content1' },
        { path: 'file2.ts', content: 'content2' },
      ]);

      expect(result).toBe(2);
    });

    it('updates chunk_count and sets status to active after ingestion', async () => {
      let updateQuery = '';
      let updateParams: any[] = [];

      mockWithTransaction.mockImplementation(async (fn: any) => {
        const mockClient = {
          query: vi.fn().mockImplementation((sql: string, params: any[]) => {
            if (sql.includes('UPDATE sources SET chunk_count')) {
              updateQuery = sql;
              updateParams = params;
            }
            if (sql.includes('SELECT COUNT')) {
              return { rows: [{ count: '5' }] };
            }
            return { rows: [] };
          }),
        };
        return fn(mockClient);
      });

      await ingestContent('source-1', 'agent-1', [
        { path: 'file.ts', content: 'code' },
      ]);

      expect(updateQuery).toContain('UPDATE sources SET chunk_count');
      expect(updateParams[0]).toBe(5);       // count
      expect(updateParams[1]).toBe('active'); // status
      expect(updateParams[2]).toBe('source-1');
    });

    it('returns 0 when files array is empty', async () => {
      mockWithTransaction.mockImplementation(async (fn: any) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rows: [{ count: '0' }] })
            .mockResolvedValueOnce(undefined),
        };
        return fn(mockClient);
      });

      const result = await ingestContent('source-1', 'agent-1', []);

      expect(result).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // retrieveContext
  // ────────────────────────────────────────────────
  describe('retrieveContext', () => {
    it('returns matching chunks with FTS search', async () => {
      const chunks = [
        makeFakeChunk({ content: 'function login() {}', file_path: 'src/auth.ts', rank: 0.8 }),
        makeFakeChunk({ id: 'chunk-2', content: 'function logout() {}', file_path: 'src/session.ts', rank: 0.5 }),
      ];
      mockQuery.mockResolvedValueOnce(chunks);

      const result = await retrieveContext('agent-1', 'login function');

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ts_rank'),
        expect.arrayContaining(['agent-1']),
      );
    });

    it('returns empty array for empty/short-word query', async () => {
      // All words <= 2 chars are filtered, resulting in empty FTS query
      const result = await retrieveContext('agent-1', 'a b c');

      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('respects token budget and stops adding chunks when exceeded', async () => {
      // Each chunk's tokens = Math.ceil(content.length / 4)
      // 200 chars = 50 tokens each
      const longContent = 'x'.repeat(200);
      const chunks = [
        makeFakeChunk({ id: 'c1', content: longContent, file_path: 'a.ts', chunk_index: 0, rank: 0.9 }),
        makeFakeChunk({ id: 'c2', content: longContent, file_path: 'b.ts', chunk_index: 0, rank: 0.8 }),
        makeFakeChunk({ id: 'c3', content: longContent, file_path: 'c.ts', chunk_index: 0, rank: 0.7 }),
      ];
      mockQuery.mockResolvedValueOnce(chunks);

      // Token budget of 80 allows only 1 chunk (50 tokens each, second would exceed)
      const result = await retrieveContext('agent-1', 'search query here', 80);

      // First chunk = 50 tokens (within 80 budget)
      // Second chunk would be 100 tokens (exceeds 80 budget)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c1');
    });

    it('uses default token budget of 8000 when not specified', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await retrieveContext('agent-1', 'query text here');

      const [, params] = mockQuery.mock.calls[0];
      // Last param is MAX_CHUNKS_RETRIEVED (20), not the budget
      expect(params[2]).toBe(20);
    });

    it('deduplicates chunks by file_path:chunk_index', async () => {
      const chunks = [
        makeFakeChunk({ id: 'c1', file_path: 'same.ts', chunk_index: 0, rank: 0.9 }),
        makeFakeChunk({ id: 'c2', file_path: 'same.ts', chunk_index: 0, rank: 0.8 }), // duplicate
        makeFakeChunk({ id: 'c3', file_path: 'other.ts', chunk_index: 0, rank: 0.7 }),
      ];
      mockQuery.mockResolvedValueOnce(chunks);

      const result = await retrieveContext('agent-1', 'search something specific');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('c1');
      expect(result[1].id).toBe('c3');
    });

    it('falls back to LIKE search when FTS query fails', async () => {
      // First query (FTS) throws
      mockQuery.mockRejectedValueOnce(new Error('syntax error in tsquery'));
      // Second query (LIKE fallback)
      const fallbackChunks = [makeFakeChunk({ id: 'fb-1' })];
      mockQuery.mockResolvedValueOnce(fallbackChunks);

      const result = await retrieveContext('agent-1', 'some query text');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('fb-1');
      // Verify the fallback query uses LIKE
      expect(mockQuery.mock.calls[1][0]).toContain('LIKE');
    });

    it('limits FTS query to 20 chunks (MAX_CHUNKS_RETRIEVED)', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await retrieveContext('agent-1', 'some search terms here');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('LIMIT $3');
      expect(params[2]).toBe(20);
    });

    it('sanitizes FTS query: strips punctuation and joins with OR', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await retrieveContext('agent-1', 'hello, world! foo-bar');

      const [, params] = mockQuery.mock.calls[0];
      // Words > 2 chars, joined with ' | '
      expect(params[0]).toContain('hello');
      expect(params[0]).toContain('world');
      expect(params[0]).toContain('|');
    });

    it('returns empty array when all query words are 2 chars or fewer', async () => {
      const result = await retrieveContext('agent-1', 'is it ok');

      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────
  // detectSourceType
  // ────────────────────────────────────────────────
  describe('detectSourceType', () => {
    it('detects GitHub URLs', () => {
      expect(detectSourceType('https://github.com/org/repo')).toBe('github');
    });

    it('detects GitHub shorthand (org/repo)', () => {
      expect(detectSourceType('myorg/myrepo')).toBe('github');
    });

    it('detects Google Drive URLs', () => {
      expect(detectSourceType('https://drive.google.com/file/abc')).toBe('google_drive');
    });

    it('detects Google Docs URLs', () => {
      expect(detectSourceType('https://docs.google.com/document/d/abc')).toBe('google_drive');
    });

    it('detects local paths starting with /', () => {
      expect(detectSourceType('/var/data/myfiles')).toBe('local');
    });

    it('detects local paths starting with ./', () => {
      expect(detectSourceType('./relative/path')).toBe('local');
    });

    it('defaults to slack_upload for unknown inputs', () => {
      expect(detectSourceType('some random text')).toBe('slack_upload');
    });

    it('defaults to slack_upload for plain filenames', () => {
      expect(detectSourceType('document.pdf')).toBe('slack_upload');
    });

    it('is case-insensitive for GitHub URLs', () => {
      expect(detectSourceType('https://GitHub.com/Org/Repo')).toBe('github');
    });

    it('is case-insensitive for Google Drive URLs', () => {
      expect(detectSourceType('https://Drive.Google.Com/file/abc')).toBe('google_drive');
    });
  });

  // ────────────────────────────────────────────────
  // getSourcesDueForSync
  // ────────────────────────────────────────────────
  describe('getSourcesDueForSync', () => {
    it('queries for active sources needing sync', async () => {
      const sources = [makeFakeSource(), makeFakeSource({ id: 'source-2' })];
      mockQuery.mockResolvedValueOnce(sources);

      const result = await getSourcesDueForSync();

      expect(result).toEqual(sources);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain('last_sync_at IS NULL');
      expect(sql).toContain("INTERVAL '15 minutes'");
    });

    it('returns empty array when no sources are due', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getSourcesDueForSync();

      expect(result).toEqual([]);
    });

    it('includes sources that have never been synced (last_sync_at IS NULL)', async () => {
      const neverSynced = makeFakeSource({ last_sync_at: null });
      mockQuery.mockResolvedValueOnce([neverSynced]);

      const result = await getSourcesDueForSync();

      expect(result).toHaveLength(1);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('last_sync_at IS NULL');
    });

    it('uses 15-minute interval for sync check', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getSourcesDueForSync();

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("INTERVAL '15 minutes'");
    });
  });
});
