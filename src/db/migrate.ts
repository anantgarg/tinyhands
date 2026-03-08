import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export async function runMigrations(pool: Pool): Promise<void> {
  // Create schema_migrations table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Read migration files sorted by numeric prefix
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const versionMatch = file.match(/^(\d+)/);
    if (!versionMatch) continue;
    const version = parseInt(versionMatch[1], 10);

    // Check if already applied
    const applied = await pool.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version]
    );
    if (applied.rows.length > 0) continue;

    // Run migration inside a transaction
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)',
        [version, file]
      );
      await client.query('COMMIT');
      console.log(`Migration ${file} applied`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err}`);
    } finally {
      client.release();
    }
  }
}

// Standalone entry point for `npm run migrate`
if (require.main === module) {
  (async () => {
    // Load .env when run standalone
    try { (await import('dotenv')).config(); } catch {}
    const { config } = await import('../config');
    const connectionString = config.database.url;
    const ssl = connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined;

    const pool = new Pool({ connectionString, ssl });
    try {
      await runMigrations(pool);
      console.log('All migrations applied');
    } catch (err) {
      console.error('Migration failed:', err);
      process.exit(1);
    } finally {
      await pool.end();
    }
  })();
}
