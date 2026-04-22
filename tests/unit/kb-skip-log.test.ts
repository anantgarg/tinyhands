import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  execute: (...a: any[]) => mockExecute(...a),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));

import {
  recordSkippedFile,
  clearSkippedFile,
  listSkippedFiles,
  countSkippedFiles,
  SKIP_REASON_LABELS,
} from '../../src/modules/kb-sources/skip-log';

describe('recordSkippedFile', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('upserts by (kb_source_id, file_path) — repeated skips do not create duplicates', async () => {
    await recordSkippedFile({
      workspaceId: 'W1',
      kbSourceId: 'S1',
      filePath: 'drive://123',
      filename: 'big.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 300 * 1024 * 1024,
      reason: 'too_large',
      message: 'file is 300 MB, larger than the 250 MB per-file cap',
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, vals] = mockExecute.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (kb_source_id, file_path)');
    expect(sql).toContain('DO UPDATE');
    expect(sql).toContain('last_seen_at = NOW()');
    expect(vals).toEqual([
      'fixed-uuid', 'W1', 'S1', 'drive://123', 'big.pdf',
      'application/pdf', 300 * 1024 * 1024, 'too_large',
      'file is 300 MB, larger than the 250 MB per-file cap',
    ]);
  });

  it('swallows DB errors — never aborts the sync if the skip log fails to persist', async () => {
    mockExecute.mockRejectedValueOnce(new Error('db down'));
    await expect(recordSkippedFile({
      workspaceId: 'W1', kbSourceId: 'S1', filePath: 'x', filename: 'x',
      reason: 'parser_failed', message: 'oops',
    })).resolves.toBeUndefined();
  });

  it('truncates long messages so one bad parser does not bloat the log row', async () => {
    const longMsg = 'x'.repeat(2000);
    await recordSkippedFile({
      workspaceId: 'W1', kbSourceId: 'S1', filePath: 'a', filename: 'a',
      reason: 'parser_failed', message: longMsg,
    });
    const stored = mockExecute.mock.calls[0][1][8] as string;
    expect(stored.length).toBeLessThanOrEqual(500);
  });
});

describe('clearSkippedFile', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes the row by (workspace, source, path) so the log reflects current state', async () => {
    await clearSkippedFile('W1', 'S1', 'drive://123');
    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM kb_source_skip_log WHERE workspace_id = $1 AND kb_source_id = $2 AND file_path = $3',
      ['W1', 'S1', 'drive://123'],
    );
  });

  it('swallows errors — clearing is best-effort', async () => {
    mockExecute.mockRejectedValueOnce(new Error('db down'));
    await expect(clearSkippedFile('W1', 'S1', 'x')).resolves.toBeUndefined();
  });
});

describe('listSkippedFiles', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns the skip log entries most recent first', async () => {
    mockQuery.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const rows = await listSkippedFiles('W1', 'S1');
    expect(rows.length).toBe(2);
    const [sql, vals] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY last_seen_at DESC');
    expect(sql).toContain('LIMIT 1000');
    expect(vals).toEqual(['W1', 'S1']);
  });
});

describe('countSkippedFiles', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 0 when the skip log is empty', async () => {
    mockQueryOne.mockResolvedValue({ count: '0' });
    expect(await countSkippedFiles('W1', 'S1')).toBe(0);
  });

  it('coerces the bigint string count to a number', async () => {
    mockQueryOne.mockResolvedValue({ count: '42' });
    expect(await countSkippedFiles('W1', 'S1')).toBe(42);
  });
});

describe('SKIP_REASON_LABELS', () => {
  it('uses plain English (no jargon, no raw error strings) — dashboard UX rule', () => {
    expect(SKIP_REASON_LABELS.too_large).toBe('File too large to index');
    expect(SKIP_REASON_LABELS.reducto_failed).toBe('Advanced parsing failed');
    // No internal identifiers leak — none of the labels contain an underscore.
    for (const label of Object.values(SKIP_REASON_LABELS)) {
      expect(label).not.toMatch(/_/);
    }
  });
});
