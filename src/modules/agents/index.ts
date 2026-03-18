import { v4 as uuid } from 'uuid';
import { query, queryOne, execute, withTransaction } from '../../db';
import type { Agent, AgentVersion, ModelAlias, SelfEvolutionMode, AgentVisibility, AgentAccessLevel, WritePolicy, DmConversation } from '../../types';
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
  defaultAccess?: AgentAccessLevel;
  writePolicy?: WritePolicy;
  relevanceKeywords?: string[];
  createdBy: string;
}

export async function createAgent(workspaceId: string, params: CreateAgentParams): Promise<Agent> {
  const id = uuid();

  const existing = await queryOne('SELECT id FROM agents WHERE workspace_id = $1 AND name = $2', [workspaceId, params.name]);
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
    default_access: params.defaultAccess || 'viewer',
    write_policy: params.writePolicy || 'auto',
    relevance_keywords: params.relevanceKeywords || [],
    created_by: params.createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO agents (id, workspace_id, name, channel_id, channel_ids, system_prompt, tools, avatar_emoji, status,
        model, streaming_detail, docker_image, self_evolution_mode, max_turns, memory_enabled,
        respond_to_all_messages, mentions_only, visibility, default_access, write_policy, relevance_keywords, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
    `, [
      agent.id, workspaceId, agent.name, agent.channel_id, agent.channel_ids,
      agent.system_prompt, JSON.stringify(agent.tools), agent.avatar_emoji, agent.status,
      agent.model, agent.streaming_detail, agent.docker_image,
      agent.self_evolution_mode, agent.max_turns, agent.memory_enabled,
      agent.respond_to_all_messages, agent.mentions_only, agent.visibility,
      agent.default_access, agent.write_policy,
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

    // Insert creator into agent_roles as 'owner'
    await client.query(
      `INSERT INTO agent_roles (agent_id, user_id, role, granted_by, workspace_id) VALUES ($1, $2, 'owner', $3, $4) ON CONFLICT DO NOTHING`,
      [agent.id, agent.created_by, agent.created_by, workspaceId]
    );

    await client.query(
      'INSERT INTO agent_versions (id, agent_id, version, system_prompt, change_note, changed_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuid(), agent.id, 1, agent.system_prompt, 'Initial creation', agent.created_by]
    );
  });

  logger.info('Agent created', { agentId: id, name: params.name });

  // Fire-and-forget audit
  import('../audit').then(({ logAuditEvent }) => {
    logAuditEvent({
      workspaceId,
      actorUserId: params.createdBy,
      actorRole: 'user',
      actionType: 'agent_created',
      agentId: id,
      agentName: params.name,
    });
  }).catch(() => {});

  // Auto-join the bot to assigned channels so it receives events
  import('../../slack').then(({ ensureBotInChannels }) =>
    ensureBotInChannels(channelIds)
  ).catch(() => {});

  return agent;
}

export async function getAgent(workspaceId: string, id: string): Promise<Agent | null> {
  const row = await queryOne('SELECT * FROM agents WHERE workspace_id = $1 AND id = $2', [workspaceId, id]);
  if (!row) return null;
  return deserializeAgent(row);
}

export async function getAgentByName(workspaceId: string, name: string): Promise<Agent | null> {
  const row = await queryOne('SELECT * FROM agents WHERE workspace_id = $1 AND name = $2', [workspaceId, name]);
  if (!row) return null;
  return deserializeAgent(row);
}

export async function getAgentByChannel(workspaceId: string, channelId: string): Promise<Agent | null> {
  const row = await queryOne('SELECT * FROM agents WHERE workspace_id = $1 AND $2 = ANY(channel_ids) AND status != $3', [workspaceId, channelId, 'archived']);
  if (!row) return null;
  return deserializeAgent(row);
}

export async function getAgentsByChannel(workspaceId: string, channelId: string): Promise<Agent[]> {
  const rows = await query('SELECT * FROM agents WHERE workspace_id = $1 AND $2 = ANY(channel_ids) AND status != $3', [workspaceId, channelId, 'archived']);
  return rows.map(deserializeAgent);
}

export async function listAgents(workspaceId: string): Promise<Agent[]> {
  const rows = await query('SELECT * FROM agents WHERE workspace_id = $1 AND status != $2 ORDER BY created_at DESC', [workspaceId, 'archived']);
  return rows.map(deserializeAgent);
}

/**
 * Ensure the bot is a member of every channel assigned to an active agent.
 * Call once at startup. Queries all workspaces since this is a global startup operation.
 */
export async function ensureBotInAllAgentChannels(): Promise<void> {
  const agents = await query('SELECT * FROM agents WHERE status != $1', ['archived']);
  const allChannels = new Set<string>();
  for (const row of agents) {
    const agent = deserializeAgent(row);
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

export async function updateAgent(workspaceId: string, id: string, updates: Partial<Agent>, changedBy: string): Promise<Agent> {
  const existing = await getAgent(workspaceId, id);
  if (!existing) throw new Error(`Agent ${id} not found`);

  const fields: string[] = [];
  const values: any[] = [workspaceId];
  let paramIdx = 2;

  if (updates.name !== undefined) {
    const dup = await queryOne('SELECT id FROM agents WHERE workspace_id = $1 AND name = $2 AND id != $3', [workspaceId, updates.name, id]);
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
    await client.query(`UPDATE agents SET ${fields.join(', ')} WHERE workspace_id = $1 AND id = $${paramIdx}`, values);

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

  // Fire-and-forget audit
  import('../audit').then(({ logAuditEvent }) => {
    logAuditEvent({
      workspaceId,
      actorUserId: changedBy,
      actorRole: 'user',
      actionType: 'agent_config_change',
      agentId: id,
      agentName: existing.name,
      details: { updatedFields: fields.map(f => f.split(' =')[0]) },
    });
  }).catch(() => {});

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
      getAgent(workspaceId, id),
      new Promise<undefined>((_, reject) => setTimeout(() => reject(new Error('getAgent timeout')), 5000)),
    ]);
    return updated || existing;
  } catch {
    logger.warn('getAgent after update timed out, returning stale data', { agentId: id });
    return existing;
  }
}

export async function deleteAgent(workspaceId: string, id: string): Promise<void> {
  const agent = await getAgent(workspaceId, id);
  await execute('UPDATE agents SET status = $1 WHERE workspace_id = $2 AND id = $3', ['archived', workspaceId, id]);
  logger.info('Agent archived', { agentId: id });

  // Fire-and-forget audit
  import('../audit').then(({ logAuditEvent }) => {
    logAuditEvent({
      workspaceId,
      actorUserId: 'system',
      actorRole: 'system',
      actionType: 'agent_deleted',
      agentId: id,
      agentName: agent?.name,
    });
  }).catch(() => {});
}

export async function getAgentVersions(workspaceId: string, agentId: string): Promise<AgentVersion[]> {
  return query<AgentVersion>(
    `SELECT av.* FROM agent_versions av
     JOIN agents a ON a.id = av.agent_id
     WHERE a.workspace_id = $1 AND av.agent_id = $2
     ORDER BY av.version DESC`,
    [workspaceId, agentId]
  );
}

export async function getAgentVersion(workspaceId: string, agentId: string, version: number): Promise<AgentVersion | null> {
  const row = await queryOne<AgentVersion>(
    `SELECT av.* FROM agent_versions av
     JOIN agents a ON a.id = av.agent_id
     WHERE a.workspace_id = $1 AND av.agent_id = $2 AND av.version = $3`,
    [workspaceId, agentId, version]
  );
  return row || null;
}

export async function revertAgent(workspaceId: string, agentId: string, version: number, changedBy: string): Promise<Agent> {
  const targetVersion = await getAgentVersion(workspaceId, agentId, version);
  if (!targetVersion) throw new Error(`Version ${version} not found for agent ${agentId}`);
  return updateAgent(workspaceId, agentId, { system_prompt: targetVersion.system_prompt }, changedBy);
}

// ── Agent Members (for private agents) ──

export async function addAgentMember(workspaceId: string, agentId: string, userId: string, addedBy: string): Promise<void> {
  await execute(
    'INSERT INTO agent_members (agent_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [agentId, userId, addedBy]
  );
}

export async function removeAgentMember(workspaceId: string, agentId: string, userId: string): Promise<void> {
  await execute('DELETE FROM agent_members WHERE agent_id = $1 AND user_id = $2', [agentId, userId]);
}

export async function getAgentMembers(workspaceId: string, agentId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>('SELECT user_id FROM agent_members WHERE agent_id = $1', [agentId]);
  return rows.map(r => r.user_id);
}

export async function isAgentMember(workspaceId: string, agentId: string, userId: string): Promise<boolean> {
  const row = await queryOne('SELECT 1 FROM agent_members WHERE agent_id = $1 AND user_id = $2', [agentId, userId]);
  return !!row;
}

export async function addAgentMembers(workspaceId: string, agentId: string, userIds: string[], addedBy: string): Promise<void> {
  for (const userId of userIds) {
    await addAgentMember(workspaceId, agentId, userId, addedBy);
  }
}

// ── Agent Access Check (role-based) ──

export async function canAccessAgent(workspaceId: string, agentId: string, userId: string): Promise<boolean> {
  const { getAgentRole } = await import('../access-control');
  const role = await getAgentRole(workspaceId, agentId, userId);
  return role !== 'none';
}

// ── DM Conversations ──

export async function createDmConversation(workspaceId: string, userId: string, agentId: string, dmChannelId: string, threadTs: string): Promise<DmConversation> {
  const id = uuid();
  await execute(
    'INSERT INTO dm_conversations (id, workspace_id, user_id, agent_id, dm_channel_id, thread_ts) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, workspaceId, userId, agentId, dmChannelId, threadTs]
  );
  return { id, user_id: userId, agent_id: agentId, dm_channel_id: dmChannelId, thread_ts: threadTs, created_at: new Date().toISOString(), last_active_at: new Date().toISOString() };
}

export async function getDmConversation(workspaceId: string, dmChannelId: string, threadTs: string): Promise<DmConversation | null> {
  const row = await queryOne<DmConversation>(
    'SELECT * FROM dm_conversations WHERE workspace_id = $1 AND dm_channel_id = $2 AND thread_ts = $3',
    [workspaceId, dmChannelId, threadTs]
  );
  return row || null;
}

export async function touchDmConversation(workspaceId: string, dmChannelId: string, threadTs: string): Promise<void> {
  await execute(
    'UPDATE dm_conversations SET last_active_at = NOW() WHERE workspace_id = $1 AND dm_channel_id = $2 AND thread_ts = $3',
    [workspaceId, dmChannelId, threadTs]
  );
}

export async function getAccessibleAgents(workspaceId: string, userId: string): Promise<Agent[]> {
  const { isPlatformAdmin } = await import('../access-control');
  if (await isPlatformAdmin(workspaceId, userId)) {
    return listAgents(workspaceId);
  }
  // Agents where user has an explicit agent_role OR agent.default_access != 'none'
  const rows = await query(
    `SELECT DISTINCT a.* FROM agents a
     LEFT JOIN agent_roles ar ON a.id = ar.agent_id AND ar.user_id = $2
     WHERE a.workspace_id = $1
       AND a.status != 'archived'
       AND (ar.user_id IS NOT NULL OR a.default_access != 'none')
     ORDER BY a.created_at DESC`,
    [workspaceId, userId]
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
    default_access: row.default_access || 'viewer',
    write_policy: row.write_policy || 'auto',
  };
}
