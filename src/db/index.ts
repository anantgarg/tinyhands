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

  // DigitalOcean managed DB allows 25 connections total.
  // With 6 PM2 processes, each gets floor(25/6) - 1 = 3 to stay safely under the limit.
  // Configurable via DB_POOL_MAX for when the DB plan is upgraded.
  const poolMax = parseInt(process.env.DB_POOL_MAX || '3', 10);

  pool = new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: poolMax,
    idleTimeoutMillis: 10000,
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

// ── Workspace Context ──

let defaultWorkspaceId: string | null = null;

export function setDefaultWorkspaceId(id: string): void {
  defaultWorkspaceId = id;
}

export function getDefaultWorkspaceId(): string {
  if (!defaultWorkspaceId) throw new Error('Workspace not initialized. Call setDefaultWorkspaceId() first.');
  return defaultWorkspaceId;
}

export function getDefaultWorkspaceIdOrNull(): string | null {
  return defaultWorkspaceId;
}

// ── Workspace CRUD (core) ──

export interface WorkspaceRecord {
  id: string;
  team_name: string;
  domain: string | null;
  bot_token: string;
  bot_user_id: string;
  bot_id: string | null;
  app_id: string | null;
  authed_user_id: string | null;
  scope: string | null;
  status: string;
  installed_at: string;
  updated_at: string;
}

export async function upsertWorkspace(data: {
  id: string;
  team_name: string;
  domain?: string;
  bot_token: string;
  bot_user_id: string;
  bot_id?: string;
  app_id?: string;
  authed_user_id?: string;
  scope?: string;
  status?: string;
}): Promise<WorkspaceRecord> {
  const row = await queryOne<WorkspaceRecord>(
    `INSERT INTO workspaces (id, team_name, domain, bot_token, bot_user_id, bot_id, app_id, authed_user_id, scope, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       team_name = EXCLUDED.team_name,
       domain = COALESCE(EXCLUDED.domain, workspaces.domain),
       bot_token = EXCLUDED.bot_token,
       bot_user_id = EXCLUDED.bot_user_id,
       bot_id = COALESCE(EXCLUDED.bot_id, workspaces.bot_id),
       updated_at = NOW()
     RETURNING *`,
    [data.id, data.team_name, data.domain || null, data.bot_token, data.bot_user_id,
     data.bot_id || null, data.app_id || null, data.authed_user_id || null,
     data.scope || null, data.status || 'active']
  );
  return row!;
}

export async function getWorkspace(teamId: string): Promise<WorkspaceRecord | undefined> {
  return queryOne<WorkspaceRecord>('SELECT * FROM workspaces WHERE id = $1', [teamId]);
}

export async function listActiveWorkspaces(): Promise<WorkspaceRecord[]> {
  return query<WorkspaceRecord>("SELECT * FROM workspaces WHERE status = 'active'");
}
