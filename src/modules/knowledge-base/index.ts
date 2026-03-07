import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
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

export function createKBEntry(params: CreateKBEntryParams): KBEntry {
  const db = getDb();
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

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO kb_entries (id, title, summary, content, category, tags, access_scope,
        source_type, contributed_by, approved, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.title, entry.summary, entry.content, entry.category,
      JSON.stringify(entry.tags), JSON.stringify(entry.access_scope),
      entry.source_type, entry.contributed_by, entry.approved ? 1 : 0,
      entry.created_at, entry.updated_at
    );

    // Chunk and index content
    if (entry.approved) {
      indexKBEntry(entry);
    }
  });

  transaction();

  logger.info('KB entry created', { entryId: id, title: params.title, approved: entry.approved });
  return entry;
}

export function approveKBEntry(entryId: string): KBEntry {
  const db = getDb();
  const entry = getKBEntry(entryId);
  if (!entry) throw new Error(`KB entry ${entryId} not found`);

  db.prepare("UPDATE kb_entries SET approved = 1, updated_at = datetime('now') WHERE id = ?").run(entryId);
  indexKBEntry(entry);

  logger.info('KB entry approved', { entryId });
  return { ...entry, approved: true };
}

export function getKBEntry(id: string): KBEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM kb_entries WHERE id = ?').get(id) as any;
  if (!row) return null;
  return deserializeKBEntry(row);
}

export function listKBEntries(limit: number = 50): KBEntry[] {
  const db = getDb();
  return (db.prepare(
    'SELECT * FROM kb_entries WHERE approved = 1 ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as any[]).map(deserializeKBEntry);
}

export function listPendingEntries(): KBEntry[] {
  const db = getDb();
  return (db.prepare(
    'SELECT * FROM kb_entries WHERE approved = 0 ORDER BY created_at DESC'
  ).all() as any[]).map(deserializeKBEntry);
}

export function deleteKBEntry(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM kb_chunks WHERE entry_id = ?').run(id);
  db.prepare('DELETE FROM kb_entries WHERE id = ?').run(id);
  rebuildKBFts();
  logger.info('KB entry deleted', { entryId: id });
}

// ── KB Search ──

export function searchKB(
  query: string,
  agentId?: string,
  tokenBudget: number = 4000
): KBEntry[] {
  const db = getDb();
  const ftsQuery = query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10)
    .join(' OR ');

  if (!ftsQuery) return [];

  try {
    const chunkRows = db.prepare(`
      SELECT kc.entry_id, kc.content, rank
      FROM kb_chunks_fts
      JOIN kb_chunks kc ON kb_chunks_fts.rowid = kc.rowid
      WHERE kb_chunks_fts MATCH ?
      ORDER BY rank
      LIMIT 20
    `).all(ftsQuery) as any[];

    // Get unique entries, applying access scope
    const entryIds = [...new Set(chunkRows.map(r => r.entry_id))];
    const entries: KBEntry[] = [];

    for (const entryId of entryIds) {
      const entry = getKBEntry(entryId);
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
    return (db.prepare(`
      SELECT * FROM kb_entries
      WHERE approved = 1 AND content LIKE ?
      LIMIT 10
    `).all(`%${query.slice(0, 50)}%`) as any[]).map(deserializeKBEntry);
  }
}

// ── Indexing ──

function indexKBEntry(entry: KBEntry): void {
  const db = getDb();
  const chunks = chunkText(entry.content, entry.title);

  const insertChunk = db.prepare(`
    INSERT INTO kb_chunks (id, entry_id, chunk_index, content, content_hash)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const chunk of chunks) {
    insertChunk.run(uuid(), entry.id, chunk.chunkIndex, chunk.content, chunk.contentHash);
  }

  rebuildKBFts();
}

function rebuildKBFts(): void {
  const db = getDb();
  try {
    db.exec(`
      DELETE FROM kb_chunks_fts;
      INSERT INTO kb_chunks_fts(rowid, content)
        SELECT rowid, content FROM kb_chunks;
    `);
  } catch (err) {
    logger.warn('KB FTS rebuild failed', { error: String(err) });
  }
}

// ── Categories ──

export function getCategories(): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT DISTINCT category FROM kb_entries WHERE approved = 1 ORDER BY category'
  ).all() as { category: string }[];
  return rows.map(r => r.category);
}

function deserializeKBEntry(row: any): KBEntry {
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    access_scope: JSON.parse(row.access_scope || '"all"'),
    approved: !!row.approved,
  };
}
