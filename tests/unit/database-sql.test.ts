import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { validateReadOnly, SqlReadOnlyError } from '../../src/modules/database/sql';

describe('database read-only SQL validation', () => {
  it('accepts a plain SELECT', () => {
    expect(() => validateReadOnly('SELECT * FROM customers')).not.toThrow();
  });

  it('accepts a WITH ... SELECT (read-only CTE)', () => {
    expect(() => validateReadOnly('WITH x AS (SELECT * FROM t) SELECT * FROM x')).not.toThrow();
  });

  it('rejects INSERT', () => {
    expect(() => validateReadOnly("INSERT INTO t VALUES (1)")).toThrow(SqlReadOnlyError);
  });

  it('rejects UPDATE', () => {
    expect(() => validateReadOnly("UPDATE t SET x=1")).toThrow(SqlReadOnlyError);
  });

  it('rejects DELETE', () => {
    expect(() => validateReadOnly("DELETE FROM t")).toThrow(SqlReadOnlyError);
  });

  it('rejects DROP / CREATE / ALTER (DDL)', () => {
    expect(() => validateReadOnly('DROP TABLE customers')).toThrow(SqlReadOnlyError);
    expect(() => validateReadOnly('CREATE TABLE foo (x int)')).toThrow(SqlReadOnlyError);
    expect(() => validateReadOnly('ALTER TABLE customers ADD COLUMN x int')).toThrow(SqlReadOnlyError);
  });

  it('rejects TRUNCATE / GRANT / COPY', () => {
    expect(() => validateReadOnly('TRUNCATE TABLE x')).toThrow(SqlReadOnlyError);
    expect(() => validateReadOnly('GRANT ALL ON x TO public')).toThrow(SqlReadOnlyError);
    expect(() => validateReadOnly('COPY x TO STDOUT')).toThrow(SqlReadOnlyError);
  });

  it('rejects multiple statements (statement injection)', () => {
    expect(() => validateReadOnly('SELECT 1; DELETE FROM t')).toThrow(SqlReadOnlyError);
  });

  it('does not get fooled by forbidden keywords inside string literals', () => {
    expect(() => validateReadOnly("SELECT 'INSERT INTO foo' AS msg")).not.toThrow();
    expect(() => validateReadOnly("SELECT 'DROP TABLE bar' AS msg")).not.toThrow();
  });

  it('does not get fooled by forbidden keywords inside SQL comments', () => {
    expect(() => validateReadOnly('SELECT 1 -- INSERT INTO foo')).not.toThrow();
    expect(() => validateReadOnly('SELECT 1 /* DELETE FROM foo */')).not.toThrow();
  });

  it('rejects empty input', () => {
    expect(() => validateReadOnly('')).toThrow(SqlReadOnlyError);
    expect(() => validateReadOnly('   ;  ')).toThrow(SqlReadOnlyError);
  });

  it('rejects WITH that does not end in SELECT', () => {
    expect(() => validateReadOnly('WITH x AS (SELECT 1) DELETE FROM y')).toThrow(SqlReadOnlyError);
  });

  it('rejects EXECUTE / CALL / PREPARE', () => {
    expect(() => validateReadOnly('EXECUTE myproc')).toThrow(SqlReadOnlyError);
    expect(() => validateReadOnly('CALL doit()')).toThrow(SqlReadOnlyError);
    expect(() => validateReadOnly('PREPARE x AS SELECT 1')).toThrow(SqlReadOnlyError);
  });
});
