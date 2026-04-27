import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

// End-to-end coverage of the Database feature: schema-per-workspace creation,
// CSV import with type inference, all read tool ops (select / aggregate /
// raw read-only SQL), structured write ops (insert / update / delete), and
// the hard isolation guarantee — workspace A cannot see workspace B's tables
// even by trying to fully qualify a cross-schema reference in raw SQL.

let container: StartedTestContainer;
let pool: Pool;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    team_name TEXT NOT NULL,
    domain TEXT,
    bot_token TEXT NOT NULL,
    bot_user_id TEXT NOT NULL,
    bot_id TEXT,
    app_id TEXT,
    authed_user_id TEXT,
    scope TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS workspace_settings (
    workspace_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, key)
  );

  CREATE TABLE IF NOT EXISTS database_tables (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at TIMESTAMPTZ,
    last_sync_status TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, name)
  );

  CREATE TABLE IF NOT EXISTS database_sync_log (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    table_id TEXT NOT NULL,
    status TEXT NOT NULL,
    rows_imported INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const url = `postgresql://test:test@${host}:${port}/test`;

  pool = new Pool({ connectionString: url });
  await pool.query(SCHEMA);

  process.env.DATABASE_URL = url;
  // The db module's runMigrations would try to read .sql files from disk and
  // re-create these tables. We've already created the schema above, so we
  // skip migrations by stubbing it. The simpler path: just make sure the env
  // var is set BEFORE the db module loads, then call initDb() will try to
  // run migrations — but since we don't want that, we set a flag.
  process.env.SKIP_MIGRATIONS_FOR_TEST = '1';
  process.env.PROCESS_TYPE = 'worker';
}, 60000);

afterAll(async () => {
  if (pool) await pool.end();
  if (container) await container.stop();
});

const W_A = 'TWORKAAAA';
const W_B = 'TWORKBBBB';

describe('Database feature — end-to-end', () => {
  it('creates a workspace-scoped schema and table, isolates writes, and rejects cross-schema reads', async () => {
    // Use the raw pool directly — wire the test pool into the db module.
    // We'd ideally call initDb(), but that runs migrations from disk; for
    // this test we configure the test pool manually via setDefaultWorkspaceId
    // and direct queries from our own pool.
    await pool.query(`INSERT INTO workspaces (id, team_name, bot_token, bot_user_id) VALUES ($1, 'A', 'xoxb', 'U') ON CONFLICT (id) DO NOTHING`, [W_A]);
    await pool.query(`INSERT INTO workspaces (id, team_name, bot_token, bot_user_id) VALUES ($1, 'B', 'xoxb', 'U') ON CONFLICT (id) DO NOTHING`, [W_B]);

    // Manually configure the db module's pool to use our test connection so
    // module functions hit our testcontainer instead of trying to open their
    // own pool from process.env.DATABASE_URL.
    const dbModule = await import('../../src/db');
    // initDb sets up its own pool; our env var DATABASE_URL points at the
    // testcontainer, so this is fine. It also runs migrations — those will
    // try to find files under src/db/migrations. Since the migration runner
    // is idempotent and our schema already has the required base tables,
    // it'll create the others (db_tables, db_sync_log, etc) without
    // conflict.
    try { await dbModule.initDb(); } catch { /* migrations may have already run */ }
    dbModule.setDefaultWorkspaceId(W_A);

    const { createTable, getTableByName } = await import('../../src/modules/database');
    const t = await createTable(W_A, {
      name: 'customers',
      columns: [
        { name: 'name', type: 'text' },
        { name: 'tier', type: 'text' },
        { name: 'mrr', type: 'numeric' },
      ],
    });
    expect(t.name).toBe('customers');

    // The schema and table physically exist.
    const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [
      `ws_${W_A.toLowerCase()}`, 'customers',
    ]);
    expect(r.rowCount).toBe(1);

    // Insert via the rows API.
    const { insertRow, selectRows, aggregate, deleteRow, updateRow } = await import('../../src/modules/database');
    await insertRow(W_A, 'customers', { name: 'Alice', tier: 'gold', mrr: 100 });
    await insertRow(W_A, 'customers', { name: 'Bob', tier: 'silver', mrr: 50 });
    await insertRow(W_A, 'customers', { name: 'Carol', tier: 'gold', mrr: 200 });

    const sel = await selectRows(W_A, 'customers');
    expect(sel.total).toBe(3);

    // Aggregate: sum mrr by tier.
    const agg = await aggregate(W_A, 'customers', { fn: 'sum', column: 'mrr', groupBy: 'tier' });
    const byTier: Record<string, number> = {};
    for (const r of agg.rows) byTier[r.group_value] = Number(r.value);
    expect(byTier.gold).toBe(300);
    expect(byTier.silver).toBe(50);

    // Update one row, then verify.
    await updateRow(W_A, 'customers', sel.rows[0].id, { mrr: 999 });
    const updated = await selectRows(W_A, 'customers', { where: { id: sel.rows[0].id } });
    expect(Number(updated.rows[0].mrr)).toBe(999);

    // Delete one row.
    await deleteRow(W_A, 'customers', sel.rows[1].id);
    const after = await selectRows(W_A, 'customers');
    expect(after.total).toBe(2);

    // Read-only raw SELECT works.
    const { runReadOnlySql } = await import('../../src/modules/database');
    const sql = await runReadOnlySql(W_A, 'SELECT count(*)::int AS c FROM customers');
    expect(sql.rows[0].c).toBe(2);

    // Cross-schema reads from workspace B targeting workspace A must fail.
    const wsBSchema = `ws_${W_B.toLowerCase()}`;
    const wsASchema = `ws_${W_A.toLowerCase()}`;
    // First, B has no tables of its own — make sure that's true.
    const bTables = await pool.query(
      `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = $1`,
      [wsBSchema],
    );
    expect(bTables.rows[0].c).toBe(0);

    // Even if B's agent tries to fully qualify, it must be rejected.
    await expect(
      runReadOnlySql(W_B, `SELECT * FROM ${wsASchema}.customers`),
    ).rejects.toThrow(/Cross-schema/i);

    // And an unqualified reference from B's runner cannot find the table —
    // search_path is pinned to B's schema, which has no customers table.
    await expect(
      runReadOnlySql(W_B, `SELECT * FROM customers`),
    ).rejects.toThrow();

    // DDL is rejected by the read-only runner regardless of workspace.
    await expect(runReadOnlySql(W_A, 'DROP TABLE customers')).rejects.toThrow();
    await expect(runReadOnlySql(W_A, 'INSERT INTO customers VALUES (1)')).rejects.toThrow();
  }, 120000);

  it('imports a CSV with type inference and reports rowsImported / rowsSkipped', async () => {
    const { importCsv } = await import('../../src/modules/database');
    const csv = [
      'name,age,active',
      'Alice,30,true',
      'Bob,25,false',
      'Carol,not_a_number,true',  // bad row — age is integer
    ].join('\n');
    const result = await importCsv({
      workspaceId: W_A,
      tableName: 'people',
      csvText: csv,
    });
    expect(result.rowsImported).toBe(2);
    expect(result.rowsSkipped).toBe(1);
    expect(result.issues.length).toBeGreaterThan(0);
  }, 60000);
});
