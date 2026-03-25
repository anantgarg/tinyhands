import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ──

const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn();
const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
const mockPoolOn = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: mockPoolQuery,
    connect: mockPoolConnect,
    end: mockPoolEnd,
    on: mockPoolOn,
  })),
}));

const mockRunMigrations = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/db/migrate', () => ({
  runMigrations: (...args: any[]) => mockRunMigrations(...args),
}));

vi.mock('../../src/config', () => ({
  config: {
    database: {
      url: 'postgresql://localhost:5432/tinyhands_test',
    },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { Pool } from 'pg';
import { config } from '../../src/config';

// We need to re-import the module fresh for each lifecycle test group.
// For non-lifecycle tests, we use a shared import.

// ── Tests ──

describe('DB Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── sanitizeParams ──
  // sanitizeParams is not exported, so we test it indirectly through query/queryOne/execute.

  describe('sanitizeParams (via query)', () => {
    let dbModule: typeof import('../../src/db/index');

    beforeEach(async () => {
      vi.resetModules();
      vi.clearAllMocks();
      dbModule = await import('../../src/db/index');
      // Initialize the DB so pool is created
      await dbModule.initDb();
    });

    afterEach(async () => {
      await dbModule.closeDb();
    });

    it('should strip null bytes from string parameters', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await dbModule.query('SELECT $1', ['hello\0world']);

      expect(mockPoolQuery).toHaveBeenCalledWith('SELECT $1', ['helloworld']);
    });

    it('should strip multiple null bytes', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await dbModule.query('SELECT $1', ['\0before\0middle\0after\0']);

      expect(mockPoolQuery).toHaveBeenCalledWith('SELECT $1', ['beforemiddleafter']);
    });

    it('should leave non-string params unchanged', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await dbModule.query('SELECT $1, $2, $3', [42, true, null]);

      expect(mockPoolQuery).toHaveBeenCalledWith('SELECT $1, $2, $3', [42, true, null]);
    });

    it('should handle undefined params', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await dbModule.query('SELECT 1');

      expect(mockPoolQuery).toHaveBeenCalledWith('SELECT 1', undefined);
    });

    it('should handle mixed string and non-string params', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await dbModule.query('INSERT INTO t VALUES ($1, $2, $3)', ['clean\0text', 123, 'normal']);

      expect(mockPoolQuery).toHaveBeenCalledWith(
        'INSERT INTO t VALUES ($1, $2, $3)',
        ['cleantext', 123, 'normal'],
      );
    });
  });

  // ── query ──

  describe('query', () => {
    let dbModule: typeof import('../../src/db/index');

    beforeEach(async () => {
      vi.resetModules();
      vi.clearAllMocks();
      dbModule = await import('../../src/db/index');
      await dbModule.initDb();
    });

    afterEach(async () => {
      await dbModule.closeDb();
    });

    it('should return rows from the query result', async () => {
      const rows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
      mockPoolQuery.mockResolvedValue({ rows, rowCount: 2 });

      const result = await dbModule.query('SELECT * FROM users');

      expect(result).toEqual(rows);
    });

    it('should pass params to pool.query', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await dbModule.query('SELECT * FROM users WHERE id = $1', ['user-1']);

      expect(mockPoolQuery).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = $1',
        ['user-1'],
      );
    });

    it('should return empty array when no rows match', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await dbModule.query('SELECT * FROM users WHERE id = $1', ['nonexistent']);
      expect(result).toEqual([]);
    });

    it('should propagate database errors', async () => {
      mockPoolQuery.mockRejectedValue(new Error('relation "users" does not exist'));

      await expect(dbModule.query('SELECT * FROM users')).rejects.toThrow(
        'relation "users" does not exist',
      );
    });
  });

  // ── queryOne ──

  describe('queryOne', () => {
    let dbModule: typeof import('../../src/db/index');

    beforeEach(async () => {
      vi.resetModules();
      vi.clearAllMocks();
      dbModule = await import('../../src/db/index');
      await dbModule.initDb();
    });

    afterEach(async () => {
      await dbModule.closeDb();
    });

    it('should return the first row', async () => {
      const rows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
      mockPoolQuery.mockResolvedValue({ rows, rowCount: 2 });

      const result = await dbModule.queryOne('SELECT * FROM users LIMIT 1');
      expect(result).toEqual({ id: 1, name: 'Alice' });
    });

    it('should return undefined when no rows match', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await dbModule.queryOne('SELECT * FROM users WHERE id = $1', ['nope']);
      expect(result).toBeUndefined();
    });

    it('should sanitize params', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      await dbModule.queryOne('SELECT * FROM users WHERE name = $1', ['test\0name']);

      expect(mockPoolQuery).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE name = $1',
        ['testname'],
      );
    });
  });

  // ── execute ──

  describe('execute', () => {
    let dbModule: typeof import('../../src/db/index');

    beforeEach(async () => {
      vi.resetModules();
      vi.clearAllMocks();
      dbModule = await import('../../src/db/index');
      await dbModule.initDb();
    });

    afterEach(async () => {
      await dbModule.closeDb();
    });

    it('should return rowCount from result', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 3 });

      const result = await dbModule.execute('DELETE FROM users WHERE active = FALSE');
      expect(result).toEqual({ rowCount: 3 });
    });

    it('should default rowCount to 0 when null', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: null });

      const result = await dbModule.execute('UPDATE users SET active = TRUE');
      expect(result).toEqual({ rowCount: 0 });
    });

    it('should pass params to pool.query', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      await dbModule.execute('UPDATE users SET name = $1 WHERE id = $2', ['Alice', 'u1']);

      expect(mockPoolQuery).toHaveBeenCalledWith(
        'UPDATE users SET name = $1 WHERE id = $2',
        ['Alice', 'u1'],
      );
    });

    it('should sanitize params', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      await dbModule.execute('INSERT INTO t(v) VALUES($1)', ['val\0ue']);

      expect(mockPoolQuery).toHaveBeenCalledWith(
        'INSERT INTO t(v) VALUES($1)',
        ['value'],
      );
    });
  });

  // ── withTransaction ──

  describe('withTransaction', () => {
    let dbModule: typeof import('../../src/db/index');

    const mockClientQuery = vi.fn();
    const mockClientRelease = vi.fn();

    beforeEach(async () => {
      vi.resetModules();
      vi.clearAllMocks();

      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      mockPoolConnect.mockResolvedValue({
        query: mockClientQuery,
        release: mockClientRelease,
      });

      dbModule = await import('../../src/db/index');
      await dbModule.initDb();
    });

    afterEach(async () => {
      await dbModule.closeDb();
    });

    it('should call BEGIN, fn, then COMMIT', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      const result = await dbModule.withTransaction(fn);

      expect(result).toBe('result');

      // BEGIN is the first call on the original (unwrapped) client.query
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call ROLLBACK on error and re-throw', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('something failed'));

      await expect(dbModule.withTransaction(fn)).rejects.toThrow('something failed');

      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientQuery).not.toHaveBeenCalledWith('COMMIT');
    });

    it('should always release the client', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      await dbModule.withTransaction(fn);
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('should release the client even on error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      try {
        await dbModule.withTransaction(fn);
      } catch {
        // expected
      }
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('should return the value from the transaction function', async () => {
      const fn = vi.fn().mockResolvedValue({ inserted: true });
      const result = await dbModule.withTransaction(fn);
      expect(result).toEqual({ inserted: true });
    });

    it('should provide a client with sanitized query to the fn', async () => {
      await dbModule.withTransaction(async (client) => {
        // The client passed to fn should have a wrapped query that sanitizes params
        await client.query('INSERT INTO t VALUES ($1)', ['has\0null']);
      });

      // The original client.query should receive sanitized params
      // One of the calls should have the sanitized param
      const insertCall = mockClientQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT'),
      );
      expect(insertCall).toBeTruthy();
      expect(insertCall![1]).toEqual(['hasnull']);
    });
  });

  // ── initDb ──

  describe('initDb', () => {
    it('should create a Pool and run migrations', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();

      expect(Pool).toHaveBeenCalledTimes(1);
      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://localhost:5432/tinyhands_test',
          max: 3,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 5000,
        }),
      );
      expect(mockRunMigrations).toHaveBeenCalledTimes(1);

      await dbModule.closeDb();
    });

    it('should not create a new Pool if already initialized', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();
      await dbModule.initDb(); // second call

      expect(Pool).toHaveBeenCalledTimes(1);
      expect(mockRunMigrations).toHaveBeenCalledTimes(1);

      await dbModule.closeDb();
    });

    it('should enable SSL when connection string contains sslmode', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      (config as any).database.url = 'postgresql://host:5432/db?sslmode=require';
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();

      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: false },
          // sslmode should be stripped from connection string
          connectionString: 'postgresql://host:5432/db',
        }),
      );

      await dbModule.closeDb();
      // Restore
      (config as any).database.url = 'postgresql://localhost:5432/tinyhands_test';
    });

    it('should use per-process pool sizing based on PROCESS_TYPE', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      process.env.PROCESS_TYPE = 'scheduler';
      delete process.env.DB_POOL_MAX;
      (config as any).database.url = 'postgresql://localhost:5432/tinyhands_test';
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();

      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({ max: 1 }),
      );

      await dbModule.closeDb();
      delete process.env.PROCESS_TYPE;
    });

    it('should override per-process sizing when DB_POOL_MAX is set', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      process.env.PROCESS_TYPE = 'scheduler';
      process.env.DB_POOL_MAX = '5';
      (config as any).database.url = 'postgresql://localhost:5432/tinyhands_test';
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();

      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({ max: 5 }),
      );

      await dbModule.closeDb();
      delete process.env.PROCESS_TYPE;
      delete process.env.DB_POOL_MAX;
    });

    it('should use DATABASE_POOL_URL when available', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      process.env.DATABASE_POOL_URL = 'postgresql://localhost:6432/tinyhands_pooler';
      (config as any).database.url = 'postgresql://localhost:5432/tinyhands_test';
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();

      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://localhost:6432/tinyhands_pooler',
        }),
      );

      await dbModule.closeDb();
      delete process.env.DATABASE_POOL_URL;
    });

    it('should not enable SSL when sslmode is absent', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      (config as any).database.url = 'postgresql://localhost:5432/tinyhands_test';
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();

      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: undefined,
        }),
      );

      await dbModule.closeDb();
    });

    it('should strip sslmode with & separator', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      (config as any).database.url = 'postgresql://host:5432/db?connect_timeout=10&sslmode=require';
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();

      const poolCall = (Pool as any).mock.calls[0][0];
      expect(poolCall.connectionString).toBe('postgresql://host:5432/db?connect_timeout=10');
      expect(poolCall.ssl).toEqual({ rejectUnauthorized: false });

      await dbModule.closeDb();
      (config as any).database.url = 'postgresql://localhost:5432/tinyhands_test';
    });
  });

  // ── closeDb ──

  describe('closeDb', () => {
    it('should call pool.end() and reset pool', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();
      await dbModule.closeDb();

      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call multiple times', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      const dbModule = await import('../../src/db/index');

      await dbModule.initDb();
      await dbModule.closeDb();
      await dbModule.closeDb(); // second call should be no-op

      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call without initDb', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      const dbModule = await import('../../src/db/index');

      // Should not throw
      await dbModule.closeDb();

      expect(mockPoolEnd).not.toHaveBeenCalled();
    });
  });

  // ── pool resilience ──

  describe('pool resilience', () => {
    let dbModule: typeof import('../../src/db/index');

    beforeEach(async () => {
      vi.resetModules();
      vi.clearAllMocks();
      dbModule = await import('../../src/db/index');
      await dbModule.initDb();
    });

    afterEach(async () => {
      await dbModule.closeDb();
    });

    it('should reset counter on successful query', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      await dbModule.query('SELECT 1');
      await dbModule.query('SELECT 2');

      // No pool recreation should have occurred — only 1 Pool created (in initDb)
      expect(Pool).toHaveBeenCalledTimes(1);
    });

    it('should recreate pool after 3 consecutive connection failures', async () => {
      const connError = new Error('timeout');
      (connError as any).code = 'ETIMEDOUT';

      // First 3 calls fail (hitting the threshold), 4th succeeds on new pool
      mockPoolQuery
        .mockRejectedValueOnce(connError)
        .mockRejectedValueOnce(connError)
        .mockRejectedValueOnce(connError) // triggers reset, then retries
        .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });

      await expect(dbModule.query('SELECT 1')).rejects.toThrow('timeout');
      await expect(dbModule.query('SELECT 1')).rejects.toThrow('timeout');
      // Third failure triggers pool reset + retry on new pool
      const result = await dbModule.query('SELECT 1');
      expect(result).toEqual([{ ok: true }]);

      // Pool was created once in initDb, once in reset
      expect(Pool).toHaveBeenCalledTimes(2);
    });

    it('should recognize "remaining connection slots" as a connection error', async () => {
      const slotsError = new Error('remaining connection slots are reserved for roles with the SUPERUSER attribute');

      mockPoolQuery
        .mockRejectedValueOnce(slotsError)
        .mockRejectedValueOnce(slotsError)
        .mockRejectedValueOnce(slotsError) // triggers reset
        .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });

      await expect(dbModule.query('SELECT 1')).rejects.toThrow('remaining connection slots');
      await expect(dbModule.query('SELECT 1')).rejects.toThrow('remaining connection slots');
      const result = await dbModule.query('SELECT 1');
      expect(result).toEqual([{ ok: true }]);

      // Pool was created once in initDb, once in reset
      expect(Pool).toHaveBeenCalledTimes(2);
    });

    it('should not reset pool for non-connection errors', async () => {
      const dbError = new Error('relation "users" does not exist');
      mockPoolQuery
        .mockRejectedValueOnce(dbError)
        .mockRejectedValueOnce(dbError)
        .mockRejectedValueOnce(dbError);

      await expect(dbModule.query('SELECT 1')).rejects.toThrow('relation');
      await expect(dbModule.query('SELECT 1')).rejects.toThrow('relation');
      await expect(dbModule.query('SELECT 1')).rejects.toThrow('relation');

      // No reset — only the original pool
      expect(Pool).toHaveBeenCalledTimes(1);
    });

    it('should reset failure counter after a successful query', async () => {
      const connError = new Error('connection refused');
      (connError as any).code = 'ECONNREFUSED';

      // 2 failures, then success, then 2 more failures — should NOT trigger reset
      mockPoolQuery
        .mockRejectedValueOnce(connError)
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockRejectedValueOnce(connError)
        .mockRejectedValueOnce(connError);

      await expect(dbModule.query('Q')).rejects.toThrow();
      await expect(dbModule.query('Q')).rejects.toThrow();
      await dbModule.query('Q'); // success resets counter
      await expect(dbModule.query('Q')).rejects.toThrow();
      await expect(dbModule.query('Q')).rejects.toThrow();

      // No pool reset happened
      expect(Pool).toHaveBeenCalledTimes(1);
    });

    it('should handle pool reset for withTransaction connect failures', async () => {
      const connError = new Error('connection refused');
      (connError as any).code = 'ECONNREFUSED';

      const mockClientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
      const mockClientRelease = vi.fn();

      // Use regular query failures to bump counter to 2
      mockPoolQuery.mockRejectedValueOnce(connError).mockRejectedValueOnce(connError);
      await expect(dbModule.query('Q')).rejects.toThrow();
      await expect(dbModule.query('Q')).rejects.toThrow();

      // Third failure via withTransaction connect triggers reset, then retry succeeds
      mockPoolConnect
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce({
          query: mockClientQuery,
          release: mockClientRelease,
        });

      const result = await dbModule.withTransaction(async () => 'done');
      expect(result).toBe('done');
      expect(Pool).toHaveBeenCalledTimes(2);
    });
  });

  // ── getPool error ──

  describe('getPool (uninitialized)', () => {
    it('should throw when query is called without initDb', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      const dbModule = await import('../../src/db/index');

      await expect(dbModule.query('SELECT 1')).rejects.toThrow(
        'Database not initialized. Call initDb() first.',
      );
    });

    it('should throw when queryOne is called without initDb', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      const dbModule = await import('../../src/db/index');

      await expect(dbModule.queryOne('SELECT 1')).rejects.toThrow(
        'Database not initialized',
      );
    });

    it('should throw when execute is called without initDb', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      const dbModule = await import('../../src/db/index');

      await expect(dbModule.execute('DELETE FROM t')).rejects.toThrow(
        'Database not initialized',
      );
    });

    it('should throw when withTransaction is called without initDb', async () => {
      vi.resetModules();
      vi.clearAllMocks();
      const dbModule = await import('../../src/db/index');

      await expect(
        dbModule.withTransaction(async () => 'nope'),
      ).rejects.toThrow('Database not initialized');
    });
  });
});
