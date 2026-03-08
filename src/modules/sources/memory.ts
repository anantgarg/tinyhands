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

export async function storeMemory(params: StoreMemoryParams): Promise<AgentMemory> {
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
    INSERT INTO agent_memory (id, agent_id, run_id, fact, category, relevance_score, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [memory.id, memory.agent_id, memory.run_id, memory.fact,
    memory.category, memory.relevance_score, memory.created_at]);

  // Prune if over cap
  await pruneMemories(params.agentId);

  logger.info('Memory stored', { agentId: params.agentId, memoryId: id });
  return memory;
}

export async function storeMemories(
  agentId: string,
  runId: string,
  facts: Array<{ fact: string; category: MemoryCategory }>
): Promise<AgentMemory[]> {
  const results: AgentMemory[] = [];
  for (const f of facts) {
    results.push(await storeMemory({ agentId, runId, fact: f.fact, category: f.category }));
  }
  return results;
}

export async function retrieveMemories(
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
      WHERE am.search_vector @@ to_tsquery('english', $1) AND am.agent_id = $2
      ORDER BY rank DESC
      LIMIT $3
    `, [ftsQuery, agentId, MAX_MEMORIES_RETRIEVED]);

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
      WHERE agent_id = $1 AND fact LIKE $2
      ORDER BY relevance_score DESC, created_at DESC
      LIMIT $3
    `, [agentId, `%${queryText.slice(0, 50)}%`, MAX_MEMORIES_RETRIEVED]);
  }
}

export async function getAgentMemories(agentId: string): Promise<AgentMemory[]> {
  return query<AgentMemory>(
    'SELECT * FROM agent_memory WHERE agent_id = $1 ORDER BY created_at DESC', [agentId]
  );
}

export async function forgetMemory(agentId: string, searchTerm: string): Promise<number> {
  const result = await execute(
    'DELETE FROM agent_memory WHERE agent_id = $1 AND fact LIKE $2',
    [agentId, `%${searchTerm}%`]
  );

  logger.info('Memories forgotten', { agentId, term: searchTerm, count: result.rowCount });
  return result.rowCount;
}

export async function clearAgentMemory(agentId: string): Promise<number> {
  const result = await execute('DELETE FROM agent_memory WHERE agent_id = $1', [agentId]);
  logger.info('Agent memory cleared', { agentId, count: result.rowCount });
  return result.rowCount;
}

async function pruneMemories(agentId: string): Promise<void> {
  const countResult = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM agent_memory WHERE agent_id = $1', [agentId]
  );
  const count = parseInt(countResult?.count || '0', 10);

  if (count > MAX_MEMORIES_PER_AGENT) {
    const excess = count - MAX_MEMORIES_PER_AGENT;
    await execute(`
      DELETE FROM agent_memory WHERE id IN (
        SELECT id FROM agent_memory
        WHERE agent_id = $1
        ORDER BY relevance_score ASC, created_at ASC
        LIMIT $2
      )
    `, [agentId, excess]);

    logger.info('Memories pruned', { agentId, pruned: excess });
  }
}
