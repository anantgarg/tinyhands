import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Heavy parser libs are mocked; the dispatcher + the in-house parsers
// (RTF, HTML, plain-text) exercise real code.

const mockMammothExtract = vi.fn();
vi.mock('mammoth', () => ({
  default: { extractRawText: (arg: any) => mockMammothExtract(arg) },
}));

const mockPdfParse = vi.fn();
vi.mock('pdf-parse', () => ({
  default: (buf: Buffer) => mockPdfParse(buf),
}));

const mockOfficeParseAsync = vi.fn();
vi.mock('officeparser', () => ({
  parseOfficeAsync: (buf: Buffer) => mockOfficeParseAsync(buf),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockIsReductoEnabled = vi.fn();
const mockParseWithReducto = vi.fn();
vi.mock('../../src/modules/reducto', () => ({
  isReductoEnabledAndConfigured: (...a: any[]) => mockIsReductoEnabled(...a),
  parseWithReducto: (...a: any[]) => mockParseWithReducto(...a),
}));

import { parseDocument } from '../../src/modules/kb-sources/parsers';
import { parseDocx } from '../../src/modules/kb-sources/parsers/docx';
import { parseXlsx } from '../../src/modules/kb-sources/parsers/xlsx';
import { parsePptx } from '../../src/modules/kb-sources/parsers/pptx';
import { parsePdf } from '../../src/modules/kb-sources/parsers/pdf';
import { parseRtf } from '../../src/modules/kb-sources/parsers/rtf';
import { parseHtml } from '../../src/modules/kb-sources/parsers/html';
import { parsePlainText } from '../../src/modules/kb-sources/parsers/plain';

// ── Individual parser tests ──

describe('parsePlainText', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes UTF-8 text through untouched', async () => {
    const r = await parsePlainText({
      bytes: Buffer.from('hello world — em dash ✓', 'utf8'),
      filename: 'a.txt',
      mimeType: 'text/plain',
      workspaceId: 'W1',
    });
    expect(r.text).toBe('hello world — em dash ✓');
    expect(r.warnings).toEqual([]);
  });
});

describe('parseHtml', () => {
  beforeEach(() => vi.clearAllMocks());

  it('extracts readable text and drops scripts/styles', async () => {
    const html = `<html><head><style>x{color:red}</style></head><body><h1>Title</h1><p>Hello <a href="/x">link</a></p><script>alert(1)</script></body></html>`;
    const r = await parseHtml({
      bytes: Buffer.from(html),
      filename: 'a.html',
      mimeType: 'text/html',
      workspaceId: 'W1',
    });
    expect(r.text).toContain('Title');
    expect(r.text).toContain('Hello');
    expect(r.text).toContain('link');
    expect(r.text).not.toContain('alert(1)');
    expect(r.text).not.toContain('color:red');
  });
});

describe('parseRtf', () => {
  beforeEach(() => vi.clearAllMocks());

  it('extracts text from a simple RTF document', async () => {
    const rtf = `{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Times New Roman;}}\\f0\\fs24 Hello \\b World\\b0\\par Second line.}`;
    const r = await parseRtf({
      bytes: Buffer.from(rtf),
      filename: 'a.rtf',
      mimeType: 'application/rtf',
      workspaceId: 'W1',
    });
    expect(r.text).toContain('Hello');
    expect(r.text).toContain('World');
    expect(r.text).toContain('Second line');
    expect(r.text).not.toContain('\\rtf1');
    expect(r.text).not.toContain('fonttbl');
  });

  it('decodes \\uNNNN unicode escapes', async () => {
    const rtf = `{\\rtf1 caf\\u233?}`;
    const r = await parseRtf({
      bytes: Buffer.from(rtf),
      filename: 'a.rtf',
      mimeType: 'application/rtf',
      workspaceId: 'W1',
    });
    expect(r.text).toContain('café');
  });
});

describe('parseDocx', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns mammoth-extracted text and surfaces mammoth warnings', async () => {
    mockMammothExtract.mockResolvedValue({
      value: 'doc body',
      messages: [{ type: 'warning', message: 'dropped image' }],
    });
    const r = await parseDocx({
      bytes: Buffer.from('doc bytes'),
      filename: 'a.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      workspaceId: 'W1',
    });
    expect(r.text).toBe('doc body');
    expect(r.warnings).toEqual(['a.docx: dropped image']);
    expect(r.metadata.parser).toBe('docx');
  });
});

describe('parseXlsx', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serializes all sheets with SheetJS including header markers', async () => {
    // Build a real tiny workbook in-memory so we exercise the xlsx library.
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['col_a', 'col_b'], [1, 2]]), 'Data');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['note'], ['hello']]), 'Notes');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const r = await parseXlsx({
      bytes: buf,
      filename: 'sheet.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      workspaceId: 'W1',
    });
    expect(r.text).toContain('# Sheet: Data');
    expect(r.text).toContain('col_a');
    expect(r.text).toContain('# Sheet: Notes');
    expect(r.text).toContain('hello');
    expect(r.metadata.parser).toBe('xlsx');
  });
});

describe('parsePptx', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to officeparser and returns the extracted text', async () => {
    mockOfficeParseAsync.mockResolvedValue('slide 1 content\nslide 2 content');
    const r = await parsePptx({
      bytes: Buffer.from('pptx bytes'),
      filename: 'deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      workspaceId: 'W1',
    });
    expect(r.text).toContain('slide 1');
    expect(mockOfficeParseAsync).toHaveBeenCalled();
  });
});

describe('parsePdf', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to pdf-parse and records page count metadata', async () => {
    mockPdfParse.mockResolvedValue({ text: 'page one text', numpages: 3 });
    const r = await parsePdf({
      bytes: Buffer.from('%PDF-1.4 fake'),
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      workspaceId: 'W1',
    });
    expect(r.text).toBe('page one text');
    expect(r.metadata.pages).toBe(3);
  });
});

// ── Dispatcher tests ──

describe('parseDocument dispatcher', () => {
  beforeEach(() => vi.clearAllMocks());

  const input = (overrides: Partial<Parameters<typeof parseDocument>[0]> = {}) => ({
    bytes: Buffer.from('bytes'),
    filename: 'file.pdf',
    mimeType: 'application/pdf',
    workspaceId: 'W1',
    ...overrides,
  });

  it('returns an unsupported-type warning when MIME and extension are both unknown', async () => {
    mockIsReductoEnabled.mockResolvedValue(false);
    const r = await parseDocument(input({ filename: 'thing.exe', mimeType: 'application/x-msdownload' }));
    expect(r.text).toBe('');
    expect(r.warnings[0]).toMatch(/unsupported/);
  });

  it('routes PDFs through Reducto when Reducto is enabled', async () => {
    mockIsReductoEnabled.mockResolvedValue(true);
    mockParseWithReducto.mockResolvedValue({ text: 'from reducto', warnings: [], metadata: { parser: 'reducto' } });
    const r = await parseDocument(input());
    expect(r.text).toBe('from reducto');
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  it('falls back to the local PDF parser when Reducto fails, and records a warning', async () => {
    mockIsReductoEnabled.mockResolvedValue(true);
    mockParseWithReducto.mockRejectedValue(new Error('reducto boom'));
    mockPdfParse.mockResolvedValue({ text: 'local text', numpages: 1 });
    const r = await parseDocument(input());
    expect(r.text).toBe('local text');
    expect(r.warnings.some(w => /Reducto parse failed/.test(w))).toBe(true);
  });

  it('never calls Reducto when the workspace has it disabled, even for PDFs', async () => {
    mockIsReductoEnabled.mockResolvedValue(false);
    mockPdfParse.mockResolvedValue({ text: 'local text', numpages: 1 });
    const r = await parseDocument(input());
    expect(r.text).toBe('local text');
    expect(mockParseWithReducto).not.toHaveBeenCalled();
  });

  it('routes docx through Reducto first when enabled (Reducto is preferred for Office docs)', async () => {
    mockIsReductoEnabled.mockResolvedValue(true);
    mockParseWithReducto.mockResolvedValue({ text: 'rescued text', warnings: [], metadata: { parser: 'reducto' } });
    const r = await parseDocument(input({
      filename: 'a.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));
    expect(r.text).toBe('rescued text');
    expect(mockMammothExtract).not.toHaveBeenCalled();
  });

  it('falls back to the local docx parser when Reducto fails, and records a warning', async () => {
    mockIsReductoEnabled.mockResolvedValue(true);
    mockParseWithReducto.mockRejectedValue(new Error('reducto boom'));
    mockMammothExtract.mockResolvedValue({ value: 'local docx text', messages: [] });
    const r = await parseDocument(input({
      filename: 'a.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));
    expect(r.text).toBe('local docx text');
    expect(r.warnings.some(w => /Reducto parse failed/.test(w) && /used local parser instead/.test(w))).toBe(true);
  });

  it('records a clear warning when both Reducto and the local docx parser fail', async () => {
    mockIsReductoEnabled.mockResolvedValue(true);
    mockParseWithReducto.mockRejectedValue(new Error('reducto also down'));
    mockMammothExtract.mockRejectedValue(new Error('bad docx'));
    const r = await parseDocument(input({
      filename: 'a.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));
    expect(r.text).toBe('');
    // Both failures must be surfaced — the order is Reducto-first, then local-fallback.
    expect(r.warnings.some(w => /Reducto parse failed/.test(w))).toBe(true);
    expect(r.warnings.some(w => /docx parser failed/.test(w))).toBe(true);
  });

  it('resolves format by filename extension when MIME is missing or generic', async () => {
    mockIsReductoEnabled.mockResolvedValue(false);
    mockPdfParse.mockResolvedValue({ text: 'local text', numpages: 1 });
    const r = await parseDocument(input({
      mimeType: 'application/octet-stream',
      filename: 'report.pdf',
    }));
    expect(r.text).toBe('local text');
  });

  // ── Image OCR via Reducto ──

  it('routes PNG images through Reducto when enabled and returns the OCR text', async () => {
    mockIsReductoEnabled.mockResolvedValue(true);
    mockParseWithReducto.mockResolvedValue({ text: 'OCR result', warnings: [], metadata: { parser: 'reducto' } });
    const r = await parseDocument(input({ filename: 'screenshot.png', mimeType: 'image/png' }));
    expect(r.text).toBe('OCR result');
    expect(mockParseWithReducto).toHaveBeenCalled();
  });

  it('routes JPG images through Reducto by extension when MIME is generic', async () => {
    mockIsReductoEnabled.mockResolvedValue(true);
    mockParseWithReducto.mockResolvedValue({ text: 'OCR result', warnings: [], metadata: { parser: 'reducto' } });
    const r = await parseDocument(input({ filename: 'photo.jpg', mimeType: 'application/octet-stream' }));
    expect(r.text).toBe('OCR result');
    expect(mockParseWithReducto).toHaveBeenCalled();
  });

  it('returns image-no-reducto skip metadata when Reducto is disabled for an image', async () => {
    mockIsReductoEnabled.mockResolvedValue(false);
    const r = await parseDocument(input({ filename: 'a.png', mimeType: 'image/png' }));
    expect(r.text).toBe('');
    expect((r.metadata as any).parser).toBe('image-no-reducto');
    expect(r.warnings[0]).toMatch(/image OCR requires Reducto/);
    expect(mockParseWithReducto).not.toHaveBeenCalled();
  });

  it('returns reducto-failed metadata when image OCR via Reducto throws', async () => {
    mockIsReductoEnabled.mockResolvedValue(true);
    mockParseWithReducto.mockRejectedValue(new Error('reducto boom'));
    const r = await parseDocument(input({ filename: 'a.png', mimeType: 'image/png' }));
    expect(r.text).toBe('');
    expect((r.metadata as any).parser).toBe('reducto-failed');
    expect(r.warnings[0]).toMatch(/image OCR via Reducto failed/);
  });

  it('treats image/jpeg the same as JPG/PNG', async () => {
    mockIsReductoEnabled.mockResolvedValue(true);
    mockParseWithReducto.mockResolvedValue({ text: 'OCR', warnings: [], metadata: { parser: 'reducto' } });
    const r = await parseDocument(input({ filename: 'a.jpeg', mimeType: 'image/jpeg' }));
    expect(r.text).toBe('OCR');
  });
});
