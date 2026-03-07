import { describe, it, expect } from 'vitest';
import { extractFields, applyFieldsToTemplate, formatGapSummary } from '../../src/modules/document-filling';

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
});

describe('Template Application', () => {
  it('should fill known fields', () => {
    const template = 'Hello {{name}}, your order {{order_id}} is ready.';
    const fields = [
      { name: 'name', value: 'John', confidence: 1.0, source: null, unfilled_reason: null },
      { name: 'order_id', value: '12345', confidence: 1.0, source: null, unfilled_reason: null },
    ];

    const { content, unfilled } = applyFieldsToTemplate(template, fields);
    expect(content).toBe('Hello John, your order 12345 is ready.');
    expect(unfilled).toHaveLength(0);
  });

  it('should report unfilled fields', () => {
    const template = 'Dear {{name}}, re: {{subject}}';
    const fields = [
      { name: 'name', value: 'Alice', confidence: 1.0, source: null, unfilled_reason: null },
      { name: 'subject', value: null, confidence: 0, source: null, unfilled_reason: 'Not found' },
    ];

    const { content, unfilled } = applyFieldsToTemplate(template, fields);
    expect(content).toContain('Alice');
    expect(content).toContain('{{subject}}');
    expect(unfilled).toHaveLength(1);
  });
});

describe('Gap Summary', () => {
  it('should show success when all filled', () => {
    expect(formatGapSummary([])).toBe('All fields filled successfully.');
  });

  it('should list unfilled fields', () => {
    const unfilled = [
      { name: 'address', value: null, confidence: 0, source: null, unfilled_reason: 'Not in KB' },
    ];
    const summary = formatGapSummary(unfilled);
    expect(summary).toContain('1 unfilled');
    expect(summary).toContain('address');
  });
});
