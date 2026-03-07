import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
import { chunkText, hashContent } from '../../utils/chunker';
import { logger } from '../../utils/logger';
import type { Source, SourceChunk, SourceType, SourceStatus } from '../../types';

const DEFAULT_TOKEN_BUDGET = 8000;
const MAX_CHUNKS_RETRIEVED = 20;

// ── Source Management ──

export interface ConnectSourceParams {
  agentId: string;
  sourceType: SourceType;
  uri: string;
  label: string;
}

export function connectSource(params: ConnectSourceParams): Source {
  const db = getDb();
  const id = uuid();

  const source: Source = {
    id,
    agent_id: params.agentId,
    source_type: params.sourceType,
    uri: params.uri,
    label: params.label,
    status: 'active',
    last_sync_at: null,
    chunk_count: 0,
    error_message: null,
    created_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO sources (id, agent_id, source_type, uri, label, status, last_sync_at, chunk_count, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(source.id, source.agent_id, source.source_type, source.uri, source.label,
    source.status, source.last_sync_at, source.chunk_count, source.error_message, source.created_at);

  logger.info('Source connected', { sourceId: id, agentId: params.agentId, type: params.sourceType });
  return source;
}

export function disconnectSource(sourceId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM source_chunks WHERE source_id = ?').run(sourceId);
  db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
  logger.info('Source disconnected', { sourceId });
}

export function getAgentSources(agentId: string): Source[] {
  const db = getDb();
  return db.prepare('SELECT * FROM sources WHERE agent_id = ?').all(agentId) as Source[];
}

export function getSource(id: string): Source | null {
  const db = getDb();
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Source | null;
}

export function updateSourceStatus(
  sourceId: string,
  status: SourceStatus,
  errorMessage?: string
): void {
  const db = getDb();
  db.prepare('UPDATE sources SET status = ?, error_message = ?, last_sync_at = datetime("now") WHERE id = ?')
    .run(status, errorMessage || null, sourceId);
}

// ── Ingestion ──

export function ingestContent(
  sourceId: string,
  agentId: string,
  files: Array<{ path: string; content: string }>
): number {
  const db = getDb();
  let totalChunks = 0;

  const insertChunk = db.prepare(`
    INSERT INTO source_chunks (id, source_id, agent_id, file_path, chunk_index, content, content_hash, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const file of files) {
      const chunks = chunkText(file.content, file.path);

      for (const chunk of chunks) {
        // Check if chunk already exists (incremental sync)
        const existing = db.prepare(
          'SELECT id FROM source_chunks WHERE source_id = ? AND file_path = ? AND chunk_index = ? AND content_hash = ?'
        ).get(sourceId, chunk.filePath, chunk.chunkIndex, chunk.contentHash);

        if (!existing) {
          // Remove old chunk at this position
          db.prepare(
            'DELETE FROM source_chunks WHERE source_id = ? AND file_path = ? AND chunk_index = ?'
          ).run(sourceId, chunk.filePath, chunk.chunkIndex);

          insertChunk.run(
            uuid(), sourceId, agentId, chunk.filePath,
            chunk.chunkIndex, chunk.content, chunk.contentHash, '{}'
          );
        }

        totalChunks++;
      }
    }

    // Update chunk count
    const count = (db.prepare(
      'SELECT COUNT(*) as count FROM source_chunks WHERE source_id = ?'
    ).get(sourceId) as any).count;

    db.prepare('UPDATE sources SET chunk_count = ?, last_sync_at = datetime("now"), status = ? WHERE id = ?')
      .run(count, 'active', sourceId);
  });

  transaction();
  rebuildFtsIndex();

  logger.info('Content ingested', { sourceId, agentId, totalChunks });
  return totalChunks;
}

// ── Retrieval ──

export function retrieveContext(
  agentId: string,
  query: string,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET
): SourceChunk[] {
  const db = getDb();

  // FTS5 search across agent's source chunks
  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];

  try {
    const chunks = db.prepare(`
      SELECT sc.*, rank
      FROM source_chunks_fts
      JOIN source_chunks sc ON source_chunks_fts.rowid = sc.rowid
      WHERE source_chunks_fts MATCH ? AND sc.agent_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, agentId, MAX_CHUNKS_RETRIEVED) as (SourceChunk & { rank: number })[];

    // Deduplicate by file path and apply token budget
    const seen = new Set<string>();
    const result: SourceChunk[] = [];
    let tokensUsed = 0;

    for (const chunk of chunks) {
      const key = `${chunk.file_path}:${chunk.chunk_index}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const chunkTokens = Math.ceil(chunk.content.length / 4);
      if (tokensUsed + chunkTokens > tokenBudget) break;

      result.push(chunk);
      tokensUsed += chunkTokens;
    }

    return result;
  } catch (err) {
    logger.warn('FTS5 query failed, falling back to LIKE search', { error: String(err) });
    return fallbackSearch(agentId, query, tokenBudget);
  }
}

function fallbackSearch(agentId: string, query: string, tokenBudget: number): SourceChunk[] {
  const db = getDb();
  const words = query.split(/\s+/).slice(0, 5);
  const pattern = `%${words.join('%')}%`;

  const chunks = db.prepare(`
    SELECT * FROM source_chunks
    WHERE agent_id = ? AND content LIKE ?
    LIMIT ?
  `).all(agentId, pattern, MAX_CHUNKS_RETRIEVED) as SourceChunk[];

  let tokensUsed = 0;
  return chunks.filter(chunk => {
    const tokens = Math.ceil(chunk.content.length / 4);
    if (tokensUsed + tokens > tokenBudget) return false;
    tokensUsed += tokens;
    return true;
  });
}

function sanitizeFtsQuery(query: string): string {
  // Extract meaningful words, escape FTS5 special characters
  return query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10)
    .join(' OR ');
}

function rebuildFtsIndex(): void {
  const db = getDb();
  try {
    db.exec(`
      DELETE FROM source_chunks_fts;
      INSERT INTO source_chunks_fts(rowid, content, file_path)
        SELECT rowid, content, file_path FROM source_chunks;
    `);
  } catch (err) {
    logger.warn('FTS index rebuild failed', { error: String(err) });
  }
}

// ── Source Type Detection ──

export function detectSourceType(input: string): SourceType {
  if (/github\.com/i.test(input) || /^[\w-]+\/[\w-]+$/.test(input)) return 'github';
  if (/docs\.google\.com|drive\.google\.com/i.test(input)) return 'google_drive';
  if (input.startsWith('/') || input.startsWith('./')) return 'local';
  return 'slack_upload';
}

// ── Sync ──

export function getSourcesDueForSync(): Source[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sources
    WHERE status = 'active'
    AND (last_sync_at IS NULL OR datetime(last_sync_at, '+15 minutes') < datetime('now'))
  `).all() as Source[];
}
