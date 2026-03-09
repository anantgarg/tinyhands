import { v4 as uuid } from 'uuid';
import { query, queryOne, execute, withTransaction } from '../../db';
import type { Agent, AgentVersion, ModelAlias, PermissionLevel, SelfEvolutionMode } from '../../types';
import { logger } from '../../utils/logger';

export interface CreateAgentParams {
  name: string;
  channelId: string;
  systemPrompt: string;
  tools?: string[];
  avatarEmoji?: string;
  model?: ModelAlias;
  permissionLevel?: PermissionLevel;
  streamingDetail?: boolean;
  selfEvolutionMode?: SelfEvolutionMode;
  maxTurns?: number;
  memoryEnabled?: boolean;
  respondToAllMessages?: boolean;
  relevanceKeywords?: string[];
  createdBy: string;
}

export async function createAgent(params: CreateAgentParams): Promise<Agent> {
  const id = uuid();

  const existing = await queryOne('SELECT id FROM agents WHERE name = $1', [params.name]);
  if (existing) {
    throw new Error(`Agent with name "${params.name}" already exists`);
  }

  const agent: Agent = {
    id,
    name: params.name,
    channel_id: params.channelId,
    system_prompt: params.systemPrompt,
    tools: params.tools || ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch'],
    avatar_emoji: params.avatarEmoji || ':robot_face:',
    status: 'active',
    model: params.model || 'sonnet',
    streaming_detail: params.streamingDetail !== false,
    docker_image: null,
    self_evolution_mode: params.selfEvolutionMode || 'autonomous',
    max_turns: params.maxTurns || 50,
    memory_enabled: params.memoryEnabled || false,
    permission_level: params.permissionLevel || 'standard',
    respond_to_all_messages: params.respondToAllMessages || false,
    relevance_keywords: params.relevanceKeywords || [],
    created_by: params.createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji, status,
        model, streaming_detail, docker_image, self_evolution_mode, max_turns, memory_enabled,
        permission_level, respond_to_all_messages, relevance_keywords, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `, [
      agent.id, agent.name, agent.channel_id, agent.system_prompt,
      JSON.stringify(agent.tools), agent.avatar_emoji, agent.status,
      agent.model, agent.streaming_detail, agent.docker_image,
      agent.self_evolution_mode, agent.max_turns, agent.memory_enabled,
      agent.permission_level, agent.respond_to_all_messages,
      JSON.stringify(agent.relevance_keywords),
      agent.created_by, agent.created_at, agent.updated_at
    ]);

    await client.query(
      'INSERT INTO agent_versions (id, agent_id, version, system_prompt, change_note, changed_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuid(), agent.id, 1, agent.system_prompt, 'Initial creation', agent.created_by]
    );
  });

  logger.info('Agent created', { agentId: id, name: params.name });
  return agent;
}

export async function getAgent(id: string): Promise<Agent | null> {
  const row = await queryOne('SELECT * FROM agents WHERE id = $1', [id]);
  if (!row) return null;
  return deserializeAgent(row);
}

export async function getAgentByName(name: string): Promise<Agent | null> {
  const row = await queryOne('SELECT * FROM agents WHERE name = $1', [name]);
  if (!row) return null;
  return deserializeAgent(row);
}

export async function getAgentByChannel(channelId: string): Promise<Agent | null> {
  const row = await queryOne('SELECT * FROM agents WHERE channel_id = $1', [channelId]);
  if (!row) return null;
  return deserializeAgent(row);
}

export async function listAgents(): Promise<Agent[]> {
  const rows = await query('SELECT * FROM agents WHERE status != $1 ORDER BY created_at DESC', ['archived']);
  return rows.map(deserializeAgent);
}

export async function updateAgent(id: string, updates: Partial<Agent>, changedBy: string): Promise<Agent> {
  const existing = await getAgent(id);
  if (!existing) throw new Error(`Agent ${id} not found`);

  const fields: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) {
    const dup = await queryOne('SELECT id FROM agents WHERE name = $1 AND id != $2', [updates.name, id]);
    if (dup) throw new Error(`Agent with name "${updates.name}" already exists`);
    fields.push(`name = $${paramIdx++}`);
    values.push(updates.name);
  }
  if (updates.channel_id !== undefined) {
    fields.push(`channel_id = $${paramIdx++}`);
    values.push(updates.channel_id);
  }
  if (updates.system_prompt !== undefined) {
    fields.push(`system_prompt = $${paramIdx++}`);
    values.push(updates.system_prompt);
  }
  if (updates.tools !== undefined) {
    fields.push(`tools = $${paramIdx++}`);
    values.push(JSON.stringify(updates.tools));
  }
  if (updates.avatar_emoji !== undefined) {
    fields.push(`avatar_emoji = $${paramIdx++}`);
    values.push(updates.avatar_emoji);
  }
  if (updates.status !== undefined) {
    fields.push(`status = $${paramIdx++}`);
    values.push(updates.status);
  }
  if (updates.model !== undefined) {
    fields.push(`model = $${paramIdx++}`);
    values.push(updates.model);
  }
  if (updates.streaming_detail !== undefined) {
    fields.push(`streaming_detail = $${paramIdx++}`);
    values.push(updates.streaming_detail);
  }
  if (updates.self_evolution_mode !== undefined) {
    fields.push(`self_evolution_mode = $${paramIdx++}`);
    values.push(updates.self_evolution_mode);
  }
  if (updates.max_turns !== undefined) {
    fields.push(`max_turns = $${paramIdx++}`);
    values.push(updates.max_turns);
  }
  if (updates.memory_enabled !== undefined) {
    fields.push(`memory_enabled = $${paramIdx++}`);
    values.push(updates.memory_enabled);
  }
  if (updates.permission_level !== undefined) {
    fields.push(`permission_level = $${paramIdx++}`);
    values.push(updates.permission_level);
  }
  if (updates.respond_to_all_messages !== undefined) {
    fields.push(`respond_to_all_messages = $${paramIdx++}`);
    values.push(updates.respond_to_all_messages);
  }
  if (updates.relevance_keywords !== undefined) {
    fields.push(`relevance_keywords = $${paramIdx++}`);
    values.push(JSON.stringify(updates.relevance_keywords));
  }

  if (fields.length === 0) return existing;

  fields.push(`updated_at = $${paramIdx++}`);
  values.push(new Date().toISOString());
  values.push(id);

  await withTransaction(async (client) => {
    await client.query(`UPDATE agents SET ${fields.join(', ')} WHERE id = $${paramIdx}`, values);

    if (updates.system_prompt !== undefined && updates.system_prompt !== existing.system_prompt) {
      const latestVersion = await client.query(
        'SELECT MAX(version) as max_version FROM agent_versions WHERE agent_id = $1', [id]
      );
      const nextVersion = (latestVersion.rows[0]?.max_version || 0) + 1;

      await client.query(
        'INSERT INTO agent_versions (id, agent_id, version, system_prompt, change_note, changed_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuid(), id, nextVersion, updates.system_prompt, 'Prompt updated', changedBy]
      );
    }
  });

  logger.info('Agent updated', { agentId: id, fields: fields.map(f => f.split(' =')[0]) });
  return (await getAgent(id))!;
}

export async function deleteAgent(id: string): Promise<void> {
  await execute('UPDATE agents SET status = $1 WHERE id = $2', ['archived', id]);
  logger.info('Agent archived', { agentId: id });
}

export async function getAgentVersions(agentId: string): Promise<AgentVersion[]> {
  return query<AgentVersion>(
    'SELECT * FROM agent_versions WHERE agent_id = $1 ORDER BY version DESC', [agentId]
  );
}

export async function getAgentVersion(agentId: string, version: number): Promise<AgentVersion | null> {
  const row = await queryOne<AgentVersion>(
    'SELECT * FROM agent_versions WHERE agent_id = $1 AND version = $2', [agentId, version]
  );
  return row || null;
}

export async function revertAgent(agentId: string, version: number, changedBy: string): Promise<Agent> {
  const targetVersion = await getAgentVersion(agentId, version);
  if (!targetVersion) throw new Error(`Version ${version} not found for agent ${agentId}`);
  return updateAgent(agentId, { system_prompt: targetVersion.system_prompt }, changedBy);
}

function deserializeAgent(row: any): Agent {
  return {
    ...row,
    tools: JSON.parse(row.tools),
    relevance_keywords: JSON.parse(row.relevance_keywords || '[]'),
  };
}
