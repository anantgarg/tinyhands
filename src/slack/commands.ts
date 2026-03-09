import type { App } from '@slack/bolt';
import { v4 as uuid } from 'uuid';
import { createAgent, listAgents, getAgent, getAgentByName, updateAgent } from '../modules/agents';
import { initSuperadmin, canModifyAgent, listSuperadmins } from '../modules/access-control';
import { createChannel, postMessage, postBlocks, getSlackApp, sendDMBlocks } from './index';
import { analyzeGoal } from '../modules/agents/goal-analyzer';
import { attachSkillToAgent } from '../modules/skills';
import { createTrigger } from '../modules/triggers';
import { logger } from '../utils/logger';
import { execute, queryOne } from '../db';

export function registerCommands(app: App): void {
  // /new-agent — Start conversational agent creation
  app.command('/new-agent', async ({ command, ack }) => {
    await ack();
    await initSuperadmin(command.user_id);

    const ts = await postBlocks(command.channel_id, [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':robot_face: *Let\'s create a new agent!*\n\nDescribe what you want this agent to do. Everything else — name, tools, skills, triggers, model, permissions — will be auto-configured.\n\n_Reply in this thread with the goal._',
        },
      },
    ], 'New agent — describe what it should do');

    if (ts) {
      await execute(
        `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [uuid(), JSON.stringify({
          type: 'conversation',
          step: 'awaiting_goal',
          flow: 'new_agent',
          userId: command.user_id,
          channelId: command.channel_id,
          threadTs: ts,
        })],
      );
    }
  });

  // /update-agent — Start conversational agent update
  app.command('/update-agent', async ({ command, ack }) => {
    await ack();
    const userId = command.user_id;

    const agents = await listAgents();
    if (agents.length === 0) {
      await postMessage(command.channel_id, 'No agents exist yet. Use `/new-agent` to create one.');
      return;
    }

    const editableAgents: typeof agents = [];
    for (const a of agents) {
      if (await canModifyAgent(a.id, userId)) editableAgents.push(a);
    }
    if (editableAgents.length === 0) {
      await postMessage(command.channel_id, 'You don\'t have permission to update any agents.');
      return;
    }

    const ts = await postBlocks(command.channel_id, [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: ':arrows_counterclockwise: *Which agent do you want to update?*' },
        accessory: {
          type: 'static_select',
          action_id: 'update_agent_select',
          placeholder: { type: 'plain_text', text: 'Choose an agent...' },
          options: editableAgents.map(a => ({
            text: { type: 'plain_text' as const, text: `${a.avatar_emoji} ${a.name}` },
            value: a.id,
          })),
        },
      },
    ], 'Select an agent to update');

    if (ts) {
      await execute(
        `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [uuid(), JSON.stringify({
          type: 'conversation',
          step: 'awaiting_agent_select',
          flow: 'update_agent',
          userId,
          channelId: command.channel_id,
          threadTs: ts,
        })],
      );
    }
  });

  // /agents — List all agents
  app.command('/agents', async ({ command, ack, respond }) => {
    await ack();
    const agents = await listAgents();
    if (agents.length === 0) {
      await respond({ text: 'No agents created yet. Use `/new-agent` to create one.', response_type: 'ephemeral' });
      return;
    }
    const lines = agents.map(a => {
      const channels = (a.channel_ids?.length > 0 ? a.channel_ids : [a.channel_id]).map(c => `<#${c}>`).join(', ');
      return `${a.avatar_emoji} *${a.name}* — ${channels} — ${a.status} — ${a.model} — ${a.permission_level}`;
    });
    await respond({ text: `*Active Agents (${agents.length}):*\n\n${lines.join('\n')}`, response_type: 'ephemeral' });
  });

  // /kb — Knowledge base commands
  app.command('/kb', async ({ command, ack, respond }) => {
    await ack();
    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0];
    switch (subcommand) {
      case 'add':
        await respond({ text: 'Upload a file or paste content to add to the knowledge base.', response_type: 'ephemeral' });
        break;
      case 'search': {
        const query = args.slice(1).join(' ');
        if (!query) { await respond({ text: 'Usage: `/kb search <query>`', response_type: 'ephemeral' }); return; }
        const { searchKB } = await import('../modules/knowledge-base');
        const results = await searchKB(query);
        if (results.length === 0) {
          await respond({ text: 'No KB entries found.', response_type: 'ephemeral' });
        } else {
          const lines = results.map(r => `• *${r.title}* (${r.category}): ${r.summary}`);
          await respond({ text: `*KB Results:*\n${lines.join('\n')}`, response_type: 'ephemeral' });
        }
        break;
      }
      default:
        await respond({ text: 'Usage: `/kb add` or `/kb search <query>`', response_type: 'ephemeral' });
    }
  });
}

// ── Conversational Handlers ──

export function registerInlineActions(app: App): void {
  // Handle agent selection dropdown for /update-agent
  app.action('update_agent_select', async ({ action, ack, body }) => {
    await ack();
    const agentId = (action as any).selected_option?.value;
    if (!agentId) return;

    const userId = body.user.id;
    const agent = await getAgent(agentId);
    if (!agent) return;
    if (!(await canModifyAgent(agentId, userId))) {
      const channelId = body.channel?.id;
      if (channelId) await postMessage(channelId, ':x: You don\'t have permission to update this agent.');
      return;
    }

    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const threadTs = (body as any).message?.thread_ts || messageTs;
    await postMessage(channelId,
      `Selected *${agent.avatar_emoji} ${agent.name}*\n\nCurrent config: *${agent.model}* model | *${agent.permission_level}* perms | ${agent.tools.length} tools | memory ${agent.memory_enabled ? 'on' : 'off'} | channel <#${agent.channel_id}>\n\n_Reply in this thread with what you want to change — describe a problem, a tweak, or a full new goal._`,
      threadTs,
    );

    await execute(
      `DELETE FROM pending_confirmations WHERE data->>'type' = 'conversation' AND data->>'threadTs' = $1 AND data->>'userId' = $2`,
      [threadTs, userId],
    );
    await execute(
      `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [uuid(), JSON.stringify({
        type: 'conversation',
        step: 'awaiting_goal',
        flow: 'update_agent',
        agentId,
        userId,
        channelId,
        threadTs,
      })],
    );
  });

  // Handle channel selection for new agent (multi-select)
  app.action('new_agent_channel_select', async ({ action, ack, body }) => {
    await ack();
    const selectedChannels: string[] = (action as any).selected_conversations || [];
    if (selectedChannels.length === 0) return;

    const channelId = body.channel?.id;
    const threadTs = (body as any).message?.thread_ts || (body as any).message?.ts;
    const userId = body.user.id;
    if (!channelId || !threadTs) return;

    // Find the pending confirmation for this thread
    const row = await queryOne<{ id: string; data: any }>(
      `SELECT id, data FROM pending_confirmations
       WHERE data->>'type' = 'conversation'
         AND data->>'step' = 'awaiting_channel'
         AND data->>'threadTs' = $1
         AND data->>'userId' = $2
         AND expires_at > NOW()
       LIMIT 1`,
      [threadTs, userId],
    );
    if (!row) return;

    const conv = row.data;
    await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [row.id]);

    // Now create the confirmation with the selected channels
    if (conv.flow === 'new_agent') {
      await showNewAgentConfirmation(conv.analysis, conv.agentName, conv.goal, userId, channelId, threadTs, selectedChannels);
    } else if (conv.flow === 'update_agent') {
      await showUpdateAgentConfirmation(conv.analysis, conv.agentId, conv.goal, userId, channelId, threadTs, selectedChannels);
    }
  });

  // Handle "Create new channel" button
  app.action('new_agent_new_channel', async ({ ack, body }) => {
    await ack();
    const channelId = body.channel?.id;
    const threadTs = (body as any).message?.thread_ts || (body as any).message?.ts;
    const userId = body.user.id;
    if (!channelId || !threadTs) return;

    const row = await queryOne<{ id: string; data: any }>(
      `SELECT id, data FROM pending_confirmations
       WHERE data->>'type' = 'conversation'
         AND data->>'step' = 'awaiting_channel'
         AND data->>'threadTs' = $1
         AND data->>'userId' = $2
         AND expires_at > NOW()
       LIMIT 1`,
      [threadTs, userId],
    );
    if (!row) return;

    const conv = row.data;
    await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [row.id]);

    if (conv.flow === 'new_agent') {
      await showNewAgentConfirmation(conv.analysis, conv.agentName, conv.goal, userId, channelId, threadTs, null);
    }
  });

  // Handle channel selection for update-agent (multi-select)
  app.action('update_agent_channel_select', async ({ action, ack, body }) => {
    await ack();
    const selectedChannels: string[] = (action as any).selected_conversations || [];
    if (selectedChannels.length === 0) return;

    const channelId = body.channel?.id;
    const threadTs = (body as any).message?.thread_ts || (body as any).message?.ts;
    const userId = body.user.id;
    if (!channelId || !threadTs) return;

    const row = await queryOne<{ id: string; data: any }>(
      `SELECT id, data FROM pending_confirmations
       WHERE data->>'type' = 'conversation'
         AND data->>'step' = 'awaiting_channel'
         AND data->>'threadTs' = $1
         AND data->>'userId' = $2
         AND expires_at > NOW()
       LIMIT 1`,
      [threadTs, userId],
    );
    if (!row) return;

    const conv = row.data;
    await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [row.id]);
    await showUpdateAgentConfirmation(conv.analysis, conv.agentId, conv.goal, userId, channelId, threadTs, selectedChannels);
  });

  // Handle "Keep current channel" button for update-agent
  app.action('update_agent_keep_channel', async ({ ack, body }) => {
    await ack();
    const channelId = body.channel?.id;
    const threadTs = (body as any).message?.thread_ts || (body as any).message?.ts;
    const userId = body.user.id;
    if (!channelId || !threadTs) return;

    const row = await queryOne<{ id: string; data: any }>(
      `SELECT id, data FROM pending_confirmations
       WHERE data->>'type' = 'conversation'
         AND data->>'step' = 'awaiting_channel'
         AND data->>'threadTs' = $1
         AND data->>'userId' = $2
         AND expires_at > NOW()
       LIMIT 1`,
      [threadTs, userId],
    );
    if (!row) return;

    const conv = row.data;
    await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [row.id]);
    await showUpdateAgentConfirmation(conv.analysis, conv.agentId, conv.goal, userId, channelId, threadTs, null);
  });
}

// Handle thread replies for conversational flows
export async function handleConversationReply(
  userId: string,
  channelId: string,
  threadTs: string,
  text: string,
): Promise<boolean> {
  const row = await queryOne<{ id: string; data: any }>(
    `SELECT id, data FROM pending_confirmations
     WHERE data->>'type' = 'conversation'
       AND data->>'step' = 'awaiting_goal'
       AND data->>'threadTs' = $1
       AND data->>'userId' = $2
       AND expires_at > NOW()
     LIMIT 1`,
    [threadTs, userId],
  );

  if (!row) return false;

  const conv = row.data;
  const goal = text.trim();
  if (!goal) return false;

  await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [row.id]);

  if (conv.flow === 'new_agent') {
    await handleNewAgentGoal(goal, userId, channelId, threadTs);
  } else if (conv.flow === 'update_agent') {
    await handleUpdateAgentGoal(conv.agentId, goal, userId, channelId, threadTs);
  }

  return true;
}

async function handleNewAgentGoal(goal: string, userId: string, channelId: string, threadTs: string): Promise<void> {
  await postMessage(channelId, ':gear: Analyzing your goal and configuring the best agent setup...', threadTs);

  try {
    const analysis = await analyzeGoal(goal, undefined, userId);
    logger.info('Goal analysis complete', { agentName: analysis.agent_name, feasible: analysis.feasible, userId });

    // If not feasible, queue it and notify owner
    if (!analysis.feasible) {
      await handleInfeasibleRequest(analysis, goal, userId, channelId, threadTs);
      return;
    }

    let agentName = analysis.agent_name;
    if (await getAgentByName(agentName)) {
      agentName = `${agentName}-${Date.now().toString(36).slice(-4)}`;
    }

    // Ask: new channel or existing?
    await execute(
      `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [uuid(), JSON.stringify({
        type: 'conversation',
        step: 'awaiting_channel',
        flow: 'new_agent',
        analysis,
        agentName,
        goal,
        userId,
        channelId,
        threadTs,
      })],
    );

    await postBlocks(channelId, [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:white_check_mark: Agent *${agentName}* configured!\n\nWhere should this agent live? You can select multiple channels.` },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'multi_conversations_select',
            action_id: 'new_agent_channel_select',
            placeholder: { type: 'plain_text', text: 'Select channels...' },
            filter: { include: ['public', 'private'], exclude_bot_users: true },
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: ':heavy_plus_sign: Create new channel' },
            action_id: 'new_agent_new_channel',
          },
        ],
      },
    ], 'Choose channels for the agent', threadTs);
  } catch (err: any) {
    logger.error('Agent creation flow failed', { error: err.message, stack: err.stack, userId });
    await postMessage(channelId, `:x: Failed to analyze goal: ${err.message}`, threadTs);
  }
}

async function handleInfeasibleRequest(
  analysis: any, goal: string, userId: string, channelId: string, threadTs: string,
): Promise<void> {
  const requestId = uuid();
  const blockerList = analysis.blockers.map((b: string) => `• ${b}`).join('\n');

  // Store the full request with a long TTL (30 days)
  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [requestId, JSON.stringify({
      type: 'feature_request',
      analysis,
      goal,
      requestedBy: userId,
      requestedInChannel: channelId,
      requestedAt: new Date().toISOString(),
    })],
  );

  // Inform the requesting user
  await postMessage(channelId,
    `:clipboard: *Feature request queued!*\n\n` +
    `The agent you described requires capabilities that aren't available yet:\n${blockerList}\n\n` +
    `I've notified the team — we'll let you know once it's ready to be created.`,
    threadTs,
  );

  // DM the owner (first superadmin)
  const superadmins = await listSuperadmins();
  if (superadmins.length > 0) {
    const ownerId = superadmins[0].user_id;
    await sendDMBlocks(ownerId, [
      {
        type: 'header',
        text: { type: 'plain_text', text: ':inbox_tray: New Feature Request' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Requested by:* <@${userId}>\n*Goal:* ${goal.slice(0, 500)}\n\n*Blockers:*\n${blockerList}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Suggested agent name:* \`${analysis.agent_name}\`\n*Model:* ${analysis.model} | *Permissions:* ${analysis.permission_level}\n*Summary:* ${analysis.summary}`,
        },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: ':arrows_counterclockwise: Retry Creation' },
            style: 'primary',
            action_id: 'retry_agent_creation',
            value: requestId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: ':wastebasket: Dismiss' },
            action_id: 'dismiss_feature_request',
            value: requestId,
          },
        ],
      },
    ], `Feature request from <@${userId}>: ${goal.slice(0, 100)}`);
  }

  logger.info('Infeasible agent request queued', { requestId, userId, blockers: analysis.blockers });
}

async function showNewAgentConfirmation(
  analysis: any, agentName: string, goal: string, userId: string,
  channelId: string, threadTs: string, selectedChannels: string[] | null,
): Promise<void> {
  const confirmId = uuid();
  const channelLabel = selectedChannels?.length
    ? selectedChannels.map(c => `<#${c}>`).join(', ')
    : `#agent-${agentName}` + ' (new)';

  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
    [confirmId, JSON.stringify({ analysis, name: agentName, goal, userId, existingChannelIds: selectedChannels })],
  );

  const configSummary = buildConfigSummary(agentName, analysis, goal);
  await postBlocks(channelId, [
    { type: 'header', text: { type: 'plain_text', text: `New Agent: ${agentName}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Channels:* ${channelLabel}\n${configSummary}` } },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':white_check_mark: Confirm & Create' },
          style: 'primary',
          action_id: 'confirm_new_agent',
          value: confirmId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':x: Cancel' },
          action_id: 'cancel_new_agent',
          value: confirmId,
        },
      ],
    },
  ], `Agent configuration ready for ${agentName}`, threadTs);
}

async function handleUpdateAgentGoal(agentId: string, newGoal: string, userId: string, channelId: string, threadTs: string): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) {
    await postMessage(channelId, ':x: Agent not found.', threadTs);
    return;
  }

  await postMessage(channelId, `:gear: Analyzing updated goal for *${agent.name}*...`, threadTs);

  try {
    const analysis = await analyzeGoal(newGoal, agent.system_prompt, userId);

    // Ask about channel change
    await execute(
      `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [uuid(), JSON.stringify({
        type: 'conversation',
        step: 'awaiting_channel',
        flow: 'update_agent',
        analysis,
        agentId,
        goal: newGoal,
        userId,
        channelId,
        threadTs,
      })],
    );

    const currentChannels = agent.channel_ids?.length > 0 ? agent.channel_ids : [agent.channel_id];
    const currentChannelLabels = currentChannels.map((c: string) => `<#${c}>`).join(', ');
    await postBlocks(channelId, [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:white_check_mark: Updated config ready for *${agent.name}*!\n\nCurrently in ${currentChannelLabels}. Want to change channels?` },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'multi_conversations_select',
            action_id: 'update_agent_channel_select',
            placeholder: { type: 'plain_text', text: 'Select channels...' },
            filter: { include: ['public', 'private'], exclude_bot_users: true },
            initial_conversations: currentChannels,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: ':thumbsup: Keep current channels' },
            action_id: 'update_agent_keep_channel',
          },
        ],
      },
    ], 'Choose channels for updated agent', threadTs);
  } catch (err: any) {
    logger.error('Update goal analysis failed', { error: err.message, agentId, userId });
    await postMessage(channelId, `:x: Failed to analyze updated goal: ${err.message}`, threadTs);
  }
}

async function showUpdateAgentConfirmation(
  analysis: any, agentId: string, newGoal: string, userId: string,
  channelId: string, threadTs: string, newChannelIds: string[] | null,
): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) return;

  const confirmId = uuid();
  const currentChannels = agent.channel_ids?.length > 0 ? agent.channel_ids : [agent.channel_id];
  const channelsChanged = newChannelIds && JSON.stringify(newChannelIds.sort()) !== JSON.stringify(currentChannels.sort());
  const channelNote = channelsChanged
    ? `\n*Channels:* ${currentChannels.map(c => `<#${c}>`).join(', ')} → ${newChannelIds!.map(c => `<#${c}>`).join(', ')}`
    : '';

  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
    [confirmId, JSON.stringify({ analysis, name: agent.name, goal: newGoal, userId, agentId, newChannelIds })],
  );

  const configSummary = buildConfigSummary(agent.name, analysis, newGoal, agent);
  await postBlocks(channelId, [
    { type: 'header', text: { type: 'plain_text', text: `Update: ${agent.name}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `${channelNote}${channelNote ? '\n' : ''}${configSummary}` } },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':white_check_mark: Confirm & Update' },
          style: 'primary',
          action_id: 'confirm_update_agent',
          value: confirmId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':x: Cancel' },
          action_id: 'cancel_update_agent',
          value: confirmId,
        },
      ],
    },
  ], `Update configuration ready for ${agent.name}`, threadTs);
}

// ── Modal View Submission Handlers (no-ops for backward compat) ──

export function registerModalHandlers(app: App): void {
  app.view('new_agent_modal', async ({ ack }) => { await ack(); });
  app.view('new_agent_analyzing', async ({ ack }) => { await ack(); });
  app.view('update_agent_select_modal', async ({ ack }) => { await ack(); });
  app.view('update_agent_goal_modal', async ({ ack }) => { await ack(); });
  app.view('update_agent_processing', async ({ ack }) => { await ack(); });
}

// ── Confirmation Action Handlers ──

export function registerConfirmationActions(app: App): void {
  app.action('confirm_new_agent', async ({ action, ack, body }) => {
    await ack();
    const confirmId = (action as any).value;
    const row = await queryOne<{ data: any; expires_at: Date }>(
      `DELETE FROM pending_confirmations WHERE id = $1 RETURNING data, expires_at`, [confirmId],
    );

    if (!row || new Date(row.expires_at) < new Date()) {
      await replyToAction(body, ':x: This confirmation has expired. Please run `/new-agent` again.');
      return;
    }

    try {
      const { analysis, name, goal, userId, existingChannelIds, existingChannelId } = row.data;

      await replyToAction(body, ':gear: Creating agent...');

      // Use existing channels or create new one
      const channelIds: string[] = existingChannelIds || (existingChannelId ? [existingChannelId] : [await createChannel(name)]);

      const agent = await createAgent({
        name,
        channelId: channelIds[0],
        channelIds,
        systemPrompt: analysis.system_prompt,
        tools: analysis.tools,
        model: analysis.model,
        permissionLevel: analysis.permission_level,
        memoryEnabled: analysis.memory_enabled,
        respondToAllMessages: analysis.respond_to_all_messages,
        relevanceKeywords: analysis.relevance_keywords,
        createdBy: userId,
      });

      for (const skillName of analysis.skills) {
        try { await attachSkillToAgent(agent.id, skillName, 'read', userId); }
        catch (err: any) { logger.warn('Skill attach failed', { skillName, error: err.message }); }
      }

      for (const trigger of analysis.triggers) {
        try {
          await createTrigger({
            agentId: agent.id,
            triggerType: trigger.type,
            config: { ...trigger.config, description: trigger.description },
            createdBy: userId,
          });
        } catch (err: any) { logger.warn('Trigger creation failed', { trigger: trigger.type, error: err.message }); }
      }

      const createdItems: string[] = [];
      if (analysis.new_tools_needed?.length > 0) {
        const { authorTool } = await import('../modules/self-authoring');
        for (const tool of analysis.new_tools_needed) {
          try { await authorTool(agent.id, tool.description); createdItems.push(`tool: ${tool.name}`); }
          catch (err: any) { logger.warn('Auto-create tool failed', { error: err.message }); }
        }
      }
      if (analysis.new_skills_needed?.length > 0) {
        const { authorSkill } = await import('../modules/self-authoring');
        for (const skill of analysis.new_skills_needed) {
          try { await authorSkill(agent.id, skill.description); createdItems.push(`skill: ${skill.name}`); }
          catch (err: any) { logger.warn('Auto-create skill failed', { error: err.message }); }
        }
      }

      const lines = [
        `:white_check_mark: Agent *${agent.name}* is live! Created by <@${userId}>`,
        '',
        `*Goal:* ${goal.slice(0, 300)}`,
        `*Model:* ${analysis.model} | *Permissions:* ${analysis.permission_level} | *Memory:* ${analysis.memory_enabled ? 'on' : 'off'}`,
        `*Responds to:* ${analysis.respond_to_all_messages ? 'all messages' : 'relevant messages + @mentions'}`,
        `*Tools:* ${analysis.tools.join(', ')}`,
        analysis.skills.length > 0 ? `*Skills:* ${analysis.skills.join(', ')}` : '',
        analysis.triggers.length > 0 ? `*Triggers:* ${analysis.triggers.map((t: any) => t.description).join(', ')}` : '',
        createdItems.length > 0 ? `*Auto-created:* ${createdItems.join(', ')}` : '',
      ].filter(Boolean);

      // Post announcement in first channel
      await postMessage(channelIds[0], lines.join('\n'));
      const channelLabels = channelIds.map((c: string) => `<#${c}>`).join(', ');
      await replyToAction(body, `:white_check_mark: Agent *${agent.name}* created! Channels: ${channelLabels}`);

    } catch (err: any) {
      logger.error('Agent creation failed', { error: err.message });
      await replyToAction(body, `:x: Failed to create agent: ${err.message}`);
    }
  });

  app.action('cancel_new_agent', async ({ action, ack, body }) => {
    await ack();
    await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [(action as any).value]);
    await replyToAction(body, ':x: Agent creation cancelled.');
  });

  app.action('confirm_update_agent', async ({ action, ack, body }) => {
    await ack();
    const confirmId = (action as any).value;
    const row = await queryOne<{ data: any; expires_at: Date }>(
      `DELETE FROM pending_confirmations WHERE id = $1 RETURNING data, expires_at`, [confirmId],
    );

    if (!row || !row.data.agentId || new Date(row.expires_at) < new Date()) {
      await replyToAction(body, ':x: This confirmation has expired. Please run `/update-agent` again.');
      return;
    }

    try {
      const { analysis, agentId, userId, newChannelIds, newChannelId } = row.data;
      const agent = await getAgent(agentId!);
      if (!agent) throw new Error('Agent not found');

      await replyToAction(body, ':gear: Updating agent...');

      const updates: any = {
        system_prompt: analysis.system_prompt,
        tools: analysis.tools,
        model: analysis.model,
        permission_level: analysis.permission_level,
        memory_enabled: analysis.memory_enabled,
        respond_to_all_messages: analysis.respond_to_all_messages,
        relevance_keywords: analysis.relevance_keywords,
      };

      // Update channels if changed
      const effectiveChannelIds = newChannelIds || (newChannelId ? [newChannelId] : null);
      if (effectiveChannelIds) {
        const currentChannels = agent.channel_ids?.length > 0 ? agent.channel_ids : [agent.channel_id];
        if (JSON.stringify(effectiveChannelIds.sort()) !== JSON.stringify(currentChannels.sort())) {
          updates.channel_ids = effectiveChannelIds;
        }
      }

      await updateAgent(agentId!, updates, userId);

      for (const skillName of analysis.skills) {
        try { await attachSkillToAgent(agentId!, skillName, 'read', userId); } catch { /* may exist */ }
      }

      for (const trigger of analysis.triggers) {
        try {
          await createTrigger({
            agentId: agentId!,
            triggerType: trigger.type,
            config: { ...trigger.config, description: trigger.description },
            createdBy: userId,
          });
        } catch (err: any) { logger.warn('Trigger creation failed during update', { error: err.message }); }
      }

      if (analysis.new_tools_needed?.length > 0) {
        const { authorTool } = await import('../modules/self-authoring');
        for (const tool of analysis.new_tools_needed) {
          try { await authorTool(agentId!, tool.description); } catch { /* best effort */ }
        }
      }
      if (analysis.new_skills_needed?.length > 0) {
        const { authorSkill } = await import('../modules/self-authoring');
        for (const skill of analysis.new_skills_needed) {
          try { await authorSkill(agentId!, skill.description); } catch { /* best effort */ }
        }
      }

      const updatedAgent = await getAgent(agentId!);
      const postToChannel = updatedAgent?.channel_ids?.[0] || updatedAgent?.channel_id || agent.channel_id;
      const channelChangeNote = updates.channel_ids
        ? `\n*Channels:* ${updates.channel_ids.map((c: string) => `<#${c}>`).join(', ')}`
        : '';

      await postMessage(postToChannel,
        `:arrows_counterclockwise: Agent *${agent.name}* updated by <@${userId}>\n\n` +
        `*Model:* ${analysis.model} | *Permissions:* ${analysis.permission_level} | *Memory:* ${analysis.memory_enabled ? 'on' : 'off'}\n` +
        `*Responds to:* ${analysis.respond_to_all_messages ? 'all messages' : 'relevant messages + @mentions'}\n` +
        `*Tools:* ${analysis.tools.join(', ')}` +
        channelChangeNote + '\n' +
        `_${analysis.summary}_`
      );
      await replyToAction(body, `:white_check_mark: Agent *${agent.name}* updated!`);

    } catch (err: any) {
      logger.error('Agent update failed', { error: err.message });
      await replyToAction(body, `:x: Failed to update agent: ${err.message}`);
    }
  });

  app.action('cancel_update_agent', async ({ action, ack, body }) => {
    await ack();
    await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [(action as any).value]);
    await replyToAction(body, ':x: Agent update cancelled.');
  });

  // ── Feature Request Queue Actions ──

  app.action('retry_agent_creation', async ({ action, ack, body }) => {
    await ack();
    const requestId = (action as any).value;
    const row = await queryOne<{ data: any }>(
      `SELECT data FROM pending_confirmations WHERE id = $1`, [requestId],
    );

    if (!row || row.data.type !== 'feature_request') {
      await replyToAction(body, ':x: This feature request no longer exists or has already been processed.');
      return;
    }

    const { analysis, goal, requestedBy, requestedInChannel } = row.data;

    await replyToAction(body, ':gear: Re-analyzing and creating agent...');

    try {
      // Re-analyze the goal (capabilities may have changed since the request was made)
      const freshAnalysis = await analyzeGoal(goal, undefined, requestedBy);

      if (!freshAnalysis.feasible) {
        const blockerList = freshAnalysis.blockers.map((b: string) => `• ${b}`).join('\n');
        await replyToAction(body, `:warning: Still not feasible. Remaining blockers:\n${blockerList}`);
        return;
      }

      let agentName = freshAnalysis.agent_name;
      if (await getAgentByName(agentName)) {
        agentName = `${agentName}-${Date.now().toString(36).slice(-4)}`;
      }

      // Create a new channel for the agent
      const agentChannelId = await createChannel(agentName);

      const agent = await createAgent({
        name: agentName,
        channelId: agentChannelId,
        systemPrompt: freshAnalysis.system_prompt,
        tools: freshAnalysis.tools,
        model: freshAnalysis.model,
        permissionLevel: freshAnalysis.permission_level,
        memoryEnabled: freshAnalysis.memory_enabled,
        respondToAllMessages: freshAnalysis.respond_to_all_messages,
        relevanceKeywords: freshAnalysis.relevance_keywords,
        createdBy: requestedBy,
      });

      for (const skillName of freshAnalysis.skills) {
        try { await attachSkillToAgent(agent.id, skillName, 'read', requestedBy); }
        catch (err: any) { logger.warn('Skill attach failed', { skillName, error: err.message }); }
      }

      for (const trigger of freshAnalysis.triggers) {
        try {
          await createTrigger({
            agentId: agent.id,
            triggerType: trigger.type,
            config: { ...trigger.config, description: trigger.description },
            createdBy: requestedBy,
          });
        } catch (err: any) { logger.warn('Trigger creation failed', { error: err.message }); }
      }

      if (freshAnalysis.new_tools_needed?.length > 0) {
        const { authorTool } = await import('../modules/self-authoring');
        for (const tool of freshAnalysis.new_tools_needed) {
          try { await authorTool(agent.id, tool.description); } catch { /* best effort */ }
        }
      }
      if (freshAnalysis.new_skills_needed?.length > 0) {
        const { authorSkill } = await import('../modules/self-authoring');
        for (const skill of freshAnalysis.new_skills_needed) {
          try { await authorSkill(agent.id, skill.description); } catch { /* best effort */ }
        }
      }

      // Remove the feature request
      await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [requestId]);

      // Notify the original requester
      await postMessage(requestedInChannel,
        `:tada: <@${requestedBy}> Your agent *${agent.name}* has been created! Head over to <#${agentChannelId}> to start using it.`
      );

      // Confirm to the owner
      await replyToAction(body,
        `:white_check_mark: Agent *${agent.name}* created from feature request! <@${requestedBy}> has been notified in <#${requestedInChannel}>.`
      );

      logger.info('Feature request fulfilled', { requestId, agentId: agent.id, agentName });
    } catch (err: any) {
      logger.error('Feature request retry failed', { error: err.message, requestId });
      await replyToAction(body, `:x: Failed to create agent: ${err.message}`);
    }
  });

  app.action('dismiss_feature_request', async ({ action, ack, body }) => {
    await ack();
    const requestId = (action as any).value;
    await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [requestId]);
    await replyToAction(body, ':wastebasket: Feature request dismissed.');
  });
}

// ── Helpers ──

function buildConfigSummary(name: string, analysis: any, goal: string, existingAgent?: any): string {
  const lines: string[] = [];

  lines.push(`*Goal:* ${goal.slice(0, 300)}${goal.length > 300 ? '...' : ''}`);
  lines.push('');
  lines.push(`*Name:* ${name}`);
  lines.push(`*Model:* \`${analysis.model}\``);
  lines.push(`*Permissions:* \`${analysis.permission_level}\``);
  lines.push(`*Memory:* ${analysis.memory_enabled ? 'enabled' : 'disabled'}`);
  lines.push(`*Tools:* ${analysis.tools.join(', ')}`);

  if (analysis.skills?.length > 0) {
    lines.push(`*Skills:* ${analysis.skills.join(', ')}`);
  }

  // When will it respond section
  lines.push('');
  lines.push('*:zap: When will it respond:*');
  if (analysis.respond_to_all_messages) {
    lines.push('• Responds to *every message* in the channel');
  } else {
    lines.push('• Responds when *@mentioned*');
    if (analysis.relevance_keywords?.length > 0) {
      lines.push(`• Auto-responds to messages containing: ${analysis.relevance_keywords.slice(0, 10).join(', ')}`);
    }
  }
  if (analysis.triggers?.length > 0) {
    for (const t of analysis.triggers as any[]) {
      lines.push(`• Triggered by *${t.type}*: ${t.description}`);
    }
  }
  if (analysis.new_tools_needed?.length > 0) {
    lines.push(`*Will create tools:* ${analysis.new_tools_needed.map((t: any) => t.name).join(', ')}`);
  }
  if (analysis.new_skills_needed?.length > 0) {
    lines.push(`*Will create skills:* ${analysis.new_skills_needed.map((s: any) => s.name).join(', ')}`);
  }

  if (existingAgent) {
    const changes: string[] = [];
    if (existingAgent.model !== analysis.model) changes.push(`model: ${existingAgent.model} → ${analysis.model}`);
    if (existingAgent.permission_level !== analysis.permission_level) changes.push(`permissions: ${existingAgent.permission_level} → ${analysis.permission_level}`);
    if (JSON.stringify(existingAgent.tools.sort()) !== JSON.stringify(analysis.tools.sort())) changes.push('tools changed');
    if (existingAgent.memory_enabled !== analysis.memory_enabled) changes.push(`memory: ${analysis.memory_enabled ? 'enabled' : 'disabled'}`);
    if (changes.length > 0) {
      lines.push('');
      lines.push(`*Changes from current:* ${changes.join(' | ')}`);
    }
  }

  lines.push('');
  lines.push(`_${analysis.summary}_`);

  return lines.join('\n');
}

async function replyToAction(body: any, text: string): Promise<void> {
  try {
    const channelId = body.channel?.id || body.container?.channel_id;
    const messageTs = body.message?.ts;
    if (channelId && messageTs) {
      await postMessage(channelId, text, messageTs);
    } else if (channelId) {
      await postMessage(channelId, text);
    }
  } catch (err: any) {
    logger.warn('Failed to reply to action', { error: err.message });
  }
}

// ── Legacy exports (no-op) ──

export async function handleWizardMessage(_u: string, _c: string, _t: string): Promise<string | null> { return null; }
export function isInWizard(_u: string, _c: string): boolean { return false; }
