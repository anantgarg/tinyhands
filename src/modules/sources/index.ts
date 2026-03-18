import { v4 as uuid } from 'uuid';
import { query, queryOne, execute, withTransaction } from '../../db';
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

export async function connectSource(workspaceId: string, params: ConnectSourceParams): Promise<Source> {
  const id = uuid();

  const source: Source = {
    id,
    workspace_id: workspaceId,
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

  await execute(`
    INSERT INTO sources (id, workspace_id, agent_id, source_type, uri, label, status, last_sync_at, chunk_count, error_message, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [source.id, workspaceId, source.agent_id, source.source_type, source.uri, source.label,
    source.status, source.last_sync_at, source.chunk_count, source.error_message, source.created_at]);

  logger.info('Source connected', { sourceId: id, agentId: params.agentId, type: params.sourceType });
  return source;
}

export async function disconnectSource(workspaceId: string, sourceId: string): Promise<void> {
  await execute('DELETE FROM source_chunks WHERE source_id = $1 AND source_id IN (SELECT id FROM sources WHERE workspace_id = $2)', [sourceId, workspaceId]);
  await execute('DELETE FROM sources WHERE id = $1 AND workspace_id = $2', [sourceId, workspaceId]);
  logger.info('Source disconnected', { sourceId });
}

export async function getAgentSources(workspaceId: string, agentId: string): Promise<Source[]> {
  return query<Source>('SELECT * FROM sources WHERE agent_id = $1 AND workspace_id = $2', [agentId, workspaceId]);
}

export async function getSource(workspaceId: string, id: string): Promise<Source | null> {
  const row = await queryOne<Source>('SELECT * FROM sources WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  return row || null;
}

export async function updateSourceStatus(
  workspaceId: string,
  sourceId: string,
  status: SourceStatus,
  errorMessage?: string
): Promise<void> {
  await execute(
    'UPDATE sources SET status = $1, error_message = $2, last_sync_at = NOW() WHERE id = $3 AND workspace_id = $4',
    [status, errorMessage || null, sourceId, workspaceId]
  );
}

// ── Ingestion ──

export async function ingestContent(
  workspaceId: string,
  sourceId: string,
  agentId: string,
  files: Array<{ path: string; content: string }>
): Promise<number> {
  let totalChunks = 0;

  await withTransaction(async (client) => {
    for (const file of files) {
      const chunks = chunkText(file.content, file.path);

      for (const chunk of chunks) {
        // Check if chunk already exists (incremental sync)
        const existing = await client.query(
          'SELECT id FROM source_chunks WHERE source_id = $1 AND file_path = $2 AND chunk_index = $3 AND content_hash = $4',
          [sourceId, chunk.filePath, chunk.chunkIndex, chunk.contentHash]
        );

        if (existing.rows.length === 0) {
          // Remove old chunk at this position
          await client.query(
            'DELETE FROM source_chunks WHERE source_id = $1 AND file_path = $2 AND chunk_index = $3',
            [sourceId, chunk.filePath, chunk.chunkIndex]
          );

          await client.query(`
            INSERT INTO source_chunks (id, workspace_id, source_id, agent_id, file_path, chunk_index, content, content_hash, metadata_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [uuid(), workspaceId, sourceId, agentId, chunk.filePath, chunk.chunkIndex, chunk.content, chunk.contentHash, '{}']);
        }

        totalChunks++;
      }
    }

    // Update chunk count
    const countResult = await client.query(
      'SELECT COUNT(*) as count FROM source_chunks WHERE source_id = $1', [sourceId]
    );
    const count = parseInt(countResult.rows[0].count, 10);

    await client.query(
      'UPDATE sources SET chunk_count = $1, last_sync_at = NOW(), status = $2 WHERE id = $3 AND workspace_id = $4',
      [count, 'active', sourceId, workspaceId]
    );
  });

  logger.info('Content ingested', { sourceId, agentId, totalChunks });
  return totalChunks;
}

// ── Retrieval ──

export async function retrieveContext(
  workspaceId: string,
  agentId: string,
  queryText: string,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET
): Promise<SourceChunk[]> {
  // tsvector search across agent's source chunks
  const ftsQuery = sanitizeFtsQuery(queryText);
  if (!ftsQuery) return [];

  try {
    const chunks = await query<SourceChunk & { rank: number }>(`
      SELECT sc.*, ts_rank(sc.search_vector, to_tsquery('english', $1)) AS rank
      FROM source_chunks sc
      WHERE sc.search_vector @@ to_tsquery('english', $1) AND sc.agent_id = $2 AND sc.workspace_id = $3
      ORDER BY rank DESC
      LIMIT $4
    `, [ftsQuery, agentId, workspaceId, MAX_CHUNKS_RETRIEVED]);

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
    logger.warn('tsvector query failed, falling back to LIKE search', { error: String(err) });
    return fallbackSearch(workspaceId, agentId, queryText, tokenBudget);
  }
}

async function fallbackSearch(workspaceId: string, agentId: string, queryText: string, tokenBudget: number): Promise<SourceChunk[]> {
  const words = queryText.split(/\s+/).slice(0, 5);
  const pattern = `%${words.join('%')}%`;

  const chunks = await query<SourceChunk>(`
    SELECT * FROM source_chunks
    WHERE agent_id = $1 AND workspace_id = $2 AND content LIKE $3
    LIMIT $4
  `, [agentId, workspaceId, pattern, MAX_CHUNKS_RETRIEVED]);

  let tokensUsed = 0;
  return chunks.filter(chunk => {
    const tokens = Math.ceil(chunk.content.length / 4);
    if (tokensUsed + tokens > tokenBudget) return false;
    tokensUsed += tokens;
    return true;
  });
}

function sanitizeFtsQuery(queryText: string): string {
  // Extract meaningful words, format as tsquery OR syntax
  return queryText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10)
    .join(' | ');
}

// ── Source Type Detection ──

export function detectSourceType(input: string): SourceType {
  if (/github\.com/i.test(input) || /^[\w-]+\/[\w-]+$/.test(input)) return 'github';
  if (/docs\.google\.com|drive\.google\.com/i.test(input)) return 'google_drive';
  if (input.startsWith('/') || input.startsWith('./')) return 'local';
  return 'slack_upload';
}

// ── Sync (CROSS-WORKSPACE) ──

export async function getSourcesDueForSync(): Promise<Source[]> {
  return query<Source>(`
    SELECT * FROM sources
    WHERE status = 'active'
    AND (last_sync_at IS NULL OR last_sync_at + INTERVAL '15 minutes' < NOW())
  `);
}
