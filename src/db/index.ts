import { Pool, PoolClient } from 'pg';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';

let pool: Pool | null = null;
let poolConfig: { connectionString: string; ssl: any; max: number; application_name: string } | null = null;
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_RESET = 3;

// resetPool safeguards
let resetInProgress = false;
let lastResetTime = 0;
let resetCount = 0;
let resetWindowStart = 0;
const RESET_COOLDOWN_MS = 30000; // 30 seconds
const MAX_RESETS = 3;
const RESET_WINDOW_MS = 5 * 60 * 1000; // 5 minutes — reset the breaker counter after this

// Pool health logging interval handle
let healthInterval: ReturnType<typeof setInterval> | undefined;

function isConnectionError(err: any): boolean {
  const msg = (err.message || '').toLowerCase();
  const code = err.code || '';
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' ||
    msg.includes('timeout') || msg.includes('connection terminated') ||
    msg.includes('connection refused') || msg.includes('cert') ||
    msg.includes('ssl') || msg.includes('unexpected eof') ||
    msg.includes('remaining connection slots');
}

function createPool(): Pool {
  if (!poolConfig) throw new Error('Database not initialized. Call initDb() first.');
  const p = new Pool({
    ...poolConfig,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  p.on('error', (err) => {
    logger.error('Idle database connection error', { error: err.message });
  });
  return p;
}

async function resetPool(): Promise<void> {
  if (!poolConfig) return;

  // Mutex: prevent concurrent resets
  if (resetInProgress) {
    logger.warn('Pool reset already in progress, skipping');
    return;
  }

  // Rate limit: no more than once per 30 seconds
  const now = Date.now();
  if (now - lastResetTime < RESET_COOLDOWN_MS) {
    logger.warn('Pool reset rate limited, last reset was too recent');
    return;
  }

  // Circuit breaker: stop after MAX_RESETS within the window, but auto-recover after window expires
  if (resetCount >= MAX_RESETS) {
    if (now - resetWindowStart > RESET_WINDOW_MS) {
      // Window expired — reset the breaker and allow retries
      logger.info('Pool reset circuit breaker recovered — window expired, allowing retries');
      resetCount = 0;
      resetWindowStart = now;
    } else {
      logger.error('Pool reset circuit breaker tripped — too many resets, waiting for recovery window', { resetCount });
      return;
    }
  }

  resetInProgress = true;
  try {
    const old = pool;
    // Set pool to null during reset so queries fail fast instead of hanging
    pool = null;

    // Close old pool first (with 5s timeout)
    if (old) {
      await Promise.race([
        old.end().catch(() => {}),
        new Promise<void>(resolve => setTimeout(resolve, 5000)),
      ]);
    }

    // Create new pool
    pool = createPool();
    consecutiveFailures = 0;
    resetCount++;
    lastResetTime = Date.now();
    if (resetCount === 1) resetWindowStart = lastResetTime;
    logger.info('Database pool recreated', { resetCount });
  } finally {
    resetInProgress = false;
  }
}

/**
 * Per-process pool sizing: not all processes need the same number of connections.
 * Workers handle heavy concurrent queries; scheduler/sync are lightweight.
 * Defaults (total = 1 + 3×3 + 1 + 1 = 12, well under DigitalOcean's 25-connection limit):
 *   listener=2, worker=3, scheduler=1, sync=1
 * Override with DB_POOL_MAX env var to set all processes uniformly.
 */
function getPoolMaxForProcess(): number {
  if (process.env.DB_POOL_MAX) return parseInt(process.env.DB_POOL_MAX, 10);
  const processType = process.env.PROCESS_TYPE || '';
  switch (processType) {
    case 'scheduler': return 1;
    case 'sync': return 1;
    case 'listener': return 2;
    case 'worker': return 3;
    default: return 2;
  }
}

export async function initDb(): Promise<void> {
  if (pool) return;

  // Use DATABASE_POOL_URL (PgBouncer) if available, otherwise direct connection
  let connectionString = config.database.poolUrl || process.env.DATABASE_POOL_URL || config.database.url;
  const needsSsl = connectionString.includes('sslmode=');
  // Strip sslmode from connection string — pg v8.13+ treats it as verify-full
  connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');

  const poolMax = getPoolMaxForProcess();
  const processType = process.env.PROCESS_TYPE || 'unknown';
  const appName = `tinyhands-${processType}-pid${process.pid}`;

  poolConfig = {
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: poolMax,
    application_name: appName,
  };

  pool = createPool();

  // Pool health logging — every 5 minutes
  healthInterval = setInterval(() => {
    if (pool) {
      logger.info('Pool health', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      });
    }
  }, 5 * 60 * 1000);
  healthInterval.unref();

  // Run migrations (always against the direct URL, not PgBouncer — DDL needs direct)
  const migrationString = config.database.url.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');
  const usingPoolUrl = !!(config.database.poolUrl || process.env.DATABASE_POOL_URL);
  if (usingPoolUrl && migrationString !== connectionString) {
    const { Pool: PgPool } = await import('pg');
    const migrationPool = new PgPool({
      connectionString: migrationString,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 1,
    });
    const { runMigrations } = await import('./migrate');
    await runMigrations(migrationPool);
    await migrationPool.end();
  } else {
    const { runMigrations } = await import('./migrate');
    await runMigrations(pool);
  }
}

function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return pool;
}

async function resilientQuery(sql: string, params?: any[]): Promise<any> {
  try {
    const result = await getPool().query(sql, sanitizeParams(params));
    consecutiveFailures = 0;
    return result;
  } catch (err: any) {
    if (isConnectionError(err)) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES_BEFORE_RESET) {
        logger.warn('Multiple consecutive DB failures, resetting pool', { failures: consecutiveFailures });
        await resetPool();
        // Retry once with fresh pool
        const result = await getPool().query(sql, sanitizeParams(params));
        consecutiveFailures = 0;
        return result;
      }
    }
    throw err;
  }
}

// Strip null bytes from string params — Postgres TEXT columns reject 0x00
function sanitizeParams(params?: any[]): any[] | undefined {
  if (!params) return params;
  return params.map(p => (typeof p === 'string' ? p.replace(/\0/g, '') : p));
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const result = await resilientQuery(sql, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
  const result = await resilientQuery(sql, params);
  return result.rows[0] as T | undefined;
}

export async function execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
  const result = await resilientQuery(sql, params);
  return { rowCount: result.rowCount || 0 };
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (err: any) {
    if (isConnectionError(err)) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES_BEFORE_RESET) {
        logger.warn('Transaction connect failed, resetting pool', { failures: consecutiveFailures });
        await resetPool();
        client = await getPool().connect();
        consecutiveFailures = 0;
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
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
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = undefined;
  }
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
