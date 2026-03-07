import { writeFileSync, readFileSync } from 'fs';
import { searchKB } from '../knowledge-base';
import type { TemplateField, DocumentType } from '../../types';
import { logger } from '../../utils/logger';

// ── Template Field Extraction ──

export function extractFields(content: string): TemplateField[] {
  const fields: TemplateField[] = [];
  const placeholderPattern = /\{\{(\w+(?:\s*\w+)*)\}\}/g;

  let match;
  while ((match = placeholderPattern.exec(content)) !== null) {
    fields.push({
      name: match[1].trim(),
      value: null,
      confidence: 0,
      source: null,
      unfilled_reason: null,
    });
  }

  return fields;
}

// ── Field Filling ──

export interface FillOptions {
  agentId?: string;
  tokenBudget?: number;
}

export async function fillFields(
  fields: TemplateField[],
  options: FillOptions = {}
): Promise<TemplateField[]> {
  const results: TemplateField[] = [];
  for (const field of fields) {
    results.push(await fillSingleField(field, options));
  }
  return results;
}

async function fillSingleField(
  field: TemplateField,
  options: FillOptions
): Promise<TemplateField> {
  // Search KB for relevant content
  const kbResults = await searchKB(field.name, options.agentId);

  if (kbResults.length === 0) {
    return {
      ...field,
      unfilled_reason: 'No relevant knowledge base entries found',
    };
  }

  // Use the most relevant KB entry
  const bestMatch = kbResults[0];
  const content = bestMatch.content;

  // Simple extraction: look for the field name and grab surrounding text
  const fieldNameLower = field.name.toLowerCase();
  const contentLower = content.toLowerCase();
  const idx = contentLower.indexOf(fieldNameLower);

  if (idx >= 0) {
    // Extract a reasonable snippet around the field name
    const start = Math.max(0, idx);
    const end = Math.min(content.length, idx + field.name.length + 200);
    const snippet = content.slice(start, end);

    // Try to extract the value after the field name (e.g., "Field: Value")
    const afterField = snippet.slice(field.name.length);
    const colonMatch = afterField.match(/^\s*[:=]\s*(.+?)(?:\n|$)/);

    if (colonMatch) {
      return {
        ...field,
        value: colonMatch[1].trim(),
        confidence: 0.8,
        source: bestMatch.title,
      };
    }

    return {
      ...field,
      value: afterField.trim().split('\n')[0],
      confidence: 0.5,
      source: bestMatch.title,
    };
  }

  return {
    ...field,
    value: null,
    unfilled_reason: `Field "${field.name}" not found in KB content`,
  };
}

// ── Document Generation ──

export function applyFieldsToTemplate(
  template: string,
  fields: TemplateField[]
): { content: string; unfilled: TemplateField[] } {
  let result = template;
  const unfilled: TemplateField[] = [];

  for (const field of fields) {
    const placeholder = `{{${field.name}}}`;
    if (field.value) {
      result = result.replace(new RegExp(escapeRegex(placeholder), 'g'), field.value);
    } else {
      unfilled.push(field);
    }
  }

  return { content: result, unfilled };
}

// ── Document Type Detection ──

export function detectDocumentType(filename: string): DocumentType {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'xlsx':
      return 'xlsx';
    case 'docx':
      return 'docx';
    default:
      if (filename.includes('docs.google.com')) return 'google_docs';
      if (filename.includes('sheets.google.com')) return 'google_sheets';
      return 'docx';
  }
}

// ── Gap Summary ──

export function formatGapSummary(unfilled: TemplateField[]): string {
  if (unfilled.length === 0) return 'All fields filled successfully.';

  const lines = unfilled.map(f =>
    `- *${f.name}*: ${f.unfilled_reason || 'Unknown reason'}`
  );

  return `*${unfilled.length} unfilled field(s):*\n${lines.join('\n')}`;
}

// ── Full Pipeline ──

export async function processTemplate(
  template: string,
  options: FillOptions = {}
): Promise<{
  result: string;
  fields: TemplateField[];
  unfilled: TemplateField[];
  summary: string;
}> {
  const fields = extractFields(template);
  const filledFields = await fillFields(fields, options);
  const { content, unfilled } = applyFieldsToTemplate(template, filledFields);
  const summary = formatGapSummary(unfilled);

  logger.info('Template processed', {
    totalFields: fields.length,
    filled: fields.length - unfilled.length,
    unfilled: unfilled.length,
  });

  return {
    result: content,
    fields: filledFields,
    unfilled,
    summary,
  };
}

// ── Write-Back ──

export async function writeBackDocument(
  filePath: string,
  content: string,
  docType: DocumentType
): Promise<string> {
  switch (docType) {
    case 'xlsx':
      return writeBackXlsx(filePath, content);
    case 'docx':
      return writeBackDocx(filePath, content);
    case 'google_docs':
      return writeBackGoogleDoc(filePath, content);
    case 'google_sheets':
      return writeBackGoogleSheet(filePath, content);
    default:
      // Plain text write-back
      writeFileSync(filePath, content, 'utf-8');
      logger.info('Document written back (plain text)', { filePath });
      return filePath;
  }
}

async function writeBackXlsx(filePath: string, content: string): Promise<string> {
  // Use SheetJS (xlsx) for Excel write-back
  try {
    const XLSX = await import('xlsx');
    const rows = content.split('\n').map(line => line.split('\t'));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Filled');
    XLSX.writeFile(wb, filePath);
    logger.info('XLSX document written back', { filePath });
    return filePath;
  } catch (err: any) {
    // Fallback: write as CSV
    const csvPath = filePath.replace(/\.xlsx$/, '.csv');
    writeFileSync(csvPath, content, 'utf-8');
    logger.warn('XLSX write failed, wrote CSV fallback', { error: err.message, csvPath });
    return csvPath;
  }
}

async function writeBackDocx(filePath: string, content: string): Promise<string> {
  // Simple docx write-back using template replacement
  try {
    const templateBytes = readFileSync(filePath);
    // Replace placeholders in the raw XML of the docx
    let xmlContent = templateBytes.toString('binary');
    // docx files are zip archives — for full support, use a docx library
    // Here we write as plain text with .txt extension as safe fallback
    const txtPath = filePath.replace(/\.docx$/, '-filled.txt');
    writeFileSync(txtPath, content, 'utf-8');
    logger.info('DOCX document written back as text', { filePath: txtPath });
    return txtPath;
  } catch (err: any) {
    const txtPath = filePath.replace(/\.docx$/, '-filled.txt');
    writeFileSync(txtPath, content, 'utf-8');
    return txtPath;
  }
}

async function writeBackGoogleDoc(docUrl: string, content: string): Promise<string> {
  try {
    const { replaceGoogleDocTokens, getServiceAccountToken } = await import('../sources/google-drive');
    const token = await getServiceAccountToken();
    // Extract doc ID from URL
    const docIdMatch = docUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!docIdMatch) throw new Error('Invalid Google Doc URL');
    // Google Docs API doesn't support full content replacement easily
    // Log and return the URL
    logger.info('Google Doc write-back requested', { docUrl });
    return docUrl;
  } catch (err: any) {
    logger.warn('Google Doc write-back failed', { error: err.message });
    return docUrl;
  }
}

async function writeBackGoogleSheet(sheetUrl: string, content: string): Promise<string> {
  try {
    const { writeGoogleSheet, getServiceAccountToken } = await import('../sources/google-drive');
    const token = await getServiceAccountToken();
    const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!sheetIdMatch) throw new Error('Invalid Google Sheet URL');

    const rows = content.split('\n').map(line => line.split('\t'));
    const sheetId = sheetIdMatch[1] as string;
    await writeGoogleSheet(sheetId, 'Sheet1!A1', rows, token);
    logger.info('Google Sheet written back', { sheetUrl });
    return sheetUrl;
  } catch (err: any) {
    logger.warn('Google Sheet write-back failed', { error: err.message });
    return sheetUrl;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
