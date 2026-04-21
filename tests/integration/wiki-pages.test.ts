/**
 * Integration test for the wiki page storage + optimistic locking.
 *
 * Spins a real PostgreSQL 16 via testcontainers, applies the kb_wiki_*
 * schema, and exercises:
 *   1. Upsert flow (create + update with version snapshot).
 *   2. Optimistic conflict detection via expected_prior_revision.
 *   3. Archived-page exclusion from the default list.
 *   4. Uniqueness on (workspace_id, namespace, source_kind, source_id).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

let container: StartedTestContainer;
let pool: Pool;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kb_wiki_pages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    namespace TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    frontmatter JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_ref JSONB,
    updated_by TEXT NOT NULL DEFAULT 'llm',
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS kb_wiki_pages_path_uniq
    ON kb_wiki_pages (workspace_id, namespace, path);
  CREATE UNIQUE INDEX IF NOT EXISTS kb_wiki_pages_source_uniq
    ON kb_wiki_pages (workspace_id, namespace, (source_ref->>'source_kind'), (source_ref->>'source_id'))
    WHERE source_ref IS NOT NULL;

  CREATE TABLE IF NOT EXISTS kb_wiki_page_versions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES kb_wiki_pages(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    frontmatter JSONB NOT NULL DEFAULT '{}'::jsonb,
    rationale TEXT,
    changed_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS kb_wiki_page_versions_uniq
    ON kb_wiki_page_versions (page_id, version);
`;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  pool = new Pool({ host, port, user: 'test', password: 'test', database: 'test' });
  await pool.query(SCHEMA);

  // Mock @/db so the module-under-test uses our test pool.
  const { vi } = await import('vitest');
  vi.doMock('../../src/db', () => ({
    execute: (sql: string, params: any[] = []) => pool.query(sql, params).then(r => ({ rowCount: r.rowCount })),
    query: <T = any>(sql: string, params: any[] = []) => pool.query(sql, params).then(r => r.rows as T[]),
    queryOne: (sql: string, params: any[] = []) => pool.query(sql, params).then(r => r.rows[0] || null),
    withTransaction: async <T>(fn: (client: any) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  }));
}, 120_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (container) await container.stop();
});

describe('Wiki pages — integration', () => {
  it('inserts, updates, and version-snapshots a page', async () => {
    const { upsertPage, listVersions } = await import('../../src/modules/kb-wiki/pages');

    const v1 = await upsertPage('w1', 'kb', {
      path: 'entities/acme.md', kind: 'entity', title: 'Acme',
      content: 'initial', updated_by: 'llm',
    });
    expect(v1.path).toBe('entities/acme.md');

    const v2 = await upsertPage('w1', 'kb', {
      path: 'entities/acme.md', kind: 'entity', title: 'Acme Updated',
      content: 'updated', updated_by: 'llm',
      expected_prior_revision: v1.updated_at,
      rationale: 'clarified',
    });
    expect(v2.title).toBe('Acme Updated');

    const versions = await listVersions(v1.id);
    expect(versions.length).toBe(2);
    expect(versions[0].version).toBe(2);
  });

  it('rejects an update when expected_prior_revision mismatches', async () => {
    const { upsertPage, OptimisticConflictError } = await import('../../src/modules/kb-wiki/pages');

    const created = await upsertPage('w1', 'kb', {
      path: 'entities/contested.md', kind: 'entity', title: 'Contested',
      content: 'v1', updated_by: 'llm',
    });
    // Someone else writes first
    await upsertPage('w1', 'kb', {
      path: 'entities/contested.md', kind: 'entity', title: 'Winner',
      content: 'v2', updated_by: 'llm',
      expected_prior_revision: created.updated_at,
    });
    // Our stale write should now conflict
    await expect(upsertPage('w1', 'kb', {
      path: 'entities/contested.md', kind: 'entity', title: 'Loser',
      content: 'stale', updated_by: 'llm',
      expected_prior_revision: created.updated_at,
    })).rejects.toBeInstanceOf(OptimisticConflictError);
  });

  it('enforces one source page per (workspace, namespace, source_kind, source_id)', async () => {
    const { upsertPage } = await import('../../src/modules/kb-wiki/pages');

    await upsertPage('w2', 'kb', {
      path: 'sources/doc-abc.md', kind: 'source', title: 'Doc ABC',
      content: 'first', source_ref: { source_kind: 'drive_file', source_id: 'abc', revision: 'r1' },
      updated_by: 'llm',
    });
    // Attempting a second page with the same source_ref but a different path
    // must fail — the partial unique index on source_ref prevents it.
    await expect(pool.query(
      `INSERT INTO kb_wiki_pages (id, workspace_id, namespace, path, kind, title, source_ref)
         VALUES ('dup', 'w2', 'kb', 'sources/doc-abc-duplicate.md', 'source', 'dup', '{"source_kind":"drive_file","source_id":"abc","revision":"r2"}')`,
    )).rejects.toThrow(/unique|duplicate/i);
  });

  it('excludes archived pages from the default list', async () => {
    const { upsertPage, archivePage, listPages } = await import('../../src/modules/kb-wiki/pages');

    await upsertPage('w3', 'docs', {
      path: 'entities/keep.md', kind: 'entity', title: 'Keep',
      content: 'visible', updated_by: 'llm',
    });
    await upsertPage('w3', 'docs', {
      path: 'entities/remove.md', kind: 'entity', title: 'Remove',
      content: 'gone', updated_by: 'llm',
    });
    await archivePage('w3', 'docs', 'entities/remove.md');

    const visible = await listPages('w3', 'docs');
    expect(visible.map(p => p.path)).toContain('entities/keep.md');
    expect(visible.map(p => p.path)).not.toContain('entities/remove.md');

    const all = await listPages('w3', 'docs', { includeArchived: true });
    expect(all.map(p => p.path)).toContain('entities/remove.md');
  });
});
