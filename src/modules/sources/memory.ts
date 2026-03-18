import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import type { AgentMemory, MemoryCategory } from '../../types';
import { logger } from '../../utils/logger';

const MAX_MEMORIES_PER_AGENT = 500;
const MAX_MEMORIES_RETRIEVED = 10;
const MEMORY_TOKEN_BUDGET = 2000;

export interface StoreMemoryParams {
  agentId: string;
  runId: string;
  fact: string;
  category: MemoryCategory;
  relevanceScore?: number;
}

export async function storeMemory(workspaceId: string, params: StoreMemoryParams): Promise<AgentMemory> {
  const id = uuid();

  const memory: AgentMemory = {
    id,
    agent_id: params.agentId,
    run_id: params.runId,
    fact: params.fact,
    category: params.category,
    relevance_score: params.relevanceScore || 1.0,
    created_at: new Date().toISOString(),
  };

  await execute(`
    INSERT INTO agent_memory (id, workspace_id, agent_id, run_id, fact, category, relevance_score, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [memory.id, workspaceId, memory.agent_id, memory.run_id, memory.fact,
    memory.category, memory.relevance_score, memory.created_at]);

  // Prune if over cap
  await pruneMemories(workspaceId, params.agentId);

  logger.info('Memory stored', { agentId: params.agentId, memoryId: id });
  return memory;
}

export async function storeMemories(
  workspaceId: string,
  agentId: string,
  runId: string,
  facts: Array<{ fact: string; category: MemoryCategory }>
): Promise<AgentMemory[]> {
  const results: AgentMemory[] = [];
  for (const f of facts) {
    results.push(await storeMemory(workspaceId, { agentId, runId, fact: f.fact, category: f.category }));
  }
  return results;
}

export async function retrieveMemories(
  workspaceId: string,
  agentId: string,
  queryText: string,
  tokenBudget: number = MEMORY_TOKEN_BUDGET
): Promise<AgentMemory[]> {
  const ftsQuery = queryText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10)
    .join(' | ');

  if (!ftsQuery) return [];

  try {
    const memories = await query<AgentMemory & { rank: number }>(`
      SELECT am.*, ts_rank(am.search_vector, to_tsquery('english', $1)) AS rank
      FROM agent_memory am
      WHERE am.search_vector @@ to_tsquery('english', $1) AND am.agent_id = $2 AND am.workspace_id = $3
      ORDER BY rank DESC
      LIMIT $4
    `, [ftsQuery, agentId, workspaceId, MAX_MEMORIES_RETRIEVED]);

    let tokensUsed = 0;
    return memories.filter(m => {
      const tokens = Math.ceil(m.fact.length / 4);
      if (tokensUsed + tokens > tokenBudget) return false;
      tokensUsed += tokens;
      return true;
    });
  } catch {
    // Fallback to LIKE search
    return query<AgentMemory>(`
      SELECT * FROM agent_memory
      WHERE agent_id = $1 AND workspace_id = $2 AND fact LIKE $3
      ORDER BY relevance_score DESC, created_at DESC
      LIMIT $4
    `, [agentId, workspaceId, `%${queryText.slice(0, 50)}%`, MAX_MEMORIES_RETRIEVED]);
  }
}

export async function getAgentMemories(workspaceId: string, agentId: string): Promise<AgentMemory[]> {
  return query<AgentMemory>(
    'SELECT * FROM agent_memory WHERE agent_id = $1 AND workspace_id = $2 ORDER BY created_at DESC', [agentId, workspaceId]
  );
}

export async function forgetMemory(workspaceId: string, agentId: string, searchTerm: string): Promise<number> {
  const result = await execute(
    'DELETE FROM agent_memory WHERE agent_id = $1 AND workspace_id = $2 AND fact LIKE $3',
    [agentId, workspaceId, `%${searchTerm}%`]
  );

  logger.info('Memories forgotten', { agentId, term: searchTerm, count: result.rowCount });
  return result.rowCount;
}

export async function clearAgentMemory(workspaceId: string, agentId: string): Promise<number> {
  const result = await execute('DELETE FROM agent_memory WHERE agent_id = $1 AND workspace_id = $2', [agentId, workspaceId]);
  logger.info('Agent memory cleared', { agentId, count: result.rowCount });
  return result.rowCount;
}

async function pruneMemories(workspaceId: string, agentId: string): Promise<void> {
  const countResult = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM agent_memory WHERE agent_id = $1 AND workspace_id = $2', [agentId, workspaceId]
  );
  const count = parseInt(countResult?.count || '0', 10);

  if (count > MAX_MEMORIES_PER_AGENT) {
    const excess = count - MAX_MEMORIES_PER_AGENT;
    await execute(`
      DELETE FROM agent_memory WHERE id IN (
        SELECT id FROM agent_memory
        WHERE agent_id = $1 AND workspace_id = $2
        ORDER BY relevance_score ASC, created_at ASC
        LIMIT $3
      )
    `, [agentId, workspaceId, excess]);

    logger.info('Memories pruned', { agentId, pruned: excess });
  }
}
