/**
 * Wiki page CRUD with version snapshots.
 *
 * Reads filter out archived pages by default. Writes use an optimistic
 * `expected_prior_revision` check to detect concurrent edits — see §13 of
 * the plan and the apply path in ingest.ts.
 */
import { v4 as uuid } from 'uuid';
import { execute, query, queryOne, withTransaction } from '../../db';
import { logger } from '../../utils/logger';
import type { WikiNamespace, WikiPage, WikiPageKind } from '../../types';

const MAX_PAGE_VERSIONS = 50;

export interface ListPagesOpts {
  kind?: WikiPageKind;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export async function listPages(workspaceId: string, namespace: WikiNamespace, opts: ListPagesOpts = {}): Promise<WikiPage[]> {
  const where: string[] = ['workspace_id = $1', 'namespace = $2'];
  const params: any[] = [workspaceId, namespace];
  let idx = 3;
  if (!opts.includeArchived) where.push('archived_at IS NULL');
  if (opts.kind) { where.push(`kind = $${idx++}`); params.push(opts.kind); }
  const limit = Math.min(opts.limit ?? 200, 1000);
  const offset = opts.offset ?? 0;
  const rows = await query<any>(
    `SELECT * FROM kb_wiki_pages WHERE ${where.join(' AND ')} ORDER BY path LIMIT $${idx++} OFFSET $${idx}`,
    [...params, limit, offset],
  );
  return rows.map(deserialize);
}

export async function getPage(workspaceId: string, namespace: WikiNamespace, pathOrId: string): Promise<WikiPage | null> {
  // Try by path first, then by id
  let row = await queryOne<any>(
    `SELECT * FROM kb_wiki_pages WHERE workspace_id = $1 AND namespace = $2 AND path = $3`,
    [workspaceId, namespace, pathOrId],
  );
  if (!row) {
    row = await queryOne<any>(
      `SELECT * FROM kb_wiki_pages WHERE workspace_id = $1 AND namespace = $2 AND id = $3`,
      [workspaceId, namespace, pathOrId],
    );
  }
  return row ? deserialize(row) : null;
}

export async function getPageBySource(
  workspaceId: string, namespace: WikiNamespace,
  sourceKind: string, sourceId: string,
): Promise<WikiPage | null> {
  const row = await queryOne<any>(
    `SELECT * FROM kb_wiki_pages
       WHERE workspace_id = $1 AND namespace = $2
         AND source_ref->>'source_kind' = $3
         AND source_ref->>'source_id' = $4`,
    [workspaceId, namespace, sourceKind, sourceId],
  );
  return row ? deserialize(row) : null;
}

export interface UpsertPageInput {
  path: string;
  kind: WikiPageKind;
  title: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  source_ref?: WikiPage['source_ref'];
  updated_by?: string;
  /** Optimistic check — the updated_at the caller saw when reading. */
  expected_prior_revision?: string | null;
  rationale?: string;
}

export class OptimisticConflictError extends Error {
  constructor(public path: string) {
    super(`Optimistic conflict on ${path}`);
  }
}

/**
 * Insert or update a page. Returns the new row. Versions snapshotted on
 * every write. Throws OptimisticConflictError if `expected_prior_revision`
 * is set and the row's `updated_at` doesn't match.
 */
export async function upsertPage(
  workspaceId: string,
  namespace: WikiNamespace,
  input: UpsertPageInput,
): Promise<WikiPage> {
  const updatedBy = input.updated_by || 'llm';

  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT id, updated_at FROM kb_wiki_pages
        WHERE workspace_id = $1 AND namespace = $2 AND path = $3
        FOR UPDATE`,
      [workspaceId, namespace, input.path],
    );

    if (existing.rows.length === 0) {
      // Create
      if (input.expected_prior_revision) {
        // Caller expected the page to exist with a specific revision but it doesn't.
        throw new OptimisticConflictError(input.path);
      }
      const id = uuid();
      await client.query(
        `INSERT INTO kb_wiki_pages
          (id, workspace_id, namespace, path, kind, title, content, frontmatter, source_ref, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id, workspaceId, namespace, input.path, input.kind,
          input.title, input.content,
          JSON.stringify(input.frontmatter || {}),
          input.source_ref ? JSON.stringify(input.source_ref) : null,
          updatedBy,
        ],
      );
      await snapshot(client, id, 1, input.title, input.content, input.frontmatter || {}, updatedBy, input.rationale);
      const created = await client.query(`SELECT * FROM kb_wiki_pages WHERE id = $1`, [id]);
      return deserialize(created.rows[0]);
    }

    const row = existing.rows[0];
    if (input.expected_prior_revision != null) {
      const cur = new Date(row.updated_at).toISOString();
      const exp = new Date(input.expected_prior_revision).toISOString();
      if (cur !== exp) throw new OptimisticConflictError(input.path);
    }

    // Determine next version
    const verRow = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM kb_wiki_page_versions WHERE page_id = $1`,
      [row.id],
    );
    const nextVer = verRow.rows[0].next;

    await client.query(
      `UPDATE kb_wiki_pages
         SET kind = $1, title = $2, content = $3, frontmatter = $4,
             source_ref = $5, updated_by = $6, archived_at = NULL,
             updated_at = NOW()
       WHERE id = $7`,
      [
        input.kind, input.title, input.content,
        JSON.stringify(input.frontmatter || {}),
        input.source_ref ? JSON.stringify(input.source_ref) : null,
        updatedBy, row.id,
      ],
    );
    await snapshot(client, row.id, nextVer, input.title, input.content, input.frontmatter || {}, updatedBy, input.rationale);

    // Prune old versions
    await client.query(
      `DELETE FROM kb_wiki_page_versions WHERE page_id = $1 AND version NOT IN (
         SELECT version FROM kb_wiki_page_versions WHERE page_id = $1 ORDER BY version DESC LIMIT $2
       )`,
      [row.id, MAX_PAGE_VERSIONS],
    );

    const updated = await client.query(`SELECT * FROM kb_wiki_pages WHERE id = $1`, [row.id]);
    return deserialize(updated.rows[0]);
  });
}

export async function archivePage(workspaceId: string, namespace: WikiNamespace, pathOrId: string): Promise<void> {
  await execute(
    `UPDATE kb_wiki_pages SET archived_at = NOW(), updated_at = NOW(), updated_by = 'system'
       WHERE workspace_id = $1 AND namespace = $2 AND (path = $3 OR id = $3)`,
    [workspaceId, namespace, pathOrId],
  );
}

export async function restorePage(workspaceId: string, namespace: WikiNamespace, pathOrId: string): Promise<void> {
  await execute(
    `UPDATE kb_wiki_pages SET archived_at = NULL, updated_at = NOW(), updated_by = 'system'
       WHERE workspace_id = $1 AND namespace = $2 AND (path = $3 OR id = $3)`,
    [workspaceId, namespace, pathOrId],
  );
}

export async function listVersions(pageId: string): Promise<Array<{ version: number; title: string; rationale: string | null; changed_by: string; created_at: string }>> {
  const rows = await query<any>(
    `SELECT version, title, rationale, changed_by, created_at FROM kb_wiki_page_versions WHERE page_id = $1 ORDER BY version DESC`,
    [pageId],
  );
  return rows;
}

export async function deletePage(workspaceId: string, namespace: WikiNamespace, pathOrId: string): Promise<void> {
  await execute(
    `DELETE FROM kb_wiki_pages WHERE workspace_id = $1 AND namespace = $2 AND (path = $3 OR id = $3)`,
    [workspaceId, namespace, pathOrId],
  );
  logger.info('Wiki page deleted', { workspaceId, namespace, pathOrId });
}

async function snapshot(
  client: any, pageId: string, version: number,
  title: string, content: string, frontmatter: Record<string, unknown>,
  changedBy: string, rationale?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO kb_wiki_page_versions (id, page_id, version, title, content, frontmatter, rationale, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (page_id, version) DO NOTHING`,
    [uuid(), pageId, version, title, content, JSON.stringify(frontmatter), rationale || null, changedBy],
  );
}

function deserialize(row: any): WikiPage {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    namespace: row.namespace,
    path: row.path,
    kind: row.kind,
    title: row.title,
    content: row.content,
    frontmatter: typeof row.frontmatter === 'string' ? JSON.parse(row.frontmatter) : (row.frontmatter || {}),
    source_ref: typeof row.source_ref === 'string' ? JSON.parse(row.source_ref) : row.source_ref,
    updated_by: row.updated_by,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
