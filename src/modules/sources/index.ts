import { v4 as uuid } from 'uuid';
import { query, getClient } from '../../db';
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

export async function connectSource(params: ConnectSourceParams): Promise<Source> {
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

  await query(`
    INSERT INTO sources (id, agent_id, source_type, uri, label, status, last_sync_at, chunk_count, error_message, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [source.id, source.agent_id, source.source_type, source.uri, source.label,
    source.status, source.last_sync_at, source.chunk_count, source.error_message, source.created_at]);

  logger.info('Source connected', { sourceId: id, agentId: params.agentId, type: params.sourceType });
  return source;
}

export async function disconnectSource(sourceId: string): Promise<void> {
  await query('DELETE FROM source_chunks WHERE source_id = $1', [sourceId]);
  await query('DELETE FROM sources WHERE id = $1', [sourceId]);
  logger.info('Source disconnected', { sourceId });
}

export async function getAgentSources(agentId: string): Promise<Source[]> {
  const { rows } = await query('SELECT * FROM sources WHERE agent_id = $1', [agentId]);
  return rows as Source[];
}

export async function getSource(id: string): Promise<Source | null> {
  const { rows } = await query('SELECT * FROM sources WHERE id = $1', [id]);
  return rows[0] as Source | null ?? null;
}

export async function updateSourceStatus(
  sourceId: string,
  status: SourceStatus,
  errorMessage?: string
): Promise<void> {
  await query(
    "UPDATE sources SET status = $1, error_message = $2, last_sync_at = NOW()::text WHERE id = $3",
    [status, errorMessage || null, sourceId]
  );
}

// ── Ingestion ──

export async function ingestContent(
  sourceId: string,
  agentId: string,
  files: Array<{ path: string; content: string }>
): Promise<number> {
  let totalChunks = 0;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const file of files) {
      const chunks = chunkText(file.content, file.path);

      for (const chunk of chunks) {
        // Check if chunk already exists (incremental sync)
        const { rows: existing } = await client.query(
          'SELECT id FROM source_chunks WHERE source_id = $1 AND file_path = $2 AND chunk_index = $3 AND content_hash = $4',
          [sourceId, chunk.filePath, chunk.chunkIndex, chunk.contentHash]
        );

        if (existing.length === 0) {
          // Remove old chunk at this position
          await client.query(
            'DELETE FROM source_chunks WHERE source_id = $1 AND file_path = $2 AND chunk_index = $3',
            [sourceId, chunk.filePath, chunk.chunkIndex]
          );

          await client.query(`
            INSERT INTO source_chunks (id, source_id, agent_id, file_path, chunk_index, content, content_hash, metadata_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [uuid(), sourceId, agentId, chunk.filePath,
            chunk.chunkIndex, chunk.content, chunk.contentHash, '{}']);
        }

        totalChunks++;
      }
    }

    // Update chunk count
    const { rows: countRows } = await client.query(
      'SELECT COUNT(*) as count FROM source_chunks WHERE source_id = $1',
      [sourceId]
    );

    await client.query(
      "UPDATE sources SET chunk_count = $1, last_sync_at = NOW()::text, status = $2 WHERE id = $3",
      [parseInt(countRows[0].count), 'active', sourceId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.info('Content ingested', { sourceId, agentId, totalChunks });
  return totalChunks;
}

// ── Retrieval ──

export async function retrieveContext(
  agentId: string,
  queryText: string,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET
): Promise<SourceChunk[]> {
  // PostgreSQL full-text search across agent's source chunks
  const ftsQuery = sanitizeFtsQuery(queryText);
  if (!ftsQuery) return [];

  try {
    const { rows: chunks } = await query(`
      SELECT sc.*, ts_rank(sc.search_vector, plainto_tsquery('english', $1)) as rank
      FROM source_chunks sc
      WHERE sc.search_vector @@ plainto_tsquery('english', $1) AND sc.agent_id = $2
      ORDER BY rank DESC
      LIMIT $3
    `, [ftsQuery, agentId, MAX_CHUNKS_RETRIEVED]);

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
    logger.warn('FTS query failed, falling back to LIKE search', { error: String(err) });
    return fallbackSearch(agentId, queryText, tokenBudget);
  }
}

async function fallbackSearch(agentId: string, queryText: string, tokenBudget: number): Promise<SourceChunk[]> {
  const words = queryText.split(/\s+/).slice(0, 5);
  const pattern = `%${words.join('%')}%`;

  const { rows: chunks } = await query(`
    SELECT * FROM source_chunks
    WHERE agent_id = $1 AND content LIKE $2
    LIMIT $3
  `, [agentId, pattern, MAX_CHUNKS_RETRIEVED]);

  let tokensUsed = 0;
  return (chunks as SourceChunk[]).filter(chunk => {
    const tokens = Math.ceil(chunk.content.length / 4);
    if (tokensUsed + tokens > tokenBudget) return false;
    tokensUsed += tokens;
    return true;
  });
}

function sanitizeFtsQuery(queryText: string): string {
  // Extract meaningful words for plainto_tsquery
  return queryText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10)
    .join(' ');
}

// ── Source Type Detection ──

export function detectSourceType(input: string): SourceType {
  if (/github\.com/i.test(input) || /^[\w-]+\/[\w-]+$/.test(input)) return 'github';
  if (/docs\.google\.com|drive\.google\.com/i.test(input)) return 'google_drive';
  if (input.startsWith('/') || input.startsWith('./')) return 'local';
  return 'slack_upload';
}

// ── Sync ──

export async function getSourcesDueForSync(): Promise<Source[]> {
  const { rows } = await query(`
    SELECT * FROM sources
    WHERE status = 'active'
    AND (last_sync_at IS NULL OR (last_sync_at::timestamp + interval '15 minutes') < NOW())
  `);
  return rows as Source[];
}
