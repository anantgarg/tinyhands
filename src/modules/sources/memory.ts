import { v4 as uuid } from 'uuid';
import { query } from '../../db';
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

  await query(`
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
    .join(' ');

  if (!ftsQuery) return [];

  try {
    const { rows: memories } = await query(`
      SELECT am.*, ts_rank(am.search_vector, plainto_tsquery('english', $1)) as rank
      FROM agent_memory am
      WHERE am.search_vector @@ plainto_tsquery('english', $1) AND am.agent_id = $2
      ORDER BY rank DESC
      LIMIT $3
    `, [ftsQuery, agentId, MAX_MEMORIES_RETRIEVED]);

    let tokensUsed = 0;
    return (memories as AgentMemory[]).filter(m => {
      const tokens = Math.ceil(m.fact.length / 4);
      if (tokensUsed + tokens > tokenBudget) return false;
      tokensUsed += tokens;
      return true;
    });
  } catch {
    // Fallback to LIKE search
    const { rows } = await query(`
      SELECT * FROM agent_memory
      WHERE agent_id = $1 AND fact LIKE $2
      ORDER BY relevance_score DESC, created_at DESC
      LIMIT $3
    `, [agentId, `%${queryText.slice(0, 50)}%`, MAX_MEMORIES_RETRIEVED]);
    return rows as AgentMemory[];
  }
}

export async function getAgentMemories(agentId: string): Promise<AgentMemory[]> {
  const { rows } = await query(
    'SELECT * FROM agent_memory WHERE agent_id = $1 ORDER BY created_at DESC',
    [agentId]
  );
  return rows as AgentMemory[];
}

export async function forgetMemory(agentId: string, searchTerm: string): Promise<number> {
  const result = await query(
    'DELETE FROM agent_memory WHERE agent_id = $1 AND fact LIKE $2',
    [agentId, `%${searchTerm}%`]
  );

  const count = result.rowCount || 0;
  logger.info('Memories forgotten', { agentId, term: searchTerm, count });
  return count;
}

export async function clearAgentMemory(agentId: string): Promise<number> {
  const result = await query('DELETE FROM agent_memory WHERE agent_id = $1', [agentId]);
  const count = result.rowCount || 0;
  logger.info('Agent memory cleared', { agentId, count });
  return count;
}

async function pruneMemories(agentId: string): Promise<void> {
  const { rows: countRows } = await query(
    'SELECT COUNT(*) as count FROM agent_memory WHERE agent_id = $1',
    [agentId]
  );
  const count = parseInt(countRows[0].count);

  if (count > MAX_MEMORIES_PER_AGENT) {
    const excess = count - MAX_MEMORIES_PER_AGENT;
    await query(`
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
