import type { App } from '@slack/bolt';
import { v4 as uuid } from 'uuid';
import { createAgent, listAgents, getAgent, getAgentByName, updateAgent } from '../modules/agents';
import { initSuperadmin, canModifyAgent } from '../modules/access-control';
import { createChannel, postMessage, openModal } from './index';
import { analyzeGoal } from '../modules/agents/goal-analyzer';
import { attachSkillToAgent } from '../modules/skills';
import { createTrigger } from '../modules/triggers';
import { logger } from '../utils/logger';

// ── Pending confirmations store (analysis results waiting for user confirmation) ──
const pendingConfirmations = new Map<string, {
  analysis: any;
  name: string;
  goal: string;
  userId: string;
  agentId?: string; // present for updates
  expiresAt: number;
}>();

export function registerCommands(app: App): void {
  // /new-agent — Open agent creation modal (just asks for goal)
  app.command('/new-agent', async ({ command, ack }) => {
    await ack();
    initSuperadmin(command.user_id);

    await openModal(command.trigger_id, {
      type: 'modal',
      callback_id: 'new_agent_modal',
      title: { type: 'plain_text', text: 'Create New Agent' },
      submit: { type: 'plain_text', text: 'Create Agent' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Describe what you want this agent to do. Everything else — name, tools, skills, triggers, model, permissions — will be auto-configured.',
          },
        },
        {
          type: 'input',
          block_id: 'agent_goal',
          element: {
            type: 'plain_text_input',
            action_id: 'goal_input',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: 'e.g. "Triage incoming Zendesk tickets, classify severity P0-P3, and route to the right team. Should trigger on every new ticket. Respond in a professional but concise tone."',
            },
          },
          label: { type: 'plain_text', text: 'What should this agent do?' },
        },
      ],
    });
  });

  // /update-agent — Select agent then provide updated goal
  app.command('/update-agent', async ({ command, ack }) => {
    await ack();
    const userId = command.user_id;

    const agents = listAgents();
    if (agents.length === 0) {
      await postMessage(command.channel_id, 'No agents exist yet. Use `/new-agent` to create one.');
      return;
    }

    const editableAgents = agents.filter(a => canModifyAgent(a.id, userId));
    if (editableAgents.length === 0) {
      await postMessage(command.channel_id, 'You don\'t have permission to update any agents.');
      return;
    }

    await openModal(command.trigger_id, {
      type: 'modal',
      callback_id: 'update_agent_select_modal',
      title: { type: 'plain_text', text: 'Update Agent' },
      submit: { type: 'plain_text', text: 'Next' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'agent_select',
          element: {
            type: 'static_select',
            action_id: 'agent_choice',
            placeholder: { type: 'plain_text', text: 'Choose an agent...' },
            options: editableAgents.map(a => ({
              text: { type: 'plain_text' as const, text: `${a.avatar_emoji} ${a.name}` },
              value: a.id,
            })),
          },
          label: { type: 'plain_text', text: 'Which agent to update?' },
        },
      ],
    });
  });

  // /agents — List all agents
  app.command('/agents', async ({ command, ack, respond }) => {
    await ack();
    const agents = listAgents();
    if (agents.length === 0) {
      await respond({ text: 'No agents created yet. Use `/new-agent` to create one.', response_type: 'ephemeral' });
      return;
    }
    const lines = agents.map(a =>
      `${a.avatar_emoji} *${a.name}* — <#${a.channel_id}> — ${a.status} — ${a.model} — ${a.permission_level}`
    );
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
        const results = searchKB(query);
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

// ── Modal View Submission Handlers ──

export function registerModalHandlers(app: App): void {
  // ── New Agent: Goal → Analyze → Confirm ──
  app.view('new_agent_modal', async ({ ack, view, body }) => {
    const userId = body.user.id;
    const goal = view.state.values.agent_goal.goal_input.value?.trim() || '';

    if (!goal) {
      await ack({ response_action: 'errors', errors: { agent_goal: 'Please describe what the agent should do' } });
      return;
    }

    // Show analyzing state
    await ack({
      response_action: 'update',
      view: buildLoadingModal('new_agent_analyzing', 'Analyzing...', 'Deeply analyzing your goal to configure the best agent setup. This takes a few seconds...'),
    });

    try {
      const analysis = await analyzeGoal(goal);
      const confirmId = uuid();

      // Validate name uniqueness, auto-suffix if needed
      let agentName = analysis.agent_name;
      if (getAgentByName(agentName)) {
        agentName = `${agentName}-${Date.now().toString(36).slice(-4)}`;
      }

      pendingConfirmations.set(confirmId, {
        analysis,
        name: agentName,
        goal,
        userId,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      // Post confirmation to DM since we can't update the modal after async work
      const { getSlackApp } = await import('./index');
      const client = getSlackApp().client;
      const dm = await client.conversations.open({ users: userId });
      if (!dm.channel?.id) throw new Error('Could not open DM');

      const configSummary = buildConfigSummary(agentName, analysis, goal);

      await client.chat.postMessage({
        channel: dm.channel.id,
        text: `Agent configuration ready for *${agentName}*`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: `New Agent: ${agentName}` } },
          { type: 'section', text: { type: 'mrkdwn', text: configSummary } },
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
        ],
      });
    } catch (err: any) {
      logger.error('Goal analysis failed', { error: err.message, userId });
      try {
        const { getSlackApp } = await import('./index');
        const client = getSlackApp().client;
        const dm = await client.conversations.open({ users: userId });
        if (dm.channel?.id) {
          await postMessage(dm.channel.id, `:x: Failed to analyze goal: ${err.message}`);
        }
      } catch { /* best effort */ }
    }
  });

  // ── Update Agent: Select → Goal → Analyze → Confirm ──
  app.view('update_agent_select_modal', async ({ ack, view, body }) => {
    const userId = body.user.id;
    const agentId = view.state.values.agent_select.agent_choice.selected_option?.value;
    if (!agentId) { await ack({ response_action: 'errors', errors: { agent_select: 'Please select an agent' } }); return; }

    const agent = getAgent(agentId);
    if (!agent) { await ack({ response_action: 'errors', errors: { agent_select: 'Agent not found' } }); return; }
    if (!canModifyAgent(agentId, userId)) { await ack({ response_action: 'errors', errors: { agent_select: 'Permission denied' } }); return; }

    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        callback_id: 'update_agent_goal_modal',
        private_metadata: agentId,
        title: { type: 'plain_text', text: `Update ${agent.name}` },
        submit: { type: 'plain_text', text: 'Update Agent' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `Current: *${agent.model}* model | *${agent.permission_level}* perms | ${agent.tools.length} tools | memory ${agent.memory_enabled ? 'on' : 'off'}` }],
          },
          {
            type: 'input',
            block_id: 'new_goal',
            element: {
              type: 'plain_text_input',
              action_id: 'goal_input',
              multiline: true,
              placeholder: { type: 'plain_text', text: 'Describe the updated goal. All configuration will be re-derived from this.' },
            },
            label: { type: 'plain_text', text: 'What should this agent do now?' },
          },
        ],
      },
    });
  });

  app.view('update_agent_goal_modal', async ({ ack, view, body }) => {
    const userId = body.user.id;
    const agentId = view.private_metadata;
    const newGoal = view.state.values.new_goal.goal_input.value?.trim() || '';
    if (!newGoal) { await ack({ response_action: 'errors', errors: { new_goal: 'Goal is required' } }); return; }

    const agent = getAgent(agentId);
    if (!agent || !canModifyAgent(agentId, userId)) {
      await ack({ response_action: 'errors', errors: { new_goal: 'Agent not found or permission denied' } });
      return;
    }

    await ack({
      response_action: 'update',
      view: buildLoadingModal('update_agent_processing', 'Analyzing...', 'Analyzing updated goal and reconfiguring agent...'),
    });

    try {
      const analysis = await analyzeGoal(newGoal, agent.system_prompt);
      const confirmId = uuid();

      pendingConfirmations.set(confirmId, {
        analysis,
        name: agent.name,
        goal: newGoal,
        userId,
        agentId,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      const { getSlackApp } = await import('./index');
      const client = getSlackApp().client;
      const dm = await client.conversations.open({ users: userId });
      if (!dm.channel?.id) throw new Error('Could not open DM');

      const configSummary = buildConfigSummary(agent.name, analysis, newGoal, agent);

      await client.chat.postMessage({
        channel: dm.channel.id,
        text: `Update configuration ready for *${agent.name}*`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: `Update: ${agent.name}` } },
          { type: 'section', text: { type: 'mrkdwn', text: configSummary } },
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
        ],
      });
    } catch (err: any) {
      logger.error('Update goal analysis failed', { error: err.message, agentId, userId });
      try {
        await postMessage(agent.channel_id, `:x: Failed to analyze updated goal: ${err.message}`);
      } catch { /* best effort */ }
    }
  });

  // No-op handlers for loading modals
  app.view('new_agent_analyzing', async ({ ack }) => { await ack(); });
  app.view('update_agent_processing', async ({ ack }) => { await ack(); });
}

// ── Confirmation Action Handlers ──

export function registerConfirmationActions(app: App): void {
  // Confirm new agent creation
  app.action('confirm_new_agent', async ({ action, ack, body }) => {
    await ack();
    const confirmId = (action as any).value;
    const pending = pendingConfirmations.get(confirmId);

    if (!pending || Date.now() > pending.expiresAt) {
      await replyToAction(body, ':x: This confirmation has expired. Please run `/new-agent` again.');
      pendingConfirmations.delete(confirmId);
      return;
    }
    pendingConfirmations.delete(confirmId);

    try {
      const { analysis, name, goal, userId } = pending;

      await replyToAction(body, ':gear: Creating agent...');

      const channelId = await createChannel(name);

      const agent = createAgent({
        name,
        channelId,
        systemPrompt: analysis.system_prompt,
        tools: analysis.tools,
        model: analysis.model,
        permissionLevel: analysis.permission_level,
        memoryEnabled: analysis.memory_enabled,
        respondToAllMessages: analysis.respond_to_all_messages,
        relevanceKeywords: analysis.relevance_keywords,
        createdBy: userId,
      });

      // Attach skills
      for (const skillName of analysis.skills) {
        try { attachSkillToAgent(agent.id, skillName, 'read', userId); }
        catch (err: any) { logger.warn('Skill attach failed', { skillName, error: err.message }); }
      }

      // Create triggers
      for (const trigger of analysis.triggers) {
        try {
          createTrigger({
            agentId: agent.id,
            triggerType: trigger.type,
            config: { ...trigger.config, description: trigger.description },
            createdBy: userId,
          });
        } catch (err: any) { logger.warn('Trigger creation failed', { trigger: trigger.type, error: err.message }); }
      }

      // Auto-create custom tools/skills
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

      // Announce in agent channel
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

      await postMessage(channelId, lines.join('\n'));
      await replyToAction(body, `:white_check_mark: Agent *${agent.name}* created! Channel: <#${channelId}>`);

    } catch (err: any) {
      logger.error('Agent creation failed', { error: err.message });
      await replyToAction(body, `:x: Failed to create agent: ${err.message}`);
    }
  });

  app.action('cancel_new_agent', async ({ action, ack, body }) => {
    await ack();
    pendingConfirmations.delete((action as any).value);
    await replyToAction(body, ':x: Agent creation cancelled.');
  });

  // Confirm agent update
  app.action('confirm_update_agent', async ({ action, ack, body }) => {
    await ack();
    const confirmId = (action as any).value;
    const pending = pendingConfirmations.get(confirmId);

    if (!pending || !pending.agentId || Date.now() > pending.expiresAt) {
      await replyToAction(body, ':x: This confirmation has expired. Please run `/update-agent` again.');
      pendingConfirmations.delete(confirmId);
      return;
    }
    pendingConfirmations.delete(confirmId);

    try {
      const { analysis, agentId, userId } = pending;
      const agent = getAgent(agentId!);
      if (!agent) throw new Error('Agent not found');

      await replyToAction(body, ':gear: Updating agent...');

      updateAgent(agentId!, {
        system_prompt: analysis.system_prompt,
        tools: analysis.tools,
        model: analysis.model,
        permission_level: analysis.permission_level,
        memory_enabled: analysis.memory_enabled,
        respond_to_all_messages: analysis.respond_to_all_messages,
        relevance_keywords: analysis.relevance_keywords,
      }, userId);

      // Attach new skills
      for (const skillName of analysis.skills) {
        try { attachSkillToAgent(agentId!, skillName, 'read', userId); } catch { /* may exist */ }
      }

      // Create new triggers
      for (const trigger of analysis.triggers) {
        try {
          createTrigger({
            agentId: agentId!,
            triggerType: trigger.type,
            config: { ...trigger.config, description: trigger.description },
            createdBy: userId,
          });
        } catch (err: any) { logger.warn('Trigger creation failed during update', { error: err.message }); }
      }

      // Auto-create tools/skills
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

      await postMessage(agent.channel_id,
        `:arrows_counterclockwise: Agent *${agent.name}* updated by <@${userId}>\n\n` +
        `*Model:* ${analysis.model} | *Permissions:* ${analysis.permission_level} | *Memory:* ${analysis.memory_enabled ? 'on' : 'off'}\n` +
        `*Responds to:* ${analysis.respond_to_all_messages ? 'all messages' : 'relevant messages + @mentions'}\n` +
        `*Tools:* ${analysis.tools.join(', ')}\n` +
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
    pendingConfirmations.delete((action as any).value);
    await replyToAction(body, ':x: Agent update cancelled.');
  });
}

// ── Helpers ──

function buildLoadingModal(callbackId: string, title: string, message: string) {
  return {
    type: 'modal' as const,
    callback_id: callbackId,
    title: { type: 'plain_text' as const, text: title },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `:gear: ${message}` } },
    ],
  };
}

function buildConfigSummary(name: string, analysis: any, goal: string, existingAgent?: any): string {
  const lines: string[] = [];

  lines.push(`*Goal:* ${goal.slice(0, 300)}${goal.length > 300 ? '...' : ''}`);
  lines.push('');
  lines.push(`*Name:* ${name}`);
  lines.push(`*Model:* \`${analysis.model}\``);
  lines.push(`*Permissions:* \`${analysis.permission_level}\``);
  lines.push(`*Memory:* ${analysis.memory_enabled ? 'enabled' : 'disabled'}`);
  lines.push(`*Responds to:* ${analysis.respond_to_all_messages ? 'all messages' : 'relevant messages + @mentions'}`);
  lines.push(`*Tools:* ${analysis.tools.join(', ')}`);

  if (analysis.skills?.length > 0) {
    lines.push(`*Skills:* ${analysis.skills.join(', ')}`);
  }
  if (analysis.triggers?.length > 0) {
    lines.push(`*Triggers:* ${(analysis.triggers as any[]).map((t: any) => `${t.type}: ${t.description}`).join(', ')}`);
  }
  if (analysis.relevance_keywords?.length > 0) {
    lines.push(`*Keywords:* ${analysis.relevance_keywords.slice(0, 10).join(', ')}`);
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

// ── Legacy exports (no-op, wizard removed) ──

export async function handleWizardMessage(_u: string, _c: string, _t: string): Promise<string | null> { return null; }
export function isInWizard(_u: string, _c: string): boolean { return false; }
