import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { schemaFor, assertIdent } from '../../src/modules/database/schema';

describe('database/schema helpers', () => {
  describe('schemaFor', () => {
    it('produces a per-workspace schema name', () => {
      expect(schemaFor('T012ABCD')).toBe('ws_t012abcd');
    });
    it('sanitizes non-alphanumeric characters', () => {
      expect(schemaFor('T-012.ABCD')).toBe('ws_t_012_abcd');
    });
    it('different workspaces map to different schemas (no collision)', () => {
      expect(schemaFor('TA')).not.toBe(schemaFor('TB'));
    });
  });

  describe('assertIdent', () => {
    it('accepts simple lowercase names', () => {
      expect(assertIdent('customers', 'table')).toBe('customers');
      expect(assertIdent('first_name', 'column')).toBe('first_name');
    });
    it('lowercases mixed case input', () => {
      expect(assertIdent('Customers', 'table')).toBe('customers');
    });
    it('rejects names with hyphens', () => {
      expect(() => assertIdent('first-name', 'column')).toThrow();
    });
    it('rejects names with spaces', () => {
      expect(() => assertIdent('first name', 'column')).toThrow();
    });
    it('rejects names that start with a digit', () => {
      expect(() => assertIdent('1st', 'column')).toThrow();
    });
    it('rejects SQL injection-style payloads', () => {
      expect(() => assertIdent('foo"; drop table x; --', 'column')).toThrow();
    });
    it('rejects reserved built-in column names', () => {
      expect(() => assertIdent('id', 'column')).toThrow();
      expect(() => assertIdent('created_at', 'column')).toThrow();
      expect(() => assertIdent('updated_at', 'column')).toThrow();
    });
    it('accepts a long name up to the limit', () => {
      const name = 'a'.repeat(60);
      expect(assertIdent(name, 'column')).toBe(name);
    });
    it('rejects names exceeding 63 chars', () => {
      const name = 'a'.repeat(64);
      expect(() => assertIdent(name, 'column')).toThrow();
    });
  });
});
