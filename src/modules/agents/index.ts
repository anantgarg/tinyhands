import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
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

export function createAgent(params: CreateAgentParams): Agent {
  const db = getDb();
  const id = uuid();

  const existing = db.prepare('SELECT id FROM agents WHERE name = ?').get(params.name);
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

  const insertAgent = db.prepare(`
    INSERT INTO agents (id, name, channel_id, system_prompt, tools, avatar_emoji, status,
      model, streaming_detail, docker_image, self_evolution_mode, max_turns, memory_enabled,
      permission_level, respond_to_all_messages, relevance_keywords, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertVersion = db.prepare(`
    INSERT INTO agent_versions (id, agent_id, version, system_prompt, change_note, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    insertAgent.run(
      agent.id, agent.name, agent.channel_id, agent.system_prompt,
      JSON.stringify(agent.tools), agent.avatar_emoji, agent.status,
      agent.model, agent.streaming_detail ? 1 : 0, agent.docker_image,
      agent.self_evolution_mode, agent.max_turns, agent.memory_enabled ? 1 : 0,
      agent.permission_level, agent.respond_to_all_messages ? 1 : 0,
      JSON.stringify(agent.relevance_keywords),
      agent.created_by, agent.created_at, agent.updated_at
    );

    insertVersion.run(
      uuid(), agent.id, 1, agent.system_prompt, 'Initial creation', agent.created_by
    );
  });

  transaction();

  logger.info('Agent created', { agentId: id, name: params.name });
  return agent;
}

export function getAgent(id: string): Agent | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any;
  if (!row) return null;
  return deserializeAgent(row);
}

export function getAgentByName(name: string): Agent | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as any;
  if (!row) return null;
  return deserializeAgent(row);
}

export function getAgentByChannel(channelId: string): Agent | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agents WHERE channel_id = ?').get(channelId) as any;
  if (!row) return null;
  return deserializeAgent(row);
}

export function listAgents(): Agent[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM agents WHERE status != ? ORDER BY created_at DESC').all('archived') as any[];
  return rows.map(deserializeAgent);
}

export function updateAgent(id: string, updates: Partial<Agent>, changedBy: string): Agent {
  const db = getDb();
  const existing = getAgent(id);
  if (!existing) throw new Error(`Agent ${id} not found`);

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    const dup = db.prepare('SELECT id FROM agents WHERE name = ? AND id != ?').get(updates.name, id);
    if (dup) throw new Error(`Agent with name "${updates.name}" already exists`);
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.system_prompt !== undefined) {
    fields.push('system_prompt = ?');
    values.push(updates.system_prompt);
  }
  if (updates.tools !== undefined) {
    fields.push('tools = ?');
    values.push(JSON.stringify(updates.tools));
  }
  if (updates.avatar_emoji !== undefined) {
    fields.push('avatar_emoji = ?');
    values.push(updates.avatar_emoji);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.streaming_detail !== undefined) {
    fields.push('streaming_detail = ?');
    values.push(updates.streaming_detail ? 1 : 0);
  }
  if (updates.self_evolution_mode !== undefined) {
    fields.push('self_evolution_mode = ?');
    values.push(updates.self_evolution_mode);
  }
  if (updates.max_turns !== undefined) {
    fields.push('max_turns = ?');
    values.push(updates.max_turns);
  }
  if (updates.memory_enabled !== undefined) {
    fields.push('memory_enabled = ?');
    values.push(updates.memory_enabled ? 1 : 0);
  }
  if (updates.permission_level !== undefined) {
    fields.push('permission_level = ?');
    values.push(updates.permission_level);
  }
  if (updates.respond_to_all_messages !== undefined) {
    fields.push('respond_to_all_messages = ?');
    values.push(updates.respond_to_all_messages ? 1 : 0);
  }
  if (updates.relevance_keywords !== undefined) {
    fields.push('relevance_keywords = ?');
    values.push(JSON.stringify(updates.relevance_keywords));
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const transaction = db.transaction(() => {
    db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    if (updates.system_prompt !== undefined && updates.system_prompt !== existing.system_prompt) {
      const latestVersion = db.prepare(
        'SELECT MAX(version) as max_version FROM agent_versions WHERE agent_id = ?'
      ).get(id) as any;
      const nextVersion = (latestVersion?.max_version || 0) + 1;

      db.prepare(
        'INSERT INTO agent_versions (id, agent_id, version, system_prompt, change_note, changed_by) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuid(), id, nextVersion, updates.system_prompt, 'Prompt updated', changedBy);
    }
  });

  transaction();

  logger.info('Agent updated', { agentId: id, fields: fields.map(f => f.split(' =')[0]) });
  return getAgent(id)!;
}

export function deleteAgent(id: string): void {
  const db = getDb();
  db.prepare('UPDATE agents SET status = ? WHERE id = ?').run('archived', id);
  logger.info('Agent archived', { agentId: id });
}

export function getAgentVersions(agentId: string): AgentVersion[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version DESC'
  ).all(agentId) as AgentVersion[];
}

export function getAgentVersion(agentId: string, version: number): AgentVersion | null {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM agent_versions WHERE agent_id = ? AND version = ?'
  ).get(agentId, version) as AgentVersion | null;
}

export function revertAgent(agentId: string, version: number, changedBy: string): Agent {
  const targetVersion = getAgentVersion(agentId, version);
  if (!targetVersion) throw new Error(`Version ${version} not found for agent ${agentId}`);
  return updateAgent(agentId, { system_prompt: targetVersion.system_prompt }, changedBy);
}

function deserializeAgent(row: any): Agent {
  return {
    ...row,
    tools: JSON.parse(row.tools),
    streaming_detail: !!row.streaming_detail,
    memory_enabled: !!row.memory_enabled,
    respond_to_all_messages: !!row.respond_to_all_messages,
    relevance_keywords: JSON.parse(row.relevance_keywords || '[]'),
  };
}
