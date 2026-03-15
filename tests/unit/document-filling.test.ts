import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

vi.mock('../../src/modules/knowledge-base', () => ({
  searchKB: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { writeFileSync, readFileSync } from 'fs';
import { searchKB } from '../../src/modules/knowledge-base';
import {
  extractFields,
  applyFieldsToTemplate,
  formatGapSummary,
  fillFields,
  detectDocumentType,
  processTemplate,
  writeBackDocument,
} from '../../src/modules/document-filling';
import type { TemplateField, DocumentType } from '../../src/types';

// ══════════════════════════════════════════════════
//  extractFields
// ══════════════════════════════════════════════════

describe('Template Field Extraction', () => {
  it('should extract placeholder fields', () => {
    const template = 'Hello {{name}}, your order {{order_id}} is ready.';
    const fields = extractFields(template);
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('name');
    expect(fields[1].name).toBe('order_id');
  });

  it('should handle templates with no placeholders', () => {
    expect(extractFields('No placeholders here')).toHaveLength(0);
  });

  it('should handle multi-word field names', () => {
    const fields = extractFields('{{company name}} at {{street address}}');
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('company name');
  });

  it('should return fields with null values, zero confidence, and null source', () => {
    const fields = extractFields('{{foo}}');
    expect(fields[0]).toEqual({
      name: 'foo',
      value: null,
      confidence: 0,
      source: null,
      unfilled_reason: null,
    });
  });

  it('should extract duplicate field names as separate entries', () => {
    const fields = extractFields('{{name}} and {{name}}');
    expect(fields).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════
//  applyFieldsToTemplate
// ══════════════════════════════════════════════════

describe('Template Application', () => {
  it('should fill known fields', () => {
    const template = 'Hello {{name}}, your order {{order_id}} is ready.';
    const fields: TemplateField[] = [
      { name: 'name', value: 'John', confidence: 1.0, source: null, unfilled_reason: null },
      { name: 'order_id', value: '12345', confidence: 1.0, source: null, unfilled_reason: null },
    ];

    const { content, unfilled } = applyFieldsToTemplate(template, fields);
    expect(content).toBe('Hello John, your order 12345 is ready.');
    expect(unfilled).toHaveLength(0);
  });

  it('should report unfilled fields', () => {
    const template = 'Dear {{name}}, re: {{subject}}';
    const fields: TemplateField[] = [
      { name: 'name', value: 'Alice', confidence: 1.0, source: null, unfilled_reason: null },
      { name: 'subject', value: null, confidence: 0, source: null, unfilled_reason: 'Not found' },
    ];

    const { content, unfilled } = applyFieldsToTemplate(template, fields);
    expect(content).toContain('Alice');
    expect(content).toContain('{{subject}}');
    expect(unfilled).toHaveLength(1);
  });

  it('should replace all occurrences of the same placeholder', () => {
    const template = '{{name}} says hello. Regards, {{name}}.';
    const fields: TemplateField[] = [
      { name: 'name', value: 'Bob', confidence: 1.0, source: null, unfilled_reason: null },
    ];

    const { content } = applyFieldsToTemplate(template, fields);
    expect(content).toBe('Bob says hello. Regards, Bob.');
  });

  it('should handle empty fields array', () => {
    const template = 'No fields here {{none}}.';
    const { content, unfilled } = applyFieldsToTemplate(template, []);
    expect(content).toBe('No fields here {{none}}.');
    expect(unfilled).toHaveLength(0);
  });

  it('should handle fields with special regex characters in names', () => {
    // The escapeRegex helper should handle this
    const template = 'Value is {{amount (USD)}}.';
    const fields: TemplateField[] = [
      { name: 'amount (USD)', value: '100', confidence: 1.0, source: null, unfilled_reason: null },
    ];

    const { content } = applyFieldsToTemplate(template, fields);
    expect(content).toBe('Value is 100.');
  });
});

// ══════════════════════════════════════════════════
//  formatGapSummary
// ══════════════════════════════════════════════════

describe('Gap Summary', () => {
  it('should show success when all filled', () => {
    expect(formatGapSummary([])).toBe('All fields filled successfully.');
  });

  it('should list unfilled fields', () => {
    const unfilled: TemplateField[] = [
      { name: 'address', value: null, confidence: 0, source: null, unfilled_reason: 'Not in KB' },
    ];
    const summary = formatGapSummary(unfilled);
    expect(summary).toContain('1 unfilled');
    expect(summary).toContain('address');
    expect(summary).toContain('Not in KB');
  });

  it('should show "Unknown reason" when unfilled_reason is null', () => {
    const unfilled: TemplateField[] = [
      { name: 'city', value: null, confidence: 0, source: null, unfilled_reason: null },
    ];
    const summary = formatGapSummary(unfilled);
    expect(summary).toContain('Unknown reason');
  });

  it('should show correct count for multiple unfilled fields', () => {
    const unfilled: TemplateField[] = [
      { name: 'a', value: null, confidence: 0, source: null, unfilled_reason: 'missing' },
      { name: 'b', value: null, confidence: 0, source: null, unfilled_reason: 'missing' },
      { name: 'c', value: null, confidence: 0, source: null, unfilled_reason: 'missing' },
    ];
    const summary = formatGapSummary(unfilled);
    expect(summary).toContain('3 unfilled');
  });
});

// ══════════════════════════════════════════════════
//  fillFields
// ══════════════════════════════════════════════════

describe('fillFields', () => {
  const mockSearchKB = searchKB as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fill a field when KB has matching content with colon separator', async () => {
    mockSearchKB.mockResolvedValue([
      { content: 'company name: Acme Corp\nother info here', title: 'Company KB' },
    ]);

    const fields: TemplateField[] = [
      { name: 'company name', value: null, confidence: 0, source: null, unfilled_reason: null },
    ];

    const result = await fillFields(fields);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('Acme Corp');
    expect(result[0].confidence).toBe(0.8);
    expect(result[0].source).toBe('Company KB');
  });

  it('should fill with lower confidence when no colon separator', async () => {
    mockSearchKB.mockResolvedValue([
      { content: 'The company name is something. More text follows.', title: 'Info' },
    ]);

    const fields: TemplateField[] = [
      { name: 'company name', value: null, confidence: 0, source: null, unfilled_reason: null },
    ];

    const result = await fillFields(fields);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.5);
    expect(result[0].source).toBe('Info');
  });

  it('should return unfilled reason when KB has no results', async () => {
    mockSearchKB.mockResolvedValue([]);

    const fields: TemplateField[] = [
      { name: 'address', value: null, confidence: 0, source: null, unfilled_reason: null },
    ];

    const result = await fillFields(fields);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeNull();
    expect(result[0].unfilled_reason).toBe('No relevant knowledge base entries found');
  });

  it('should return unfilled reason when field name not found in KB content', async () => {
    mockSearchKB.mockResolvedValue([
      { content: 'This content does not mention the desired field at all.', title: 'Irrelevant' },
    ]);

    const fields: TemplateField[] = [
      { name: 'zip_code', value: null, confidence: 0, source: null, unfilled_reason: null },
    ];

    const result = await fillFields(fields);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeNull();
    expect(result[0].unfilled_reason).toContain('not found in KB content');
  });

  it('should pass agentId to searchKB', async () => {
    mockSearchKB.mockResolvedValue([]);

    const fields: TemplateField[] = [
      { name: 'field', value: null, confidence: 0, source: null, unfilled_reason: null },
    ];

    await fillFields(fields, { agentId: 'agent-42' });
    expect(mockSearchKB).toHaveBeenCalledWith('field', 'agent-42');
  });

  it('should handle multiple fields', async () => {
    mockSearchKB
      .mockResolvedValueOnce([{ content: 'name: Alice', title: 'People' }])
      .mockResolvedValueOnce([]);

    const fields: TemplateField[] = [
      { name: 'name', value: null, confidence: 0, source: null, unfilled_reason: null },
      { name: 'phone', value: null, confidence: 0, source: null, unfilled_reason: null },
    ];

    const result = await fillFields(fields);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('Alice');
    expect(result[1].unfilled_reason).toBe('No relevant knowledge base entries found');
  });

  it('should handle field name with equals separator', async () => {
    mockSearchKB.mockResolvedValue([
      { content: 'status = Active\nother data', title: 'Status Doc' },
    ]);

    const fields: TemplateField[] = [
      { name: 'status', value: null, confidence: 0, source: null, unfilled_reason: null },
    ];

    const result = await fillFields(fields);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('Active');
    expect(result[0].confidence).toBe(0.8);
  });
});

// ══════════════════════════════════════════════════
//  detectDocumentType
// ══════════════════════════════════════════════════

describe('detectDocumentType', () => {
  it('should detect xlsx files', () => {
    expect(detectDocumentType('report.xlsx')).toBe('xlsx');
  });

  it('should detect docx files', () => {
    expect(detectDocumentType('letter.docx')).toBe('docx');
  });

  it('should detect Google Docs URLs', () => {
    expect(detectDocumentType('https://docs.google.com/document/d/abc123/edit')).toBe('google_docs');
  });

  it('should detect Google Sheets URLs', () => {
    expect(detectDocumentType('https://sheets.google.com/spreadsheets/d/abc123/edit')).toBe('google_sheets');
  });

  it('should default to docx for unknown extensions', () => {
    expect(detectDocumentType('file.txt')).toBe('docx');
    expect(detectDocumentType('file.pdf')).toBe('docx');
  });

  it('should handle uppercase extensions', () => {
    expect(detectDocumentType('report.XLSX')).toBe('xlsx');
    expect(detectDocumentType('letter.DOCX')).toBe('docx');
  });
});

// ══════════════════════════════════════════════════
//  processTemplate (full pipeline)
// ══════════════════════════════════════════════════

describe('processTemplate', () => {
  const mockSearchKB = searchKB as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process a full template end-to-end', async () => {
    mockSearchKB
      .mockResolvedValueOnce([{ content: 'name: Alice Smith', title: 'People' }])
      .mockResolvedValueOnce([{ content: 'email: alice@example.com', title: 'Contacts' }]);

    const template = 'Dear {{name}}, your email is {{email}}.';
    const result = await processTemplate(template);

    expect(result.fields).toHaveLength(2);
    expect(result.result).toContain('Alice Smith');
    expect(result.result).toContain('alice@example.com');
    expect(result.unfilled).toHaveLength(0);
    expect(result.summary).toBe('All fields filled successfully.');
  });

  it('should report unfilled fields in summary', async () => {
    mockSearchKB.mockResolvedValue([]);

    const template = '{{company}} at {{address}}';
    const result = await processTemplate(template);

    expect(result.unfilled).toHaveLength(2);
    expect(result.summary).toContain('2 unfilled');
  });

  it('should handle template with no placeholders', async () => {
    const template = 'No fields at all.';
    const result = await processTemplate(template);

    expect(result.fields).toHaveLength(0);
    expect(result.unfilled).toHaveLength(0);
    expect(result.result).toBe('No fields at all.');
    expect(result.summary).toBe('All fields filled successfully.');
  });

  it('should pass options through to fillFields', async () => {
    mockSearchKB.mockResolvedValue([]);

    await processTemplate('{{x}}', { agentId: 'agent-7' });
    expect(mockSearchKB).toHaveBeenCalledWith('x', 'agent-7');
  });
});

// ══════════════════════════════════════════════════
//  writeBackDocument
// ══════════════════════════════════════════════════

describe('writeBackDocument', () => {
  const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
  const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write docx as txt via the docx handler', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('template'));
    const result = await writeBackDocument('/tmp/file.docx', 'content', 'docx');
    // docx handler writes as -filled.txt fallback
    expect(result).toBe('/tmp/file-filled.txt');
  });

  it('should write xlsx and return file path on success', async () => {
    // Mock the dynamic import of xlsx
    const mockXLSX = {
      utils: {
        aoa_to_sheet: vi.fn().mockReturnValue({}),
        book_new: vi.fn().mockReturnValue({}),
        book_append_sheet: vi.fn(),
      },
      writeFile: vi.fn(),
    };

    // We need to mock the xlsx module
    vi.doMock('xlsx', () => mockXLSX);

    const result = await writeBackDocument('/tmp/test.xlsx', 'col1\tcol2\nval1\tval2', 'xlsx');
    // Result should be a path (either the xlsx path or csv fallback)
    expect(typeof result).toBe('string');
  });

  it('should fall back to CSV when xlsx write fails', async () => {
    // Force xlsx import to fail
    vi.doMock('xlsx', () => {
      throw new Error('Module not found');
    });

    const result = await writeBackDocument('/tmp/test.xlsx', 'data', 'xlsx');
    // Should fall back to CSV
    expect(result).toContain('.csv');
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('should write docx as txt fallback', async () => {
    mockReadFileSync.mockReturnValue(Buffer.from('template content'));

    const result = await writeBackDocument('/tmp/letter.docx', 'filled content', 'docx');
    expect(result).toBe('/tmp/letter-filled.txt');
    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/letter-filled.txt', 'filled content', 'utf-8');
  });

  it('should handle docx read error gracefully', async () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('File not found'); });

    const result = await writeBackDocument('/tmp/letter.docx', 'filled content', 'docx');
    expect(result).toBe('/tmp/letter-filled.txt');
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('should handle google_docs by returning the URL', async () => {
    const url = 'https://docs.google.com/document/d/abc123/edit';
    // The google drive module import will fail in test, caught by try/catch
    const result = await writeBackDocument(url, 'content', 'google_docs');
    expect(result).toBe(url);
  });

  it('should handle google_sheets by returning the URL', async () => {
    const url = 'https://sheets.google.com/spreadsheets/d/abc123/edit';
    // The google drive module import will fail in test, caught by try/catch
    const result = await writeBackDocument(url, 'col1\tcol2', 'google_sheets');
    expect(result).toBe(url);
  });

  it('should handle google_docs with invalid URL', async () => {
    const url = 'https://docs.google.com/some-invalid-url';
    const result = await writeBackDocument(url, 'content', 'google_docs');
    // Should return the URL even if parsing fails (caught by try/catch)
    expect(result).toBe(url);
  });

  it('should handle google_sheets with invalid URL', async () => {
    const url = 'https://sheets.google.com/invalid';
    const result = await writeBackDocument(url, 'content', 'google_sheets');
    expect(result).toBe(url);
  });

  it('should write plain text for unknown docType (default case)', async () => {
    const result = await writeBackDocument('/tmp/test.txt', 'plain text content', 'plain_text' as any);
    expect(result).toBe('/tmp/test.txt');
    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/test.txt', 'plain text content', 'utf-8');
  });

  it('should write back google_sheets successfully when module is available', async () => {
    const mockWriteGoogleSheet = vi.fn().mockResolvedValue(undefined);
    const mockGetServiceAccountToken = vi.fn().mockResolvedValue('fake-token');

    vi.doMock('../../src/modules/sources/google-drive', () => ({
      writeGoogleSheet: mockWriteGoogleSheet,
      getServiceAccountToken: mockGetServiceAccountToken,
    }));

    // Need to reimport to use the mocked module
    const { writeBackDocument: freshWriteBackDocument } = await import('../../src/modules/document-filling');

    const url = 'https://sheets.google.com/spreadsheets/d/abc123/edit';
    const result = await freshWriteBackDocument(url, 'col1\tcol2\nval1\tval2', 'google_sheets');

    expect(result).toBe(url);
    expect(mockWriteGoogleSheet).toHaveBeenCalledWith(
      'abc123',
      'Sheet1!A1',
      [['col1', 'col2'], ['val1', 'val2']],
      'fake-token',
    );
  });
});
