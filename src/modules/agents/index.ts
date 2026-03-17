import { v4 as uuid } from 'uuid';
import { query, queryOne, execute, withTransaction } from '../../db';
import type { Agent, AgentVersion, ModelAlias, SelfEvolutionMode, AgentVisibility, DmConversation } from '../../types';
import { logger } from '../../utils/logger';

export interface CreateAgentParams {
  name: string;
  channelId: string;
  channelIds?: string[];
  systemPrompt: string;
  tools?: string[];
  avatarEmoji?: string;
  model?: ModelAlias;
  streamingDetail?: boolean;
  selfEvolutionMode?: SelfEvolutionMode;
  maxTurns?: number;
  memoryEnabled?: boolean;
  respondToAllMessages?: boolean;
  mentionsOnly?: boolean;
  visibility?: AgentVisibility;
  relevanceKeywords?: string[];
  createdBy: string;
}

export async function createAgent(params: CreateAgentParams): Promise<Agent> {
  const id = uuid();

  const existing = await queryOne('SELECT id FROM agents WHERE name = $1', [params.name]);
  if (existing) {
    throw new Error(`Agent with name "${params.name}" already exists`);
  }

  const channelIds = params.channelIds || [params.channelId];
  const agent: Agent = {
    id,
    name: params.name,
    channel_id: channelIds[0],
    channel_ids: channelIds,
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
    respond_to_all_messages: params.respondToAllMessages || false,
    mentions_only: params.mentionsOnly || false,
    visibility: params.visibility || 'public',
    relevance_keywords: params.relevanceKeywords || [],
    created_by: params.createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO agents (id, name, channel_id, channel_ids, system_prompt, tools, avatar_emoji, status,
        model, streaming_detail, docker_image, self_evolution_mode, max_turns, memory_enabled,
        respond_to_all_messages, mentions_only, visibility, relevance_keywords, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    `, [
      agent.id, agent.name, agent.channel_id, agent.channel_ids,
      agent.system_prompt, JSON.stringify(agent.tools), agent.avatar_emoji, agent.status,
      agent.model, agent.streaming_detail, agent.docker_image,
      agent.self_evolution_mode, agent.max_turns, agent.memory_enabled,
      agent.respond_to_all_messages, agent.mentions_only, agent.visibility,
      JSON.stringify(agent.relevance_keywords),
      agent.created_by, agent.created_at, agent.updated_at
    ]);

    // Auto-add creator as member for private agents
    if (agent.visibility === 'private') {
      await client.query(
        'INSERT INTO agent_members (agent_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [agent.id, agent.created_by, agent.created_by]
      );
    }

    await client.query(
      'INSERT INTO agent_versions (id, agent_id, version, system_prompt, change_note, changed_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuid(), agent.id, 1, agent.system_prompt, 'Initial creation', agent.created_by]
    );
  });

  logger.info('Agent created', { agentId: id, name: params.name });

  // Auto-join the bot to assigned channels so it receives events
  import('../../slack').then(({ ensureBotInChannels }) =>
    ensureBotInChannels(channelIds)
  ).catch(() => {});

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
  const row = await queryOne('SELECT * FROM agents WHERE $1 = ANY(channel_ids) AND status != $2', [channelId, 'archived']);
  if (!row) return null;
  return deserializeAgent(row);
}

export async function getAgentsByChannel(channelId: string): Promise<Agent[]> {
  const rows = await query('SELECT * FROM agents WHERE $1 = ANY(channel_ids) AND status != $2', [channelId, 'archived']);
  return rows.map(deserializeAgent);
}

export async function listAgents(): Promise<Agent[]> {
  const rows = await query('SELECT * FROM agents WHERE status != $1 ORDER BY created_at DESC', ['archived']);
  return rows.map(deserializeAgent);
}

/**
 * Ensure the bot is a member of every channel assigned to an active agent.
 * Call once at startup.
 */
export async function ensureBotInAllAgentChannels(): Promise<void> {
  const agents = await listAgents();
  const allChannels = new Set<string>();
  for (const agent of agents) {
    for (const ch of (agent.channel_ids || [])) {
      allChannels.add(ch);
    }
  }
  if (allChannels.size > 0) {
    logger.info('Ensuring bot is in all agent channels', { count: allChannels.size });
    const { ensureBotInChannels } = await import('../../slack');
    await ensureBotInChannels([...allChannels]);
  }
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
  if (updates.channel_ids !== undefined) {
    fields.push(`channel_ids = $${paramIdx++}`);
    values.push(updates.channel_ids);
    fields.push(`channel_id = $${paramIdx++}`);
    values.push(updates.channel_ids[0]);
  } else if (updates.channel_id !== undefined) {
    fields.push(`channel_id = $${paramIdx++}`);
    values.push(updates.channel_id);
    fields.push(`channel_ids = $${paramIdx++}`);
    values.push([updates.channel_id]);
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
  if (updates.respond_to_all_messages !== undefined) {
    fields.push(`respond_to_all_messages = $${paramIdx++}`);
    values.push(updates.respond_to_all_messages);
  }
  if (updates.mentions_only !== undefined) {
    fields.push(`mentions_only = $${paramIdx++}`);
    values.push(updates.mentions_only);
  }
  if (updates.visibility !== undefined) {
    fields.push(`visibility = $${paramIdx++}`);
    values.push(updates.visibility);
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

  // Auto-join the bot to any new channels
  const newChannelIds = updates.channel_ids || (updates.channel_id ? [updates.channel_id] : null);
  if (newChannelIds) {
    import('../../slack').then(({ ensureBotInChannels }) =>
      ensureBotInChannels(newChannelIds)
    ).catch(() => {});
  }

  // Re-fetch with a timeout to prevent hanging the event loop if DB is slow
  try {
    const updated = await Promise.race([
      getAgent(id),
      new Promise<undefined>((_, reject) => setTimeout(() => reject(new Error('getAgent timeout')), 5000)),
    ]);
    return updated || existing;
  } catch {
    logger.warn('getAgent after update timed out, returning stale data', { agentId: id });
    return existing;
  }
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

// ── Agent Members (for private agents) ──

export async function addAgentMember(agentId: string, userId: string, addedBy: string): Promise<void> {
  await execute(
    'INSERT INTO agent_members (agent_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [agentId, userId, addedBy]
  );
}

export async function removeAgentMember(agentId: string, userId: string): Promise<void> {
  await execute('DELETE FROM agent_members WHERE agent_id = $1 AND user_id = $2', [agentId, userId]);
}

export async function getAgentMembers(agentId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>('SELECT user_id FROM agent_members WHERE agent_id = $1', [agentId]);
  return rows.map(r => r.user_id);
}

export async function isAgentMember(agentId: string, userId: string): Promise<boolean> {
  const row = await queryOne('SELECT 1 FROM agent_members WHERE agent_id = $1 AND user_id = $2', [agentId, userId]);
  return !!row;
}

export async function addAgentMembers(agentId: string, userIds: string[], addedBy: string): Promise<void> {
  for (const userId of userIds) {
    await addAgentMember(agentId, userId, addedBy);
  }
}

// ── Agent Access Check (visibility-aware) ──

export async function canAccessAgent(agentId: string, userId: string): Promise<boolean> {
  const agent = await getAgent(agentId);
  if (!agent) return false;
  if (agent.visibility === 'public') return true;
  // Private agent: check membership, admin, or superadmin
  const { isSuperadmin } = await import('../access-control');
  if (await isSuperadmin(userId)) return true;
  const adminRow = await queryOne('SELECT 1 FROM agent_admins WHERE agent_id = $1 AND user_id = $2', [agentId, userId]);
  if (adminRow) return true;
  return isAgentMember(agentId, userId);
}

// ── DM Conversations ──

export async function createDmConversation(userId: string, agentId: string, dmChannelId: string, threadTs: string): Promise<DmConversation> {
  const id = uuid();
  await execute(
    'INSERT INTO dm_conversations (id, user_id, agent_id, dm_channel_id, thread_ts) VALUES ($1, $2, $3, $4, $5)',
    [id, userId, agentId, dmChannelId, threadTs]
  );
  return { id, user_id: userId, agent_id: agentId, dm_channel_id: dmChannelId, thread_ts: threadTs, created_at: new Date().toISOString(), last_active_at: new Date().toISOString() };
}

export async function getDmConversation(dmChannelId: string, threadTs: string): Promise<DmConversation | null> {
  const row = await queryOne<DmConversation>(
    'SELECT * FROM dm_conversations WHERE dm_channel_id = $1 AND thread_ts = $2',
    [dmChannelId, threadTs]
  );
  return row || null;
}

export async function touchDmConversation(dmChannelId: string, threadTs: string): Promise<void> {
  await execute(
    'UPDATE dm_conversations SET last_active_at = NOW() WHERE dm_channel_id = $1 AND thread_ts = $2',
    [dmChannelId, threadTs]
  );
}

export async function getAccessibleAgents(userId: string): Promise<Agent[]> {
  const { isSuperadmin } = await import('../access-control');
  if (await isSuperadmin(userId)) {
    return listAgents();
  }
  // Public agents + private agents where user is member or admin
  const rows = await query(
    `SELECT DISTINCT a.* FROM agents a
     LEFT JOIN agent_members m ON a.id = m.agent_id AND m.user_id = $1
     LEFT JOIN agent_admins aa ON a.id = aa.agent_id AND aa.user_id = $1
     WHERE a.status != 'archived'
       AND (a.visibility = 'public' OR m.user_id IS NOT NULL OR aa.user_id IS NOT NULL)
     ORDER BY a.created_at DESC`,
    [userId]
  );
  return rows.map(deserializeAgent);
}

function deserializeAgent(row: any): Agent {
  return {
    ...row,
    tools: JSON.parse(row.tools),
    relevance_keywords: JSON.parse(row.relevance_keywords || '[]'),
    channel_ids: row.channel_ids || [row.channel_id],
    visibility: row.visibility || 'public',
  };
}
