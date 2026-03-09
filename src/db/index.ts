import { Pool, PoolClient } from 'pg';
import path from 'path';
import { config } from '../config';

let pool: Pool | null = null;

export async function initDb(): Promise<void> {
  if (pool) return;

  let connectionString = config.database.url;
  const needsSsl = connectionString.includes('sslmode=');
  // Strip sslmode from connection string — pg v8.13+ treats it as verify-full
  connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');

  pool = new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Run migrations
  const { runMigrations } = await import('./migrate');
  await runMigrations(pool);
}

function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return pool;
}

// Strip null bytes from string params — Postgres TEXT columns reject 0x00
function sanitizeParams(params?: any[]): any[] | undefined {
  if (!params) return params;
  return params.map(p => (typeof p === 'string' ? p.replace(/\0/g, '') : p));
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const result = await getPool().query(sql, sanitizeParams(params));
  return result.rows as T[];
}

export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
  const result = await getPool().query(sql, sanitizeParams(params));
  return result.rows[0] as T | undefined;
}

export async function execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
  const result = await getPool().query(sql, sanitizeParams(params));
  return { rowCount: result.rowCount || 0 };
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  // Wrap client.query to sanitize params, preventing null byte errors
  const originalQuery = client.query.bind(client);
  (client as any).query = (sql: any, params?: any) => {
    return originalQuery(sql, sanitizeParams(params));
  };
  try {
    await originalQuery('BEGIN');
    const result = await fn(client);
    await originalQuery('COMMIT');
    return result;
  } catch (err) {
    await originalQuery('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
