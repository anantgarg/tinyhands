import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  v4: () => 'doc-uuid-1234',
}));

vi.mock('../../src/modules/docs/convert', () => ({
  extractTextForSearch: vi.fn().mockReturnValue('extracted text'),
}));

vi.mock('../../src/modules/docs/storage', () => ({
  storeFile: vi.fn(),
  getFile: vi.fn(),
  deleteFile: vi.fn(),
}));

import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
  archiveDocument,
  deleteDocument,
  searchDocuments,
  listVersions,
} from '../../src/modules/docs';

const WS = 'W_TEST';

// ── Helpers ──

function makeDocRow(overrides: Record<string, any> = {}) {
  return {
    id: 'doc-1',
    workspace_id: WS,
    type: 'doc',
    title: 'Test Doc',
    description: null,
    content: '{"text":"hello"}',
    mime_type: null,
    file_size: null,
    tags: '["tag1"]',
    agent_id: null,
    run_id: null,
    created_by: 'U001',
    created_by_type: 'user',
    updated_by: null,
    agent_editable: true,
    version: 1,
    is_archived: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ──

describe('Docs Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rowCount: 1 });
  });

  // ── createDocument ──

  describe('createDocument', () => {
    it('creates a doc type document', async () => {
      const result = await createDocument(WS, {
        type: 'doc',
        title: 'My Doc',
        content: { text: 'hello' },
        createdBy: 'U001',
        createdByType: 'user',
        tags: ['draft'],
      });

      expect(result.id).toBe('doc-uuid-1234');
      expect(result.type).toBe('doc');
      expect(result.title).toBe('My Doc');
      expect(result.content).toEqual({ text: 'hello' });
      expect(result.tags).toEqual(['draft']);
      expect(result.version).toBe(1);
      expect(result.is_archived).toBe(false);

      // INSERT for document
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO documents'),
        expect.any(Array),
      );
      // Index for search (doc with content triggers indexing)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO document_search'),
        expect.any(Array),
      );
    });

    it('creates a sheet type document with default tab', async () => {
      // createSheetTab internally calls queryOne to verify doc, then query for max position
      mockQueryOne.mockResolvedValueOnce({ id: 'doc-uuid-1234', type: 'sheet' });
      mockQuery.mockResolvedValueOnce([{ max_pos: -1 }]);

      const result = await createDocument(WS, {
        type: 'sheet',
        title: 'My Sheet',
        createdBy: 'U001',
        createdByType: 'user',
      });

      expect(result.type).toBe('sheet');
      expect(result.content).toBeNull(); // sheets don't store content on doc

      // INSERT for document + INSERT for sheet_tabs (default tab)
      const insertCalls = mockExecute.mock.calls.filter(c => c[0].includes('INSERT'));
      expect(insertCalls.length).toBeGreaterThanOrEqual(2);
      expect(insertCalls.some(c => c[0].includes('sheet_tabs'))).toBe(true);
    });

    it('creates a file type document without content', async () => {
      const result = await createDocument(WS, {
        type: 'file',
        title: 'report.pdf',
        mimeType: 'application/pdf',
        createdBy: 'U001',
        createdByType: 'agent',
      });

      expect(result.type).toBe('file');
      expect(result.content).toBeNull();
      expect(result.mime_type).toBe('application/pdf');
      expect(result.created_by_type).toBe('agent');

      // No search indexing for file type without content
      const searchInserts = mockExecute.mock.calls.filter(c => c[0].includes('document_search'));
      expect(searchInserts).toHaveLength(0);
    });
  });

  // ── getDocument ──

  describe('getDocument', () => {
    it('returns parsed document when found', async () => {
      mockQueryOne.mockResolvedValueOnce(makeDocRow());

      const doc = await getDocument(WS, 'doc-1');

      expect(doc).not.toBeNull();
      expect(doc!.id).toBe('doc-1');
      // content should be parsed from JSON string
      expect(doc!.content).toEqual({ text: 'hello' });
      // tags should be parsed from JSON string
      expect(doc!.tags).toEqual(['tag1']);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM documents'),
        [WS, 'doc-1'],
      );
    });

    it('returns null when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const doc = await getDocument(WS, 'nonexistent');
      expect(doc).toBeNull();
    });
  });

  // ── listDocuments ──

  describe('listDocuments', () => {
    it('returns documents and total count', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 2 }])  // COUNT query
        .mockResolvedValueOnce([makeDocRow(), makeDocRow({ id: 'doc-2', title: 'Second' })]);

      const result = await listDocuments(WS);

      expect(result.total).toBe(2);
      expect(result.documents).toHaveLength(2);
      expect(result.documents[0].content).toEqual({ text: 'hello' }); // parsed
    });

    it('filters by type', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([makeDocRow({ type: 'sheet' })]);

      const result = await listDocuments(WS, { type: 'sheet' });

      expect(result.total).toBe(1);
      // Verify type filter was passed as parameter
      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain('d.type = $');
      expect(countCall[1]).toContain('sheet');
    });

    it('filters by search term', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([makeDocRow()]);

      await listDocuments(WS, { search: 'hello' });

      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain('ILIKE');
      expect(countCall[1]).toContain('%hello%');
    });
  });

  // ── updateDocument ──

  describe('updateDocument', () => {
    it('updates document and creates version snapshot on content change', async () => {
      // execute for UPDATE returns rowCount 1 (success)
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      // createVersionSnapshot: queryOne for content, then execute for INSERT, execute for prune
      mockQueryOne.mockResolvedValueOnce({ content: '{"old":"data"}' });
      mockExecute.mockResolvedValueOnce({ rowCount: 1 }); // version insert
      mockExecute.mockResolvedValueOnce({ rowCount: 0 }); // prune
      // indexDocumentContent: execute for search index
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      // getDocument after update
      mockQueryOne.mockResolvedValueOnce(makeDocRow({ version: 2, content: '{"new":"data"}' }));

      const doc = await updateDocument(WS, 'doc-1', {
        content: { new: 'data' },
        updatedBy: 'U001',
        expectedVersion: 1,
      });

      expect(doc.version).toBe(2);
      // UPDATE with version check
      expect(mockExecute.mock.calls[0][0]).toContain('UPDATE documents SET');
      expect(mockExecute.mock.calls[0][0]).toContain('version = $');
    });

    it('throws VERSION_CONFLICT when version does not match', async () => {
      // UPDATE returns 0 rows (version mismatch)
      mockExecute.mockResolvedValueOnce({ rowCount: 0 });
      // exists check returns a row (doc exists, so it's a version conflict not a 404)
      mockQueryOne.mockResolvedValueOnce({ id: 'doc-1' });

      await expect(
        updateDocument(WS, 'doc-1', {
          title: 'New Title',
          updatedBy: 'U001',
          expectedVersion: 5,
        })
      ).rejects.toThrow('VERSION_CONFLICT');
    });

    it('throws not found when document does not exist', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 0 });
      mockQueryOne.mockResolvedValueOnce(null); // does not exist

      await expect(
        updateDocument(WS, 'nonexistent', {
          title: 'New Title',
          updatedBy: 'U001',
          expectedVersion: 1,
        })
      ).rejects.toThrow('Document not found');
    });
  });

  // ── archiveDocument ──

  describe('archiveDocument', () => {
    it('sets is_archived to true', async () => {
      await archiveDocument(WS, 'doc-1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('is_archived = true'),
        [WS, 'doc-1'],
      );
    });
  });

  // ── deleteDocument ──

  describe('deleteDocument', () => {
    it('hard deletes the document', async () => {
      await deleteDocument(WS, 'doc-1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM documents'),
        [WS, 'doc-1'],
      );
    });
  });

  // ── searchDocuments ──

  describe('searchDocuments', () => {
    it('performs full-text search and returns parsed documents', async () => {
      mockQuery.mockResolvedValueOnce([makeDocRow(), makeDocRow({ id: 'doc-2' })]);

      const results = await searchDocuments(WS, 'hello world');

      expect(results).toHaveLength(2);
      expect(results[0].content).toEqual({ text: 'hello' }); // parsed
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('plainto_tsquery'),
        [WS, 'hello world', 20],
      );
    });

    it('uses custom limit', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await searchDocuments(WS, 'test', 5);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        [WS, 'test', 5],
      );
    });
  });

  // ── listVersions ──

  describe('listVersions', () => {
    it('returns version history for a document', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'doc-1' }); // doc exists check
      mockQuery.mockResolvedValueOnce([
        { document_id: 'doc-1', version: 2, changed_by: 'U001' },
        { document_id: 'doc-1', version: 1, changed_by: 'U001' },
      ]);

      const versions = await listVersions(WS, 'doc-1');

      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('document_versions'),
        ['doc-1'],
      );
    });

    it('throws when document not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(listVersions(WS, 'nonexistent')).rejects.toThrow('Document not found');
    });
  });
});
