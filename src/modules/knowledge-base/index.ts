import { v4 as uuid } from 'uuid';
import { query, queryOne, execute, withTransaction } from '../../db';
import { chunkText } from '../../utils/chunker';
import { logger } from '../../utils/logger';
import type { KBEntry, KBSourceType } from '../../types';

// ── KB Entry Management ──

export interface CreateKBEntryParams {
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  accessScope: string[] | 'all';
  sourceType: KBSourceType;
  contributedBy?: string;
  approved?: boolean;
  kbSourceId?: string;
}

export async function createKBEntry(workspaceId: string, params: CreateKBEntryParams): Promise<KBEntry> {
  const id = uuid();

  const entry: KBEntry = {
    id,
    title: params.title,
    summary: params.summary,
    content: params.content,
    category: params.category,
    tags: params.tags,
    access_scope: params.accessScope,
    source_type: params.sourceType,
    contributed_by: params.contributedBy || null,
    approved: params.sourceType === 'manual' ? true : (params.approved || false),
    kb_source_id: params.kbSourceId || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO kb_entries (id, workspace_id, title, summary, content, category, tags, access_scope,
        source_type, contributed_by, approved, kb_source_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      entry.id, workspaceId, entry.title, entry.summary, entry.content, entry.category,
      JSON.stringify(entry.tags), JSON.stringify(entry.access_scope),
      entry.source_type, entry.contributed_by, entry.approved,
      entry.kb_source_id, entry.created_at, entry.updated_at
    ]);

    // Chunk and index content
    if (entry.approved) {
      await indexKBEntryWithClient(workspaceId, entry, client);
    }
  });

  logger.info('KB entry created', { entryId: id, title: params.title, approved: entry.approved });
  return entry;
}

export async function approveKBEntry(workspaceId: string, entryId: string): Promise<KBEntry> {
  const entry = await getKBEntry(workspaceId, entryId);
  if (!entry) throw new Error(`KB entry ${entryId} not found`);

  await execute('UPDATE kb_entries SET approved = TRUE, updated_at = NOW() WHERE id = $1 AND workspace_id = $2', [entryId, workspaceId]);
  await indexKBEntry(workspaceId, entry);

  logger.info('KB entry approved', { entryId });
  return { ...entry, approved: true };
}

export async function getKBEntry(workspaceId: string, id: string): Promise<KBEntry | null> {
  const row = await queryOne('SELECT * FROM kb_entries WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  if (!row) return null;
  return deserializeKBEntry(row);
}

export async function listKBEntries(workspaceId: string, limit: number = 50): Promise<KBEntry[]> {
  const rows = await query(
    'SELECT * FROM kb_entries WHERE approved = TRUE AND workspace_id = $1 ORDER BY created_at DESC LIMIT $2', [workspaceId, limit]
  );
  return rows.map(deserializeKBEntry);
}

export async function listPendingEntries(workspaceId: string): Promise<KBEntry[]> {
  const rows = await query(
    'SELECT * FROM kb_entries WHERE approved = FALSE AND workspace_id = $1 ORDER BY created_at DESC', [workspaceId]
  );
  return rows.map(deserializeKBEntry);
}

export async function deleteKBEntry(workspaceId: string, id: string): Promise<void> {
  await execute('DELETE FROM kb_chunks WHERE entry_id = $1 AND entry_id IN (SELECT id FROM kb_entries WHERE workspace_id = $2)', [id, workspaceId]);
  await execute('DELETE FROM kb_entries WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  logger.info('KB entry deleted', { entryId: id });
}

// ── Upsert (source-driven sync) ──

export interface UpsertKBEntryParams extends CreateKBEntryParams {
  kbSourceId: string;
  sourceExternalId: string;
}

// Insert-or-update a KB entry keyed by (workspace, source, external ID).
// When the external row already exists we replace its content + re-chunk so
// edits in the source system flow through without creating duplicates.
export async function upsertKBEntryByExternalId(
  workspaceId: string,
  params: UpsertKBEntryParams,
): Promise<{ entry: KBEntry; created: boolean }> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM kb_entries
      WHERE workspace_id = $1 AND kb_source_id = $2 AND source_external_id = $3`,
    [workspaceId, params.kbSourceId, params.sourceExternalId],
  );

  if (!existing) {
    const entry = await createKBEntry(workspaceId, params);
    await execute(
      'UPDATE kb_entries SET source_external_id = $1 WHERE id = $2 AND workspace_id = $3',
      [params.sourceExternalId, entry.id, workspaceId],
    );
    return { entry: { ...entry, source_external_id: params.sourceExternalId } as KBEntry, created: true };
  }

  const id = existing.id;
  const approved = params.sourceType === 'manual' ? true : (params.approved ?? true);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE kb_entries
          SET title = $1, summary = $2, content = $3, category = $4, tags = $5,
              access_scope = $6, source_type = $7, contributed_by = $8,
              approved = $9, updated_at = NOW()
        WHERE id = $10 AND workspace_id = $11`,
      [
        params.title, params.summary, params.content, params.category,
        JSON.stringify(params.tags), JSON.stringify(params.accessScope),
        params.sourceType, params.contributedBy || null,
        approved, id, workspaceId,
      ],
    );
    await client.query('DELETE FROM kb_chunks WHERE entry_id = $1', [id]);
    if (approved) {
      const entry = { ...params, id } as unknown as KBEntry;
      await indexKBEntryWithClient(workspaceId, entry, client);
    }
  });

  // Don't re-fetch via queryOne right after a freshly-released transaction
  // client — there's a pg-pool edge case where that query's promise can hang
  // indefinitely even though the server executes the SELECT. Return a
  // hand-built entry from the params we just wrote.
  const entry: KBEntry = {
    id,
    title: params.title,
    summary: params.summary,
    content: params.content,
    category: params.category,
    tags: params.tags,
    access_scope: params.accessScope,
    source_type: params.sourceType,
    contributed_by: params.contributedBy || null,
    approved,
    kb_source_id: params.kbSourceId,
    source_external_id: params.sourceExternalId,
    created_at: '',
    updated_at: new Date().toISOString(),
  };
  logger.info('KB entry upserted from source', { entryId: id, sourceId: params.kbSourceId, externalId: params.sourceExternalId });
  return { entry, created: false };
}

// Tombstone pass: delete entries for this source whose external IDs were NOT
// seen in the latest crawl. Handles file deletions and folder-scope changes.
// Also cleans up pre-upsert entries (NULL source_external_id) left over from
// the append-only era so they don't show up as duplicates forever.
export async function deleteStaleKBEntries(
  workspaceId: string,
  kbSourceId: string,
  seenExternalIds: string[],
): Promise<number> {
  const seenSet = new Set(seenExternalIds);
  const rows = await query<{ id: string; source_external_id: string | null }>(
    `SELECT id, source_external_id FROM kb_entries
      WHERE workspace_id = $1 AND kb_source_id = $2`,
    [workspaceId, kbSourceId],
  );
  const staleIds = rows
    .filter(r => r.source_external_id === null || !seenSet.has(r.source_external_id))
    .map(r => r.id);
  if (staleIds.length === 0) return 0;

  await execute(
    `DELETE FROM kb_chunks WHERE entry_id = ANY($1::text[])`,
    [staleIds],
  );
  await execute(
    `DELETE FROM kb_entries WHERE id = ANY($1::text[]) AND workspace_id = $2`,
    [staleIds, workspaceId],
  );
  logger.info('KB entries tombstoned after sync', { sourceId: kbSourceId, deletedCount: staleIds.length });
  return staleIds.length;
}

// ── KB Search ──

export async function searchKB(
  workspaceId: string,
  queryText: string,
  agentId?: string,
  tokenBudget: number = 4000
): Promise<KBEntry[]> {
  const ftsQuery = queryText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10)
    .join(' | ');

  if (!ftsQuery) return [];

  try {
    const chunkRows = await query(`
      SELECT kc.entry_id, kc.content, ts_rank(kc.search_vector, to_tsquery('english', $1)) AS rank
      FROM kb_chunks kc
      JOIN kb_entries ke ON ke.id = kc.entry_id
      WHERE kc.search_vector @@ to_tsquery('english', $1) AND ke.workspace_id = $2
      ORDER BY rank DESC
      LIMIT 20
    `, [ftsQuery, workspaceId]);

    // Get unique entries, applying access scope
    const entryIds = [...new Set(chunkRows.map(r => r.entry_id))];
    const entries: KBEntry[] = [];

    for (const entryId of entryIds) {
      const entry = await getKBEntry(workspaceId, entryId);
      if (!entry || !entry.approved) continue;

      // Check access scope
      if (agentId && entry.access_scope !== 'all') {
        if (!entry.access_scope.includes(agentId)) continue;
      }

      entries.push(entry);
    }

    return entries;
  } catch {
    // Fallback
    const rows = await query(`
      SELECT * FROM kb_entries
      WHERE approved = TRUE AND workspace_id = $1 AND content LIKE $2
      LIMIT 10
    `, [workspaceId, `%${queryText.slice(0, 50)}%`]);
    return rows.map(deserializeKBEntry);
  }
}

// ── Indexing ──

async function indexKBEntry(workspaceId: string, entry: KBEntry): Promise<void> {
  const chunks = chunkText(entry.content, entry.title);

  for (const chunk of chunks) {
    await execute(`
      INSERT INTO kb_chunks (id, workspace_id, entry_id, chunk_index, content, content_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [uuid(), workspaceId, entry.id, chunk.chunkIndex, chunk.content, chunk.contentHash]);
  }
}

async function indexKBEntryWithClient(workspaceId: string, entry: KBEntry, client: any): Promise<void> {
  const chunks = chunkText(entry.content, entry.title);

  for (const chunk of chunks) {
    await client.query(`
      INSERT INTO kb_chunks (id, workspace_id, entry_id, chunk_index, content, content_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [uuid(), workspaceId, entry.id, chunk.chunkIndex, chunk.content, chunk.contentHash]);
  }
}

// ── Categories ──

export async function getCategories(workspaceId: string): Promise<string[]> {
  const rows = await query<{ category: string }>(
    'SELECT DISTINCT category FROM kb_entries WHERE approved = TRUE AND workspace_id = $1 ORDER BY category', [workspaceId]
  );
  return rows.map(r => r.category);
}

function deserializeKBEntry(row: any): KBEntry {
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    access_scope: JSON.parse(row.access_scope || '"all"'),
    kb_source_id: row.kb_source_id || null,
  };
}
