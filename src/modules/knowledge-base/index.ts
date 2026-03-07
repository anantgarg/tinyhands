import { v4 as uuid } from 'uuid';
import { query, getClient } from '../../db';
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
}

export async function createKBEntry(params: CreateKBEntryParams): Promise<KBEntry> {
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO kb_entries (id, title, summary, content, category, tags, access_scope,
        source_type, contributed_by, approved, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      entry.id, entry.title, entry.summary, entry.content, entry.category,
      JSON.stringify(entry.tags), JSON.stringify(entry.access_scope),
      entry.source_type, entry.contributed_by, entry.approved,
      entry.created_at, entry.updated_at
    ]);

    // Chunk and index content
    if (entry.approved) {
      await indexKBEntryWithClient(client, entry);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.info('KB entry created', { entryId: id, title: params.title, approved: entry.approved });
  return entry;
}

export async function approveKBEntry(entryId: string): Promise<KBEntry> {
  const entry = await getKBEntry(entryId);
  if (!entry) throw new Error(`KB entry ${entryId} not found`);

  await query("UPDATE kb_entries SET approved = true, updated_at = NOW()::text WHERE id = $1", [entryId]);
  await indexKBEntry(entry);

  logger.info('KB entry approved', { entryId });
  return { ...entry, approved: true };
}

export async function getKBEntry(id: string): Promise<KBEntry | null> {
  const { rows } = await query('SELECT * FROM kb_entries WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return deserializeKBEntry(rows[0]);
}

export async function listKBEntries(limit: number = 50): Promise<KBEntry[]> {
  const { rows } = await query(
    'SELECT * FROM kb_entries WHERE approved = true ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows.map(deserializeKBEntry);
}

export async function listPendingEntries(): Promise<KBEntry[]> {
  const { rows } = await query(
    'SELECT * FROM kb_entries WHERE approved = false ORDER BY created_at DESC'
  );
  return rows.map(deserializeKBEntry);
}

export async function deleteKBEntry(id: string): Promise<void> {
  await query('DELETE FROM kb_chunks WHERE entry_id = $1', [id]);
  await query('DELETE FROM kb_entries WHERE id = $1', [id]);
  logger.info('KB entry deleted', { entryId: id });
}

// ── KB Search ──

export async function searchKB(
  queryText: string,
  agentId?: string,
  tokenBudget: number = 4000
): Promise<KBEntry[]> {
  const ftsQuery = queryText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10)
    .join(' ');

  if (!ftsQuery) return [];

  try {
    const { rows: chunkRows } = await query(`
      SELECT kc.entry_id, kc.content, ts_rank(kc.search_vector, plainto_tsquery('english', $1)) as rank
      FROM kb_chunks kc
      WHERE kc.search_vector @@ plainto_tsquery('english', $1)
      ORDER BY rank DESC
      LIMIT 20
    `, [ftsQuery]);

    // Get unique entries, applying access scope
    const entryIds = [...new Set(chunkRows.map((r: any) => r.entry_id))];
    const entries: KBEntry[] = [];

    for (const entryId of entryIds) {
      const entry = await getKBEntry(entryId as string);
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
    const { rows } = await query(`
      SELECT * FROM kb_entries
      WHERE approved = true AND content LIKE $1
      LIMIT 10
    `, [`%${queryText.slice(0, 50)}%`]);
    return rows.map(deserializeKBEntry);
  }
}

// ── Indexing ──

async function indexKBEntry(entry: KBEntry): Promise<void> {
  const chunks = chunkText(entry.content, entry.title);

  for (const chunk of chunks) {
    await query(`
      INSERT INTO kb_chunks (id, entry_id, chunk_index, content, content_hash)
      VALUES ($1, $2, $3, $4, $5)
    `, [uuid(), entry.id, chunk.chunkIndex, chunk.content, chunk.contentHash]);
  }
}

async function indexKBEntryWithClient(client: any, entry: KBEntry): Promise<void> {
  const chunks = chunkText(entry.content, entry.title);

  for (const chunk of chunks) {
    await client.query(`
      INSERT INTO kb_chunks (id, entry_id, chunk_index, content, content_hash)
      VALUES ($1, $2, $3, $4, $5)
    `, [uuid(), entry.id, chunk.chunkIndex, chunk.content, chunk.contentHash]);
  }
}

// ── Categories ──

export async function getCategories(): Promise<string[]> {
  const { rows } = await query(
    'SELECT DISTINCT category FROM kb_entries WHERE approved = true ORDER BY category'
  );
  return rows.map((r: any) => r.category);
}

function deserializeKBEntry(row: any): KBEntry {
  return {
    ...row,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : row.tags,
    access_scope: typeof row.access_scope === 'string' ? JSON.parse(row.access_scope || '"all"') : row.access_scope,
    approved: !!row.approved,
  };
}
