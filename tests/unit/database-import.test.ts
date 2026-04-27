import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { parseCsv } from '../../src/modules/database/imports/csv';
import { inferColumnType, coerceValue } from '../../src/modules/database/imports/infer';

describe('CSV parsing', () => {
  it('parses a simple CSV', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted fields with commas inside', () => {
    const rows = parseCsv('name,note\n"Smith, Jane","hi, there"\n');
    expect(rows[1]).toEqual(['Smith, Jane', 'hi, there']);
  });

  it('handles escaped quotes', () => {
    const rows = parseCsv('a\n"He said ""hi"""\n');
    expect(rows[1]).toEqual(['He said "hi"']);
  });

  it('returns an empty list for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('column type inference', () => {
  it('infers integer from whole numbers', () => {
    expect(inferColumnType(['1', '2', '3'])).toBe('integer');
  });
  it('infers bigint when values overflow int32', () => {
    expect(inferColumnType(['9999999999999'])).toBe('bigint');
  });
  it('infers numeric from decimal numbers', () => {
    expect(inferColumnType(['1.5', '2.0', '3.14'])).toBe('numeric');
  });
  it('infers boolean from true/false strings', () => {
    expect(inferColumnType(['true', 'false', 'TRUE'])).toBe('boolean');
  });
  it('infers date from YYYY-MM-DD', () => {
    expect(inferColumnType(['2026-04-24', '2025-01-01'])).toBe('date');
  });
  it('infers timestamptz from ISO datetime', () => {
    expect(inferColumnType(['2026-04-24T10:00:00Z'])).toBe('timestamptz');
  });
  it('falls back to text for mixed types', () => {
    expect(inferColumnType(['1', 'two', '3'])).toBe('text');
  });
  it('treats empty samples as text', () => {
    expect(inferColumnType(['', '   '])).toBe('text');
    expect(inferColumnType([])).toBe('text');
  });
});

describe('value coercion', () => {
  it('coerces text', () => {
    expect(coerceValue('hello', 'text')).toEqual({ ok: true, value: 'hello' });
  });
  it('coerces empty values to null', () => {
    expect(coerceValue('', 'text')).toEqual({ ok: true, value: null });
    expect(coerceValue(null, 'integer')).toEqual({ ok: true, value: null });
  });
  it('coerces numeric strings to numbers', () => {
    expect(coerceValue('42', 'integer')).toEqual({ ok: true, value: 42 });
    expect(coerceValue('3.14', 'numeric')).toEqual({ ok: true, value: 3.14 });
  });
  it('rejects non-numeric strings for numeric columns', () => {
    const r = coerceValue('hello', 'integer');
    expect(r.ok).toBe(false);
  });
  it('coerces booleans', () => {
    expect(coerceValue('true', 'boolean')).toEqual({ ok: true, value: true });
    expect(coerceValue('false', 'boolean')).toEqual({ ok: true, value: false });
    expect(coerceValue('1', 'boolean')).toEqual({ ok: true, value: true });
  });
  it('rejects invalid booleans', () => {
    expect(coerceValue('maybe', 'boolean').ok).toBe(false);
  });
  it('coerces dates', () => {
    const r = coerceValue('2026-04-24', 'date');
    expect(r.ok).toBe(true);
  });
  it('rejects invalid dates', () => {
    expect(coerceValue('not-a-date', 'date').ok).toBe(false);
  });
});
