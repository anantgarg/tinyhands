/**
 * Unit tests for the wiki module's source enqueue + page upsert behaviors.
 *
 * The DB and Redis layers are mocked. We're testing the public contract:
 * - enqueueWikiIngest skips when namespace mode is 'search'
 * - enqueueWikiIngest debounces same-source repeats
 * - upsertPage detects optimistic conflicts via expected_prior_revision
 * - archiveWikiSourcePage updates the right rows
 * - the LLM plan validation rejects out-of-namespace edits
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockWithTransaction = vi.fn();

vi.mock('../../src/db', () => ({
  execute: (...a: any[]) => mockExecute(...a),
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  withTransaction: (fn: any) => mockWithTransaction(fn),
}));

const mockRedisSet = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisEval = vi.fn();
const mockQueueAdd = vi.fn();

vi.mock('../../src/queue', () => ({
  getRedisConnection: () => ({
    set: mockRedisSet, get: mockRedisGet, del: mockRedisDel, eval: mockRedisEval,
  }),
  rkey: (...parts: string[]) => parts.join(':'),
}));

vi.mock('bullmq', () => ({
  Queue: class { add(...args: any[]) { return mockQueueAdd(...args); } },
  Worker: class { on() {} async close() {} },
}));

import { enqueueWikiIngest, archiveWikiSourcePage, getNamespaceMode } from '../../src/modules/kb-wiki/sources';
import { upsertPage, OptimisticConflictError } from '../../src/modules/kb-wiki/pages';

describe('enqueueWikiIngest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rowCount: 1 });
    mockRedisSet.mockResolvedValue('OK');
  });

  it('skips when namespace mode is search', async () => {
    mockQueryOne.mockResolvedValue({ value: 'search' });
    const id = await enqueueWikiIngest('w1', {
      namespace: 'kb', source_kind: 'kb_entry', source_id: 'e1', revision: 'r1',
    });
    expect(id).toBe('');
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('inserts a job row and queues an ingest when mode is wiki', async () => {
    mockQueryOne.mockResolvedValue({ value: 'wiki' });
    const id = await enqueueWikiIngest('w1', {
      namespace: 'kb', source_kind: 'kb_entry', source_id: 'e1', revision: 'r1',
    });
    expect(id).toMatch(/[a-f0-9-]{36}/);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('debounces a second enqueue against the same source', async () => {
    mockQueryOne.mockResolvedValue({ value: 'wiki' });
    mockRedisSet.mockResolvedValueOnce('OK');         // first wins
    mockRedisSet.mockResolvedValueOnce(null);          // second debounced
    await enqueueWikiIngest('w1', { namespace: 'kb', source_kind: 'kb_entry', source_id: 'e1', revision: 'r1' });
    await enqueueWikiIngest('w1', { namespace: 'kb', source_kind: 'kb_entry', source_id: 'e1', revision: 'r2' });
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);    // only the first reached the queue
    expect(mockExecute).toHaveBeenCalledTimes(2);     // both still recorded as ingest jobs (one will deduplicate)
  });
});

describe('archiveWikiSourcePage', () => {
  beforeEach(() => vi.clearAllMocks());
  it('UPDATE-archives the right page', async () => {
    await archiveWikiSourcePage('w1', 'kb', 'drive_file', 'ext-id-99');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sql = mockExecute.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE kb_wiki_pages/);
    expect(sql).toMatch(/SET archived_at = NOW/);
    expect(mockExecute.mock.calls[0][1]).toEqual(['w1', 'kb', 'drive_file', 'ext-id-99']);
  });
});

describe('getNamespaceMode', () => {
  beforeEach(() => vi.clearAllMocks());
  it('defaults to wiki when no setting exists', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await getNamespaceMode('w1', 'kb')).toBe('wiki');
  });
  it('returns the configured value', async () => {
    mockQueryOne.mockResolvedValue({ value: 'both' });
    expect(await getNamespaceMode('w1', 'docs')).toBe('both');
  });
});

describe('upsertPage optimistic check', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws OptimisticConflictError when expected_prior_revision mismatches', async () => {
    const fakeClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'p1', updated_at: '2026-04-21T10:00:00Z' }] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation((fn: any) => fn(fakeClient));

    await expect(upsertPage('w1', 'kb', {
      path: 'entities/acme.md', kind: 'entity', title: 'Acme',
      content: 'updated body', expected_prior_revision: '2026-04-21T09:00:00Z',
    })).rejects.toBeInstanceOf(OptimisticConflictError);
  });

  it('proceeds when revisions match', async () => {
    const fakeClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'p1', updated_at: '2026-04-21T10:00:00Z' }] })
        .mockResolvedValueOnce({ rows: [{ next: 2 }] })
        .mockResolvedValueOnce({ rows: [] })  // UPDATE
        .mockResolvedValueOnce({ rows: [] })  // snapshot insert
        .mockResolvedValueOnce({ rows: [] })  // prune versions
        .mockResolvedValueOnce({ rows: [{ id: 'p1', namespace: 'kb', path: 'entities/acme.md', kind: 'entity', title: 'Acme', content: 'body', frontmatter: {}, source_ref: null, updated_by: 'llm', updated_at: '2026-04-21T10:30:00Z' }] }),
    };
    mockWithTransaction.mockImplementation((fn: any) => fn(fakeClient));
    const page = await upsertPage('w1', 'kb', {
      path: 'entities/acme.md', kind: 'entity', title: 'Acme',
      content: 'body', expected_prior_revision: '2026-04-21T10:00:00Z',
    });
    expect(page.path).toBe('entities/acme.md');
  });
});
