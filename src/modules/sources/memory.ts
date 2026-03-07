import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
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

export function storeMemory(params: StoreMemoryParams): AgentMemory {
  const db = getDb();
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

  db.prepare(`
    INSERT INTO agent_memory (id, agent_id, run_id, fact, category, relevance_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(memory.id, memory.agent_id, memory.run_id, memory.fact,
    memory.category, memory.relevance_score, memory.created_at);

  // Rebuild FTS
  rebuildMemoryFts();

  // Prune if over cap
  pruneMemories(params.agentId);

  logger.info('Memory stored', { agentId: params.agentId, memoryId: id });
  return memory;
}

export function storeMemories(
  agentId: string,
  runId: string,
  facts: Array<{ fact: string; category: MemoryCategory }>
): AgentMemory[] {
  return facts.map(f =>
    storeMemory({ agentId, runId, fact: f.fact, category: f.category })
  );
}

export function retrieveMemories(
  agentId: string,
  query: string,
  tokenBudget: number = MEMORY_TOKEN_BUDGET
): AgentMemory[] {
  const db = getDb();
  const ftsQuery = query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10)
    .join(' OR ');

  if (!ftsQuery) return [];

  try {
    const memories = db.prepare(`
      SELECT am.*, rank
      FROM agent_memory_fts
      JOIN agent_memory am ON agent_memory_fts.rowid = am.rowid
      WHERE agent_memory_fts MATCH ? AND am.agent_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, agentId, MAX_MEMORIES_RETRIEVED) as (AgentMemory & { rank: number })[];

    let tokensUsed = 0;
    return memories.filter(m => {
      const tokens = Math.ceil(m.fact.length / 4);
      if (tokensUsed + tokens > tokenBudget) return false;
      tokensUsed += tokens;
      return true;
    });
  } catch {
    // Fallback to LIKE search
    return db.prepare(`
      SELECT * FROM agent_memory
      WHERE agent_id = ? AND fact LIKE ?
      ORDER BY relevance_score DESC, created_at DESC
      LIMIT ?
    `).all(agentId, `%${query.slice(0, 50)}%`, MAX_MEMORIES_RETRIEVED) as AgentMemory[];
  }
}

export function getAgentMemories(agentId: string): AgentMemory[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY created_at DESC'
  ).all(agentId) as AgentMemory[];
}

export function forgetMemory(agentId: string, searchTerm: string): number {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM agent_memory WHERE agent_id = ? AND fact LIKE ?'
  ).run(agentId, `%${searchTerm}%`);

  rebuildMemoryFts();
  logger.info('Memories forgotten', { agentId, term: searchTerm, count: result.changes });
  return result.changes;
}

export function clearAgentMemory(agentId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM agent_memory WHERE agent_id = ?').run(agentId);
  rebuildMemoryFts();
  logger.info('Agent memory cleared', { agentId, count: result.changes });
  return result.changes;
}

function pruneMemories(agentId: string): void {
  const db = getDb();
  const count = (db.prepare(
    'SELECT COUNT(*) as count FROM agent_memory WHERE agent_id = ?'
  ).get(agentId) as any).count;

  if (count > MAX_MEMORIES_PER_AGENT) {
    const excess = count - MAX_MEMORIES_PER_AGENT;
    db.prepare(`
      DELETE FROM agent_memory WHERE id IN (
        SELECT id FROM agent_memory
        WHERE agent_id = ?
        ORDER BY relevance_score ASC, created_at ASC
        LIMIT ?
      )
    `).run(agentId, excess);

    logger.info('Memories pruned', { agentId, pruned: excess });
  }
}

function rebuildMemoryFts(): void {
  const db = getDb();
  try {
    db.exec(`
      DELETE FROM agent_memory_fts;
      INSERT INTO agent_memory_fts(rowid, fact, category)
        SELECT rowid, fact, category FROM agent_memory;
    `);
  } catch (err) {
    logger.warn('Memory FTS rebuild failed', { error: String(err) });
  }
}
