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

export function fillFields(
  fields: TemplateField[],
  options: FillOptions = {}
): TemplateField[] {
  return fields.map(field => fillSingleField(field, options));
}

function fillSingleField(
  field: TemplateField,
  options: FillOptions
): TemplateField {
  // Search KB for relevant content
  const kbResults = searchKB(field.name, options.agentId);

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

export function processTemplate(
  template: string,
  options: FillOptions = {}
): {
  result: string;
  fields: TemplateField[];
  unfilled: TemplateField[];
  summary: string;
} {
  const fields = extractFields(template);
  const filledFields = fillFields(fields, options);
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
