/**
 * Unit tests for the parser module. Cover the local format-router decisions
 * and the Markdown rendering for native documents content / sheet tabs.
 *
 * Cloud parsers (Reducto / LlamaParse) are mocked via the api-key lookup —
 * we don't make real network calls. The router falls back to local when
 * cloud keys are absent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock kb-sources/getApiKey so the router thinks no cloud parser is set.
vi.mock('../../src/modules/kb-sources', () => ({
  getApiKey: vi.fn().mockResolvedValue(null),
}));

import { parseLocal, isTextLike, requiresCloudParser, renderDocContent, renderSheetTabs } from '../../src/modules/kb-parser/local';
import { parseSource } from '../../src/modules/kb-parser/router';

describe('isTextLike', () => {
  it('treats text/* MIME as text', () => {
    expect(isTextLike('.txt', 'text/plain')).toBe(true);
    expect(isTextLike('.html', 'text/html')).toBe(true);
  });
  it('handles common code/data extensions', () => {
    expect(isTextLike('.json', 'application/json')).toBe(true);
    expect(isTextLike('.py', '')).toBe(true);
    expect(isTextLike('.yaml', '')).toBe(true);
  });
  it('refuses binary formats', () => {
    expect(isTextLike('.pdf', 'application/pdf')).toBe(false);
    expect(isTextLike('.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
  });
});

describe('requiresCloudParser', () => {
  it('flags scanned image formats', () => {
    expect(requiresCloudParser('scan.tiff', 'image/tiff')).toBe(true);
    expect(requiresCloudParser('photo.heic', 'image/heic')).toBe(true);
  });
  it('flags legacy Office binaries we cannot parse locally', () => {
    expect(requiresCloudParser('old.doc', '')).toBe(true);
    expect(requiresCloudParser('old.ppt', '')).toBe(true);
  });
  it('does not flag PDFs (we attempt local pdf-parse first)', () => {
    expect(requiresCloudParser('foo.pdf', 'application/pdf')).toBe(false);
  });
});

describe('parseLocal', () => {
  it('parses plain text directly', async () => {
    const result = await parseLocal({
      filename: 'a.txt', mime: 'text/plain', bytes: Buffer.from('hello world'),
    });
    expect(result.markdown).toContain('hello world');
    expect(result.parser).toBe('local');
  });
  it('emits a Markdown table for CSV input', async () => {
    const result = await parseLocal({
      filename: 'a.csv', mime: 'text/csv',
      bytes: Buffer.from('Name,Score\nAlice,90\nBob,85'),
    });
    expect(result.markdown).toMatch(/\| Name \| Score \|/);
    expect(result.markdown).toMatch(/\| Alice \| 90 \|/);
    expect(result.tables).toHaveLength(1);
  });
  it('emits a placeholder for raw images when no cloud parser', async () => {
    const result = await parseLocal({
      filename: 'pic.png', mime: 'image/png', bytes: Buffer.from([1, 2, 3, 4]),
    });
    expect(result.metadata.format).toBe('placeholder');
    expect(result.markdown).toMatch(/unsupported|configure/i);
  });
  it('parses an .xlsx workbook into Markdown tables per sheet', async () => {
    // Build a minimal xlsx in memory so the test stays self-contained.
    const xlsx = await import('xlsx');
    const wb = (xlsx as any).utils.book_new();
    const ws1 = (xlsx as any).utils.aoa_to_sheet([['col1', 'col2'], [1, 2], [3, 4]]);
    (xlsx as any).utils.book_append_sheet(wb, ws1, 'Numbers');
    const ws2 = (xlsx as any).utils.aoa_to_sheet([['name'], ['alpha']]);
    (xlsx as any).utils.book_append_sheet(wb, ws2, 'Names');
    const buf: Buffer = (xlsx as any).write(wb, { type: 'buffer', bookType: 'xlsx' });
    const result = await parseLocal({ filename: 'wb.xlsx', mime: '', bytes: buf });
    expect(result.metadata.sheets).toBe(2);
    expect(result.tables).toHaveLength(2);
    expect(result.markdown).toMatch(/Sheet: Numbers/);
    expect(result.markdown).toMatch(/Sheet: Names/);
  });
});

describe('renderDocContent', () => {
  it('walks Slate-like nodes into Markdown', () => {
    const doc = [
      { type: 'heading-one', children: [{ text: 'Title' }] },
      { type: 'paragraph', children: [{ text: 'Body text.' }] },
    ];
    const md = renderDocContent(doc);
    expect(md).toContain('# Title');
    expect(md).toContain('Body text.');
  });
});

describe('renderSheetTabs', () => {
  it('renders cells as a Markdown table per tab', () => {
    const tabs = [{
      name: 'Sheet1',
      data: { A1: { v: 'h1' }, B1: { v: 'h2' }, A2: { v: 'a' }, B2: { v: 'b' } },
      row_count: 2, col_count: 2,
    }];
    const md = renderSheetTabs(tabs);
    expect(md).toMatch(/## Sheet1/);
    expect(md).toMatch(/\| h1 \| h2 \|/);
    expect(md).toMatch(/\| a \| b \|/);
  });
});

describe('parseSource router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('handles inline KB entry markdown without bytes', async () => {
    const result = await parseSource({
      workspaceId: 'w',
      source: { namespace: 'kb', source_kind: 'kb_entry', source_id: 'e1', revision: '1' },
      inlineMarkdown: '# Hello\n\nWorld',
    });
    expect(result.parser).toBe('local');
    expect(result.markdown).toContain('# Hello');
  });

  it('handles native documents content (Slate doc + sheet tabs)', async () => {
    const result = await parseSource({
      workspaceId: 'w',
      source: { namespace: 'docs', source_kind: 'document', source_id: 'd1', revision: '1' },
      inlineDoc: {
        content: [{ type: 'heading-two', children: [{ text: 'Hi' }] }],
        sheetTabs: [{ name: 'T', data: { A1: { v: 'x' } }, row_count: 1, col_count: 1 }],
      },
    });
    expect(result.parser).toBe('local');
    expect(result.markdown).toMatch(/## Hi/);
    expect(result.markdown).toMatch(/## T/);
  });

  it('routes binary text-native files through local even with no cloud key', async () => {
    const result = await parseSource({
      workspaceId: 'w',
      source: { namespace: 'docs', source_kind: 'document', source_id: 'd1', revision: '1' },
      filename: 'data.json', mime: 'application/json',
      bytes: Buffer.from('{"hello": "world"}'),
    });
    expect(result.parser).toBe('local');
    expect(result.markdown).toContain('hello');
  });

  it('falls back to local placeholder for OCR-required content with no cloud key', async () => {
    const result = await parseSource({
      workspaceId: 'w',
      source: { namespace: 'docs', source_kind: 'document', source_id: 'd1', revision: '1' },
      filename: 'scan.tiff', mime: 'image/tiff',
      bytes: Buffer.from([1, 2, 3]),
    });
    expect(result.parser).toBe('local');
    expect(String(result.metadata.format)).toBe('placeholder');
    expect(result.markdown).toMatch(/configure/i);
  });
});
