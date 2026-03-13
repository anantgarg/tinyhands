import type { App } from '@slack/bolt';
import { v4 as uuid } from 'uuid';
import { createAgent, listAgents, getAgent, getAgentByName, updateAgent, getAccessibleAgents, addAgentMembers, getAgentMembers, addAgentMember, removeAgentMember } from '../modules/agents';
import { initSuperadmin, canModifyAgent, listSuperadmins } from '../modules/access-control';
import { createChannel, postMessage, postBlocks, getSlackApp, sendDMBlocks, openModal, pushModal } from './index';
import { analyzeGoal } from '../modules/agents/goal-analyzer';
import { attachSkillToAgent } from '../modules/skills';
import { createTrigger } from '../modules/triggers';
import { logger } from '../utils/logger';
import { execute, queryOne } from '../db';
import { getToolIntegrations, getIntegration } from '../modules/tools/integrations';

// ── Available Tool Integrations ──
// Auto-discovered from src/modules/tools/integrations/*/index.ts

const TOOL_INTEGRATIONS = getToolIntegrations();

export function registerCommands(app: App): void {
  // /agents — Consolidated interactive agent management
  app.command('/agents', async ({ command, ack, respond }) => {
    await ack();
    await initSuperadmin(command.user_id);
    const userId = command.user_id;

    const agents = await getAccessibleAgents(userId);

    const blocks: any[] = [
      { type: 'header', text: { type: 'plain_text', text: `:robot_face: Agents (${agents.length})` } },
    ];

    if (agents.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_I\'m currently empty-handed, which is a bit embarrassing. Click below to build your first teammate._' },
      });
    } else {
      for (const a of agents) {
        const channels = (a.channel_ids?.length > 0 ? a.channel_ids : [a.channel_id]).map((c: string) => `<#${c}>`).join(', ');
        const statusIcon = a.status === 'active' ? ':large_green_circle:' : a.status === 'paused' ? ':double_vertical_bar:' : ':red_circle:';
        const visibilityIcon = a.visibility === 'private' ? ' :lock:' : '';

        const overflowOptions: any[] = [
          { text: { type: 'plain_text', text: ':gear: View Config' }, value: `view_config:${a.id}` },
          { text: { type: 'plain_text', text: ':pencil: Update' }, value: `update:${a.id}` },
        ];

        if (a.status === 'active') {
          overflowOptions.push({ text: { type: 'plain_text', text: ':double_vertical_bar: Pause' }, value: `pause:${a.id}` });
        } else if (a.status === 'paused') {
          overflowOptions.push({ text: { type: 'plain_text', text: ':arrow_forward: Resume' }, value: `resume:${a.id}` });
        }

        if (a.visibility === 'private' && await canModifyAgent(a.id, userId)) {
          overflowOptions.push({ text: { type: 'plain_text', text: ':busts_in_silhouette: Members' }, value: `members:${a.id}` });
        }

        if (await canModifyAgent(a.id, userId)) {
          overflowOptions.push({ text: { type: 'plain_text', text: ':wastebasket: Delete' }, value: `delete:${a.id}` });
        }

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusIcon} *${a.avatar_emoji} ${a.name}*${visibilityIcon}\n${channels} · ${a.model} · ${maxTurnsToEffort(a.max_turns)} effort · ${a.tools.length} tools · memory ${a.memory_enabled ? 'on' : 'off'}`,
          },
          accessory: {
            type: 'overflow',
            action_id: 'agent_overflow',
            options: overflowOptions,
          },
        });
      }
    }

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':heavy_plus_sign: New Agent' },
          style: 'primary',
          action_id: 'agents_new_agent',
        },
      ],
    });

    await respond({ response_type: 'ephemeral', blocks, text: 'Agents' });
  });

  // /new-agent — Alias, starts new agent flow directly
  app.command('/new-agent', async ({ command, ack }) => {
    await ack();
    await initSuperadmin(command.user_id);
    await startNewAgentFlow(command.user_id, command.channel_id);
  });

  // /update-agent — Alias, shows agent selector
  app.command('/update-agent', async ({ command, ack }) => {
    await ack();
    await startUpdateAgentFlow(command.user_id, command.channel_id);
  });

  // /tools — Interactive admin tool management
  app.command('/tools', async ({ command, ack, respond }) => {
    await ack();
    const userId = command.user_id;

    const { isSuperadmin } = await import('../modules/access-control');
    if (!(await isSuperadmin(userId))) {
      await respond({ response_type: 'ephemeral', text: ':lock: Only admins can manage tools. Use `/agents` to create agents with existing tools.' });
      return;
    }

    const { listCustomTools: listAll, getCustomTool } = await import('../modules/tools');
    const tools = await listAll();
    const registeredNames = new Set(tools.map(t => t.name));

    const blocks: any[] = [
      { type: 'header', text: { type: 'plain_text', text: `:toolbox: Tools` } },
    ];

    // ── Registered Tools ──
    if (tools.length > 0) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: *Registered (${tools.length})*` } });

      for (const t of tools) {
        const config = JSON.parse(t.config_json || '{}');
        const configKeys = Object.keys(config);
        const schema = JSON.parse(t.schema_json || '{}');
        const desc = schema.description ? schema.description.slice(0, 100) : '';
        const statusIcon = configKeys.length > 0 ? ':large_green_circle:' : ':yellow_circle:';
        const configNote = configKeys.length > 0
          ? `Config: ${configKeys.map(k => `\`${k}\``).join(', ')}`
          : '_Needs config — click :gear: Configure_';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusIcon} *${t.name}* — \`${t.access_level}\` · \`${t.language}\`\n${desc}\n${configNote}`,
          },
          accessory: {
            type: 'overflow',
            action_id: 'tool_overflow',
            options: [
              { text: { type: 'plain_text', text: ':gear: Configure' }, value: `configure:${t.name}` },
              { text: { type: 'plain_text', text: ':shield: Change Access Level' }, value: `access:${t.name}` },
              { text: { type: 'plain_text', text: ':link: Add to Agent' }, value: `add_to_agent:${t.name}` },
              ...(!t.approved ? [{ text: { type: 'plain_text' as const, text: ':white_check_mark: Approve' }, value: `approve:${t.name}` }] : []),
              { text: { type: 'plain_text', text: ':wastebasket: Delete' }, value: `delete:${t.name}` },
            ],
          },
        });
      }
      blocks.push({ type: 'divider' });
    }

    // ── Available Integrations (not yet registered) ──
    const availableIntegrations = TOOL_INTEGRATIONS.filter(
      i => i.tools.some(t => !registeredNames.has(t)),
    );

    if (availableIntegrations.length > 0) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `:heavy_plus_sign: *Available Integrations*` } });

      for (const integration of availableIntegrations) {
        const unregistered = integration.tools.filter(t => !registeredNames.has(t));
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${integration.icon} *${integration.label}*\n${integration.description}\nTools: ${unregistered.map(t => `\`${t}\``).join(', ')}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: ':heavy_plus_sign: Register' },
            action_id: 'register_tool_integration',
            value: integration.id,
          },
        });
      }
    }

    if (tools.length === 0 && availableIntegrations.length === 0) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No tools available._' } });
    }

    await respond({ response_type: 'ephemeral', blocks, text: 'Tools' });
  });

  // /kb — Interactive knowledge base management
  app.command('/kb', async ({ command, ack, respond }) => {
    await ack();
    const userId = command.user_id;
    const subcommand = command.text.trim().split(/\s+/)[0]?.toLowerCase() || '';
    const { isSuperadmin } = await import('../modules/access-control');
    const isAdmin = await isSuperadmin(userId);

    if (subcommand === 'search') {
      const queryText = command.text.trim().slice('search'.length).trim();
      if (!queryText) {
        await respond({ response_type: 'ephemeral', text: 'Usage: `/kb search <query>`' });
        return;
      }
      const { searchKB } = await import('../modules/knowledge-base');
      const results = await searchKB(queryText);
      if (results.length === 0) {
        await respond({ response_type: 'ephemeral', text: ':mag: No KB entries found.' });
        return;
      }
      const blocks: any[] = [
        { type: 'header', text: { type: 'plain_text', text: `:mag: KB Results (${results.length})` } },
      ];
      for (const r of results.slice(0, 10)) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*${r.title}* (${r.category})\n${r.summary.slice(0, 200)}` },
          ...(isAdmin ? {
            accessory: {
              type: 'overflow',
              action_id: 'kb_entry_overflow',
              options: [
                { text: { type: 'plain_text', text: ':eyes: View' }, value: `view:${r.id}` },
                { text: { type: 'plain_text', text: ':wastebasket: Delete' }, value: `delete:${r.id}` },
              ],
            },
          } : {}),
        });
      }
      await respond({ response_type: 'ephemeral', blocks, text: 'KB search results' });
      return;
    }

    if (subcommand === 'add') {
      await openModal(command.trigger_id, {
        type: 'modal',
        callback_id: 'kb_add_modal',
        title: { type: 'plain_text', text: 'Add KB Entry' },
        submit: { type: 'plain_text', text: 'Add' },
        blocks: [
          {
            type: 'input', block_id: 'title_block',
            label: { type: 'plain_text', text: 'Title' },
            element: { type: 'plain_text_input', action_id: 'title_input', placeholder: { type: 'plain_text', text: 'e.g. Zendesk API Rate Limits' } },
          },
          {
            type: 'input', block_id: 'category_block',
            label: { type: 'plain_text', text: 'Category' },
            element: {
              type: 'static_select', action_id: 'category_input',
              options: ['General', 'Engineering', 'Product', 'Support', 'Sales', 'HR', 'Legal', 'Finance', 'Operations'].map(c => ({
                text: { type: 'plain_text' as const, text: c }, value: c.toLowerCase(),
              })),
            },
          },
          {
            type: 'input', block_id: 'content_block',
            label: { type: 'plain_text', text: 'Content' },
            element: { type: 'plain_text_input', action_id: 'content_input', multiline: true, placeholder: { type: 'plain_text', text: 'Paste the knowledge content here...' } },
          },
          {
            type: 'input', block_id: 'tags_block', optional: true,
            label: { type: 'plain_text', text: 'Tags (comma-separated)' },
            element: { type: 'plain_text_input', action_id: 'tags_input', placeholder: { type: 'plain_text', text: 'e.g. zendesk, api, limits' } },
          },
        ],
      });
      return;
    }

    // Default: show KB dashboard (admin gets full view with sources)
    if (!isAdmin) {
      await respond({ response_type: 'ephemeral', text: 'Usage: `/kb search <query>` or `/kb add`' });
      return;
    }

    const { listKBEntries, listPendingEntries, getCategories } = await import('../modules/knowledge-base');
    const { listSources } = await import('../modules/kb-sources');
    const [entries, pending, categories, sources] = await Promise.all([
      listKBEntries(10), listPendingEntries(), getCategories(), listSources(),
    ]);

    const blocks: any[] = [
      { type: 'header', text: { type: 'plain_text', text: ':books: Knowledge Base' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${entries.length}+ entries* | *${pending.length} pending* | *${categories.length} categories* | *${sources.length} sources*`,
        },
      },
    ];

    // ── Sources Section ──
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ':link: *Connected Sources*' } });

    if (sources.length === 0) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No sources connected yet. Add one below._' } });
    } else {
      for (const s of sources) {
        const statusIcon = s.status === 'active' ? ':large_green_circle:' :
          s.status === 'syncing' ? ':arrows_counterclockwise:' :
          s.status === 'needs_setup' ? ':warning:' : ':red_circle:';
        const syncNote = s.auto_sync ? 'auto-sync on' : 'auto-sync off';
        const lastSync = s.last_sync_at ? `last sync ${timeAgo(s.last_sync_at)}` : 'never synced';

        const overflowOpts: any[] = [
          { text: { type: 'plain_text', text: ':gear: Configure' }, value: `configure:${s.id}` },
          { text: { type: 'plain_text', text: ':arrows_counterclockwise: Sync Now' }, value: `sync:${s.id}` },
          { text: { type: 'plain_text', text: ':put_litter_in_its_place: Flush & Re-sync' }, value: `flush:${s.id}` },
          { text: { type: 'plain_text', text: s.auto_sync ? ':no_bell: Disable Auto-sync' : ':bell: Enable Auto-sync' }, value: `toggle_sync:${s.id}` },
          { text: { type: 'plain_text', text: ':wastebasket: Remove' }, value: `remove:${s.id}` },
        ];

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusIcon} *${s.name}* (\`${s.source_type}\`)\n${s.entry_count} entries · ${syncNote} · ${lastSync}${s.error_message ? `\n:x: ${s.error_message.slice(0, 100)}` : ''}`,
          },
          accessory: {
            type: 'overflow',
            action_id: 'kb_source_overflow',
            options: overflowOpts,
          },
        });
      }
    }

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':heavy_plus_sign: Add Source' },
          action_id: 'kb_add_source',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':key: API Keys' },
          action_id: 'kb_manage_api_keys',
        },
      ],
    });

    // ── Pending Section ──
    if (pending.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `:hourglass: *Pending Approval (${pending.length})*` } });

      for (const p of pending.slice(0, 5)) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*${p.title}* (${p.category})\n${p.summary.slice(0, 150)}${p.contributed_by ? ` — by ${p.contributed_by.slice(0, 8)}` : ''}` },
          accessory: {
            type: 'overflow',
            action_id: 'kb_entry_overflow',
            options: [
              { text: { type: 'plain_text', text: ':white_check_mark: Approve' }, value: `approve:${p.id}` },
              { text: { type: 'plain_text', text: ':eyes: View' }, value: `view:${p.id}` },
              { text: { type: 'plain_text', text: ':wastebasket: Delete' }, value: `delete:${p.id}` },
            ],
          },
        });
      }
    }

    // ── Recent Entries ──
    if (entries.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ':white_check_mark: *Recent Entries*' } });

      for (const e of entries.slice(0, 5)) {
        const tagStr = e.tags.length > 0 ? ` · ${e.tags.slice(0, 3).join(', ')}` : '';
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*${e.title}* (${e.category}${tagStr})\n${e.summary.slice(0, 150)}` },
          accessory: {
            type: 'overflow',
            action_id: 'kb_entry_overflow',
            options: [
              { text: { type: 'plain_text', text: ':eyes: View' }, value: `view:${e.id}` },
              { text: { type: 'plain_text', text: ':wastebasket: Delete' }, value: `delete:${e.id}` },
            ],
          },
        });
      }
    }

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':heavy_plus_sign: Add Entry' },
          action_id: 'kb_add_entry_btn',
        },
      ],
    });

    await respond({ response_type: 'ephemeral', blocks, text: 'Knowledge Base' });
  });
}

// ── Helper: start new/update agent flows ──

async function startNewAgentFlow(userId: string, channelId: string): Promise<void> {
  const ts = await postBlocks(channelId, [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '✋ *Let\'s build a new hand!*',
      },
    },
  ], 'New agent');

  if (ts) {
    // Reply in thread to auto-open the thread view — explain the process upfront
    await postMessage(
      channelId,
      'I\'ll walk you through two quick steps:\n\n'
      + '*Step 1:* What should this agent do? _(its goal/purpose)_\n'
      + '*Step 2:* When should it run? _(trigger or schedule)_\n\n'
      + 'Everything else — name, tools, model, permissions — will be auto-configured.\n\n'
      + '*Let\'s start with Step 1:* Describe what you want this agent to achieve. Focus on the _what_, not the _when_ — we\'ll cover timing next.',
      ts,
    );

    await execute(
      `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [uuid(), JSON.stringify({
        type: 'conversation',
        step: 'awaiting_goal',
        flow: 'new_agent',
        userId,
        channelId,
        threadTs: ts,
      })],
    );
  }
}

async function startUpdateAgentFlow(userId: string, channelId: string): Promise<void> {
  const agents = await listAgents();
  if (agents.length === 0) {
    await postMessage(channelId, 'No agents exist yet. Use `/agents` to create one.');
    return;
  }

  const editableAgents: typeof agents = [];
  for (const a of agents) {
    if (await canModifyAgent(a.id, userId)) editableAgents.push(a);
  }
  if (editableAgents.length === 0) {
    await postMessage(channelId, 'You don\'t have permission to update any agents.');
    return;
  }

  const ts = await postBlocks(channelId, [
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
        channelId,
        threadTs: ts,
      })],
    );
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Conversational Handlers ──

export function registerInlineActions(app: App): void {
  // ── Agent overflow menu ──
  app.action('agent_overflow', async ({ action, ack, body }) => {
    await ack();
    const selected = (action as any).selected_option?.value as string;
    if (!selected) return;

    const [actionType, agentId] = selected.split(':');
    const userId = body.user.id;
    const channelId = body.channel?.id;
    const triggerId = (body as any).trigger_id;

    switch (actionType) {
      case 'view_config': {
        const agent = await getAgent(agentId);
        if (!agent) { if (channelId) await postMessage(channelId, ':x: Agent not found.'); return; }
        const channels = (agent.channel_ids?.length > 0 ? agent.channel_ids : [agent.channel_id]).map((c: string) => `<#${c}>`).join(', ');
        const blocks: any[] = [
          { type: 'header', text: { type: 'plain_text', text: `${agent.avatar_emoji} ${agent.name}` } },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Status:* ${agent.status}\n*Model:* ${agent.model}\n*Effort:* ${maxTurnsToEffort(agent.max_turns)}\n*Memory:* ${agent.memory_enabled ? 'on' : 'off'}\n*Visibility:* ${agent.visibility === 'private' ? ':lock: private' : 'public'}\n*Channels:* ${channels}\n*Tools:* ${agent.tools.join(', ') || 'none'}\n*Responds to:* ${respondModeLabelFromAgent(agent)}`,
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*System Prompt:*\n\`\`\`${agent.system_prompt.slice(0, 2500)}${agent.system_prompt.length > 2500 ? '...' : ''}\`\`\`` },
          },
        ];
        if (channelId) await postBlocks(channelId, blocks, `Config: ${agent.name}`);
        break;
      }

      case 'update': {
        if (!channelId) return;
        if (!(await canModifyAgent(agentId, userId))) {
          await postMessage(channelId, ':x: You don\'t have permission to update this agent.');
          return;
        }
        const agent = await getAgent(agentId);
        if (!agent) return;
        const currentChannels = agent.channel_ids?.length > 0 ? agent.channel_ids : [agent.channel_id];
        const channelLabels = currentChannels.map((c: string) => `<#${c}>`).join(', ');

        // Post brief parent message at channel level
        const ts = await postBlocks(channelId, [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:arrows_counterclockwise: Updating *${agent.avatar_emoji} ${agent.name}* — see thread`,
            },
          },
        ], `Update ${agent.name}`);

        if (ts) {
          // Post config details as a thread reply — creates a visible thread
          await postMessage(channelId,
            `Current config: *${agent.model}* model | ${maxTurnsToEffort(agent.max_turns)} effort | ${agent.tools.length} tools | memory ${agent.memory_enabled ? 'on' : 'off'} | channels: ${channelLabels}\n\n` +
            `_What would you like to change? You can say things like:_\n` +
            `• _"update the goal to handle X differently"_\n` +
            `• _"add #new-channel" or "replace #old-channel with #new-channel"_\n` +
            `• _"change the model to opus"_\n` +
            `• _Or describe a problem you're seeing_`,
            ts,
          );
          await execute(
            `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
            [uuid(), JSON.stringify({
              type: 'conversation',
              step: 'awaiting_update_request',
              flow: 'update_agent',
              agentId,
              userId,
              channelId,
              threadTs: ts,
            })],
          );
        }
        break;
      }

      case 'pause': {
        try {
          await updateAgent(agentId, { status: 'paused' } as any, userId);
          const agent = await getAgent(agentId);
          if (channelId) await postMessage(channelId, `:double_vertical_bar: Agent *${agent?.name || agentId}* paused.`);
        } catch (err: any) {
          if (channelId) await postMessage(channelId, `:x: ${err.message}`);
        }
        break;
      }

      case 'resume': {
        try {
          await updateAgent(agentId, { status: 'active' } as any, userId);
          const agent = await getAgent(agentId);
          if (channelId) await postMessage(channelId, `:arrow_forward: Agent *${agent?.name || agentId}* resumed.`);
        } catch (err: any) {
          if (channelId) await postMessage(channelId, `:x: ${err.message}`);
        }
        break;
      }

      case 'members': {
        if (!(await canModifyAgent(agentId, userId))) {
          if (channelId) await postMessage(channelId, ':x: You don\'t have permission to manage members.');
          return;
        }
        const agent = await getAgent(agentId);
        if (!agent || agent.visibility !== 'private') {
          if (channelId) await postMessage(channelId, ':x: This agent is not private.');
          return;
        }
        const members = await getAgentMembers(agentId);
        const memberList = members.length > 0
          ? members.map(m => `<@${m}>`).join(', ')
          : '_No members yet_';
        if (channelId) {
          await postBlocks(channelId, [
            { type: 'header', text: { type: 'plain_text', text: `:lock: ${agent.name} — Members` } },
            { type: 'section', text: { type: 'mrkdwn', text: `*Current members:* ${memberList}` } },
            { type: 'section', text: { type: 'mrkdwn', text: `_To add members, say \`add member @user\` in the agent's channel.\nTo remove, say \`remove member @user\`._` } },
          ], `Members: ${agent.name}`);
        }
        break;
      }

      case 'delete': {
        if (!(await canModifyAgent(agentId, userId))) {
          if (channelId) await postMessage(channelId, ':x: You don\'t have permission to delete this agent.');
          return;
        }
        // Show confirmation
        if (channelId) {
          const agent = await getAgent(agentId);
          await postBlocks(channelId, [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `:warning: Are you sure you want to delete *${agent?.name || agentId}*? This cannot be undone.` },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: ':wastebasket: Yes, delete' },
                  style: 'danger',
                  action_id: 'confirm_delete_agent',
                  value: agentId,
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Cancel' },
                  action_id: 'cancel_delete_agent',
                  value: agentId,
                },
              ],
            },
          ], 'Confirm delete');
        }
        break;
      }
    }
  });

  // "New Agent" button from /agents dashboard
  app.action('agents_new_agent', async ({ ack, body }) => {
    await ack();
    const channelId = body.channel?.id;
    if (!channelId) return;
    await startNewAgentFlow(body.user.id, channelId);
  });

  // Confirm/cancel delete agent
  app.action('confirm_delete_agent', async ({ action, ack, body }) => {
    await ack();
    const agentId = (action as any).value;
    const userId = body.user.id;
    try {
      const agent = await getAgent(agentId);
      await execute('DELETE FROM agents WHERE id = $1', [agentId]);
      await replyToAction(body, `:wastebasket: Agent *${agent?.name || agentId}* deleted.`);
    } catch (err: any) {
      await replyToAction(body, `:x: ${err.message}`);
    }
  });

  app.action('cancel_delete_agent', async ({ ack, body }) => {
    await ack();
    await replyToAction(body, ':ok: Deletion cancelled.');
  });

  // ── KB Source overflow menu ──
  app.action('kb_source_overflow', async ({ action, ack, body }) => {
    await ack();
    const selected = (action as any).selected_option?.value as string;
    if (!selected) return;

    const colonIdx = selected.indexOf(':');
    const actionType = selected.slice(0, colonIdx);
    const sourceId = selected.slice(colonIdx + 1);
    const userId = body.user.id;
    const channelId = body.channel?.id;
    const triggerId = (body as any).trigger_id;

    const { isSuperadmin } = await import('../modules/access-control');
    if (!(await isSuperadmin(userId))) return;

    const { getSource, startSync, flushAndResync, toggleAutoSync, deleteSource } = await import('../modules/kb-sources');
    const source = await getSource(sourceId);
    if (!source) { if (channelId) await postMessage(channelId, ':x: Source not found.'); return; }

    switch (actionType) {
      case 'configure': {
        const { getConnector } = await import('../modules/kb-sources/connectors');
        const connector = getConnector(source.source_type);
        const config = JSON.parse(source.config_json || '{}');

        const configBlocks: any[] = [
          { type: 'section', text: { type: 'mrkdwn', text: `*Current config for ${source.name}:*\n${Object.keys(config).length > 0 ? Object.entries(config).map(([k, v]) => `• \`${k}\` = \`${String(v).slice(0, 50)}\``).join('\n') : '_No config set_'}` } },
          { type: 'divider' },
        ];

        // Build input fields from connector definition
        for (const field of connector.configFields) {
          configBlocks.push({
            type: 'input', block_id: `src_cfg_${field.key}`, optional: field.optional !== false,
            label: { type: 'plain_text', text: field.label },
            element: {
              type: 'plain_text_input', action_id: `src_input_${field.key}`,
              placeholder: { type: 'plain_text', text: field.placeholder },
              ...(config[field.key] ? { initial_value: config[field.key] } : {}),
            },
          });
        }

        await openModal(triggerId, {
          type: 'modal',
          callback_id: 'kb_source_config_modal',
          private_metadata: JSON.stringify({ sourceId, sourceType: source.source_type }),
          title: { type: 'plain_text', text: `Configure Source`.slice(0, 24) },
          submit: { type: 'plain_text', text: 'Save' },
          blocks: configBlocks,
        });
        break;
      }

      case 'sync': {
        try {
          await startSync(sourceId);
          if (channelId) await postMessage(channelId, `:arrows_counterclockwise: Sync started for *${source.name}*`);
        } catch (err: any) {
          if (channelId) {
            if (err.message.includes('not configured')) {
              await postMessage(channelId, `:warning: ${err.message}\n\nUse the :key: *API Keys* button to set up credentials.`);
            } else {
              await postMessage(channelId, `:x: ${err.message}`);
            }
          }
        }
        break;
      }

      case 'flush': {
        try {
          await flushAndResync(sourceId, userId);
          if (channelId) await postMessage(channelId, `:put_litter_in_its_place: Flushed & re-syncing *${source.name}*`);
        } catch (err: any) {
          if (channelId) await postMessage(channelId, `:x: ${err.message}`);
        }
        break;
      }

      case 'toggle_sync': {
        const newState = !source.auto_sync;
        await toggleAutoSync(sourceId, newState);
        if (channelId) await postMessage(channelId, `${newState ? ':bell:' : ':no_bell:'} Auto-sync ${newState ? 'enabled' : 'disabled'} for *${source.name}*`);
        break;
      }

      case 'remove': {
        await deleteSource(sourceId, userId);
        if (channelId) await postMessage(channelId, `:wastebasket: Source *${source.name}* removed.`);
        break;
      }
    }
  });

  // "Add Source" button
  app.action('kb_add_source', async ({ ack, body }) => {
    await ack();
    const userId = body.user.id;
    const channelId = (body as any).channel?.id || (body as any).container?.channel_id;
    if (!channelId) return;

    const { listConnectors } = await import('../modules/kb-sources/connectors');
    const connectors = listConnectors();

    const ts = await postBlocks(channelId, [
      { type: 'section', text: { type: 'mrkdwn', text: ':file_folder: *Add a Knowledge Source*' } },
    ], 'Add knowledge source');

    if (ts) {
      const typeButtons = connectors.map(c => ({
        type: 'button' as const,
        text: { type: 'plain_text' as const, text: `${c.icon} ${c.label}` },
        action_id: `kb_source_type_${c.type}`,
        value: c.type,
      }));

      await postBlocks(channelId, [
        { type: 'section', text: { type: 'mrkdwn', text: 'I\'ll walk you through the setup step by step.\n\n*Step 1:* What type of source do you want to connect?' } },
        { type: 'actions', elements: typeButtons },
      ], 'Select source type', ts);

      await execute(
        `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [uuid(), JSON.stringify({
          type: 'conversation',
          step: 'awaiting_source_type',
          flow: 'add_source',
          userId,
          channelId,
          threadTs: ts,
        })],
      );
    }
  });

  // Source type selection buttons (one per connector type)
  const { listConnectors: getConnectorList } = require('../modules/kb-sources/connectors');
  for (const connector of getConnectorList()) {
    app.action(`kb_source_type_${connector.type}`, async ({ ack, body }: any) => {
      await ack();
      const userId = body.user.id;
      const channelId = body.channel?.id || body.container?.channel_id;
      const threadTs = body.message?.thread_ts || body.message?.ts;
      if (!channelId || !threadTs) return;

      // Clean up the type-selection state
      await execute(
        `DELETE FROM pending_confirmations WHERE data->>'type' = 'conversation' AND data->>'flow' = 'add_source' AND data->>'threadTs' = $1 AND data->>'userId' = $2`,
        [threadTs, userId],
      );

      await handleSourceTypeSelected(connector.type, userId, channelId, threadTs);
    });
  }

  // "API Keys" button — thread-based flow
  app.action('kb_manage_api_keys', async ({ ack, body }) => {
    await ack();
    const userId = body.user.id;
    const channelId = (body as any).channel?.id || (body as any).container?.channel_id;
    if (!channelId) return;

    const { listApiKeys } = await import('../modules/kb-sources');
    const { listConnectors } = await import('../modules/kb-sources/connectors');
    const keys = await listApiKeys();
    const connectors = listConnectors();

    const providers = [...new Set(connectors.map((c: any) => c.provider))];
    const keyMap = new Map(keys.map((k: any) => [k.provider, k]));

    const statusLines = providers.map((provider: string) => {
      const key = keyMap.get(provider);
      const connector = connectors.find((c: any) => c.provider === provider)!;
      const icon = key?.setup_complete ? ':white_check_mark:' : ':x:';
      const status = key ? (key.setup_complete ? 'Configured' : 'Incomplete') : 'Not configured';
      return `${icon} *${provider}* (${connector.label}) — ${status}`;
    });

    const ts = await postBlocks(channelId, [
      { type: 'section', text: { type: 'mrkdwn', text: ':key: *API Keys*' } },
    ], 'API Keys');

    if (ts) {
      const providerButtons = providers.map((provider: string) => {
        const key = keyMap.get(provider);
        return {
          type: 'button' as const,
          text: { type: 'plain_text' as const, text: key?.setup_complete ? `:gear: ${provider}` : `:key: ${provider}` },
          action_id: `kb_api_key_setup_${provider}`,
          value: provider,
        };
      });

      await postBlocks(channelId, [
        { type: 'section', text: { type: 'mrkdwn', text: statusLines.join('\n') + '\n\nSelect a provider to set up or update:' } },
        { type: 'actions', elements: providerButtons },
      ], 'Select provider', ts);
    }
  });

  // Individual provider API key setup buttons
  const { listConnectors: getConnectors2 } = require('../modules/kb-sources/connectors');
  const uniqueProviders = [...new Set(getConnectors2().map((c: any) => c.provider))] as string[];
  for (const provider of uniqueProviders) {
    app.action(`kb_api_key_setup_${provider}`, async ({ ack, body }: any) => {
      await ack();
      const userId = body.user.id;
      const channelId = body.channel?.id || body.container?.channel_id;
      const threadTs = body.message?.thread_ts || body.message?.ts;
      if (!channelId || !threadTs) return;

      await startApiKeySetup(provider, userId, channelId, threadTs);
    });
  }

  // Legacy modal handler — keep for backward compat
  app.action('kb_setup_api_key', async ({ action, ack, body }) => {
    await ack();
    const provider = (action as any).value;
    const userId = body.user.id;
    const channelId = (body as any).channel?.id;
    if (!channelId) return;

    // Redirect to thread-based flow
    const ts = await postBlocks(channelId, [
      { type: 'section', text: { type: 'mrkdwn', text: `:key: *Setup ${provider} API Keys*` } },
    ], `Setup ${provider}`);
    if (ts) await startApiKeySetup(provider, userId, channelId, ts);
  });

  // ── Register tool integration ──
  app.action('register_tool_integration', async ({ action, ack, body }) => {
    await ack();
    const integrationId = (action as any).value;
    const userId = body.user.id;
    const triggerId = (body as any).trigger_id;

    try {
      const { isSuperadmin } = await import('../modules/access-control');
      if (!(await isSuperadmin(userId))) return;

      const integration = TOOL_INTEGRATIONS.find(i => i.id === integrationId);
      if (!integration) {
        logger.warn('register_tool_integration: unknown integration', { integrationId });
        return;
      }

      // Build a modal asking for the required config keys
      const manifest = getIntegration(integrationId);
      const setupGuide = manifest?.setupGuide;

      const blocks: any[] = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${integration.icon} *Register ${integration.label}*\n\n${integration.description}\n\nThis will register: ${integration.tools.map(t => `\`${t}\``).join(', ')}`,
          },
        },
        { type: 'divider' },
      ];

      if (setupGuide) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: setupGuide },
        });
        blocks.push({ type: 'divider' });
      }

      for (const key of integration.requiredConfigKeys) {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const placeholder = integration.configPlaceholders?.[key] || `Enter ${label}...`;
        blocks.push({
          type: 'input', block_id: `reg_cfg_${key}`,
          label: { type: 'plain_text', text: label },
          element: {
            type: 'plain_text_input', action_id: `reg_input_${key}`,
            placeholder: { type: 'plain_text', text: placeholder },
          },
        });
      }

      await openModal(triggerId, {
        type: 'modal',
        callback_id: 'register_tool_modal',
        private_metadata: JSON.stringify({ integrationId, requiredKeys: integration.requiredConfigKeys }),
        title: { type: 'plain_text', text: `Register ${integration.label}`.slice(0, 24) },
        submit: { type: 'plain_text', text: 'Register' },
        blocks,
      });
    } catch (err: any) {
      logger.error('register_tool_integration failed', { integrationId, error: err.message, stack: err.stack });
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:x: Failed to open registration modal for *${integrationId}*: ${err.message}` } },
      ], 'Registration error').catch(() => {});
    }
  });

  // "Add Entry" button from KB dashboard
  app.action('kb_add_entry_btn', async ({ ack, body }) => {
    await ack();
    const triggerId = (body as any).trigger_id;
    await openModal(triggerId, {
      type: 'modal',
      callback_id: 'kb_add_modal',
      title: { type: 'plain_text', text: 'Add KB Entry' },
      submit: { type: 'plain_text', text: 'Add' },
      blocks: [
        {
          type: 'input', block_id: 'title_block',
          label: { type: 'plain_text', text: 'Title' },
          element: { type: 'plain_text_input', action_id: 'title_input', placeholder: { type: 'plain_text', text: 'e.g. Zendesk API Rate Limits' } },
        },
        {
          type: 'input', block_id: 'category_block',
          label: { type: 'plain_text', text: 'Category' },
          element: {
            type: 'static_select', action_id: 'category_input',
            options: ['General', 'Engineering', 'Product', 'Support', 'Sales', 'HR', 'Legal', 'Finance', 'Operations'].map(c => ({
              text: { type: 'plain_text' as const, text: c }, value: c.toLowerCase(),
            })),
          },
        },
        {
          type: 'input', block_id: 'content_block',
          label: { type: 'plain_text', text: 'Content' },
          element: { type: 'plain_text_input', action_id: 'content_input', multiline: true, placeholder: { type: 'plain_text', text: 'Paste the knowledge content here...' } },
        },
        {
          type: 'input', block_id: 'tags_block', optional: true,
          label: { type: 'plain_text', text: 'Tags (comma-separated)' },
          element: { type: 'plain_text_input', action_id: 'tags_input', placeholder: { type: 'plain_text', text: 'e.g. zendesk, api, limits' } },
        },
      ],
    });
  });

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
    const currentChannels = agent.channel_ids?.length > 0 ? agent.channel_ids : [agent.channel_id];
    const channelLabels = currentChannels.map((c: string) => `<#${c}>`).join(', ');

    // Post brief selection at channel level as thread reply
    await postMessage(channelId,
      `Selected *${agent.avatar_emoji} ${agent.name}*`,
      threadTs,
    );

    // Post config details as a deeper thread reply — makes the thread clearly visible
    await postMessage(channelId,
      `Current config: *${agent.model}* model | ${maxTurnsToEffort(agent.max_turns)} effort | ${agent.tools.length} tools | memory ${agent.memory_enabled ? 'on' : 'off'} | channels: ${channelLabels}\n\n` +
      `_What would you like to change? You can say things like:_\n` +
      `• _"update the goal to handle X differently"_\n` +
      `• _"add #new-channel" or "replace #old-channel with #new-channel"_\n` +
      `• _"change the model to opus"_\n` +
      `• _Or describe a problem you're seeing_`,
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
        step: 'awaiting_update_request',
        flow: 'update_agent',
        agentId,
        userId,
        channelId,
        threadTs,
      })],
    );
  });

  // Handle channel selection for new agent
  app.action('new_agent_channel_select', async ({ action, ack, body }) => {
    await ack();
    const selected = (action as any).selected_conversation;
    const selectedChannels: string[] = selected ? [selected] : [];
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
    const selected = (action as any).selected_conversation;
    const selectedChannels: string[] = selected ? [selected] : [];
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

  // ── Tool overflow menu actions ──
  app.action('tool_overflow', async ({ action, ack, body }) => {
    await ack();
    const selected = (action as any).selected_option?.value as string;
    if (!selected) return;

    const [actionType, toolName] = selected.split(':');
    const userId = body.user.id;
    const channelId = body.channel?.id;
    const triggerId = (body as any).trigger_id;

    const { isSuperadmin } = await import('../modules/access-control');
    if (!(await isSuperadmin(userId))) return;

    const {
      getCustomTool, getToolConfig, approveCustomTool, deleteCustomTool,
    } = await import('../modules/tools');

    switch (actionType) {
      case 'configure': {
        const tool = await getCustomTool(toolName);
        if (!tool) return;
        const config = JSON.parse(tool.config_json || '{}');
        const configKeys = Object.keys(config);

        const existingBlocks: any[] = configKeys.length > 0
          ? [{
              type: 'section', block_id: 'existing_config',
              text: {
                type: 'mrkdwn',
                text: '*Current config:*\n' + configKeys.map(k => {
                  const v = String(config[k]);
                  const masked = v.length > 6 ? v.slice(0, 3) + '***' + v.slice(-3) : '***';
                  return `• \`${k}\` = \`${masked}\``;
                }).join('\n'),
              },
            }]
          : [{ type: 'section', text: { type: 'mrkdwn', text: '_No config set yet_' } }];

        const { openModal } = await import('./index');
        await openModal(triggerId, {
          type: 'modal',
          callback_id: 'tool_config_modal',
          private_metadata: toolName,
          title: { type: 'plain_text', text: `Configure ${toolName}`.slice(0, 24) },
          submit: { type: 'plain_text', text: 'Save' },
          blocks: [
            ...existingBlocks,
            { type: 'divider' },
            {
              type: 'input', block_id: 'config_key', optional: true,
              label: { type: 'plain_text', text: 'Config Key' },
              element: { type: 'plain_text_input', action_id: 'key_input', placeholder: { type: 'plain_text', text: 'e.g. subdomain, email, api_token' } },
            },
            {
              type: 'input', block_id: 'config_value', optional: true,
              label: { type: 'plain_text', text: 'Config Value' },
              element: { type: 'plain_text_input', action_id: 'value_input', placeholder: { type: 'plain_text', text: 'e.g. mycompany' } },
            },
            {
              type: 'input', block_id: 'remove_key', optional: true,
              label: { type: 'plain_text', text: 'Remove Key (leave blank to skip)' },
              element: { type: 'plain_text_input', action_id: 'remove_input', placeholder: { type: 'plain_text', text: 'e.g. old_key' } },
            },
          ],
        });
        break;
      }

      case 'access': {
        const tool = await getCustomTool(toolName);
        if (!tool) return;
        const { openModal } = await import('./index');
        await openModal(triggerId, {
          type: 'modal',
          callback_id: 'tool_access_modal',
          private_metadata: toolName,
          title: { type: 'plain_text', text: `Access: ${toolName}`.slice(0, 24) },
          submit: { type: 'plain_text', text: 'Update' },
          blocks: [{
            type: 'input', block_id: 'access_level',
            label: { type: 'plain_text', text: 'Access Level' },
            element: {
              type: 'static_select', action_id: 'access_select',
              initial_option: {
                text: { type: 'plain_text', text: tool.access_level },
                value: tool.access_level,
              },
              options: [
                { text: { type: 'plain_text', text: 'read-only' }, value: 'read-only' },
                { text: { type: 'plain_text', text: 'read-write' }, value: 'read-write' },
              ],
            },
          }],
        });
        break;
      }

      case 'add_to_agent': {
        const agents = await listAgents();
        if (agents.length === 0) {
          if (channelId) await postMessage(channelId, ':x: No agents exist yet.');
          return;
        }
        const { openModal } = await import('./index');
        await openModal(triggerId, {
          type: 'modal',
          callback_id: 'tool_add_to_agent_modal',
          private_metadata: toolName,
          title: { type: 'plain_text', text: `Add to Agent` },
          submit: { type: 'plain_text', text: 'Add' },
          blocks: [{
            type: 'input', block_id: 'agent_select_block',
            label: { type: 'plain_text', text: `Add *${toolName}* to:` },
            element: {
              type: 'static_select', action_id: 'agent_select',
              options: agents.map(a => ({
                text: { type: 'plain_text' as const, text: `${a.avatar_emoji} ${a.name}` },
                value: a.id,
              })),
            },
          }],
        });
        break;
      }

      case 'approve': {
        try {
          await approveCustomTool(toolName, userId);
          if (channelId) await postMessage(channelId, `:white_check_mark: Tool *${toolName}* approved.`);
        } catch (err: any) {
          if (channelId) await postMessage(channelId, `:x: ${err.message}`);
        }
        break;
      }

      case 'delete': {
        try {
          await deleteCustomTool(toolName, userId);
          if (channelId) await postMessage(channelId, `:wastebasket: Tool *${toolName}* deleted.`);
        } catch (err: any) {
          if (channelId) await postMessage(channelId, `:x: ${err.message}`);
        }
        break;
      }
    }
  });

  // ── KB entry overflow menu actions ──
  app.action('kb_entry_overflow', async ({ action, ack, body }) => {
    await ack();
    const selected = (action as any).selected_option?.value as string;
    if (!selected) return;

    const [actionType, entryId] = selected.split(':');
    const userId = body.user.id;
    const channelId = body.channel?.id;

    const { getKBEntry, approveKBEntry, deleteKBEntry } = await import('../modules/knowledge-base');

    switch (actionType) {
      case 'view': {
        const entry = await getKBEntry(entryId);
        if (!entry) { if (channelId) await postMessage(channelId, ':x: Entry not found.'); return; }
        const tagStr = entry.tags.length > 0 ? `\n*Tags:* ${entry.tags.join(', ')}` : '';
        const blocks: any[] = [
          { type: 'header', text: { type: 'plain_text', text: entry.title } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Category:* ${entry.category} | *Status:* ${entry.approved ? 'Approved' : 'Pending'}${tagStr}\n\n*Summary:* ${entry.summary}` } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: entry.content.slice(0, 2900) + (entry.content.length > 2900 ? '\n_...truncated_' : '') } },
        ];
        if (channelId) await postBlocks(channelId, blocks, entry.title);
        break;
      }
      case 'approve': {
        try {
          const entry = await approveKBEntry(entryId);
          if (channelId) await postMessage(channelId, `:white_check_mark: KB entry *${entry.title}* approved and indexed.`);
        } catch (err: any) {
          if (channelId) await postMessage(channelId, `:x: ${err.message}`);
        }
        break;
      }
      case 'delete': {
        const entry = await getKBEntry(entryId);
        try {
          await deleteKBEntry(entryId);
          if (channelId) await postMessage(channelId, `:wastebasket: KB entry${entry ? ` *${entry.title}*` : ''} deleted.`);
        } catch (err: any) {
          if (channelId) await postMessage(channelId, `:x: ${err.message}`);
        }
        break;
      }
    }
  });
}

// ── Tool Modal Submissions ──

export function registerToolAndKBModals(app: App): void {
  // Tool config modal
  app.view('tool_config_modal', async ({ ack, body, view }) => {
    await ack();
    const toolName = view.private_metadata;
    const userId = body.user.id;
    const vals = view.state.values;

    const { setToolConfigKey, removeToolConfigKey } = await import('../modules/tools');

    const key = vals.config_key?.key_input?.value?.trim();
    const value = vals.config_value?.value_input?.value?.trim();
    const removeKey = vals.remove_key?.remove_input?.value?.trim();

    try {
      if (key && value) {
        await setToolConfigKey(toolName, key, value, userId);
      }
      if (removeKey) {
        await removeToolConfigKey(toolName, removeKey, userId);
      }
      // DM the user confirmation
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: *${toolName}* config updated.` + (key ? `\nSet \`${key}\`` : '') + (removeKey ? `\nRemoved \`${removeKey}\`` : '') } },
      ], `Tool config updated: ${toolName}`);
    } catch (err: any) {
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:x: Failed to update *${toolName}* config: ${err.message}` } },
      ], 'Config update failed');
    }
  });

  // Tool access level modal
  app.view('tool_access_modal', async ({ ack, body, view }) => {
    await ack();
    const toolName = view.private_metadata;
    const userId = body.user.id;
    const accessLevel = view.state.values.access_level?.access_select?.selected_option?.value;

    if (accessLevel && (accessLevel === 'read-only' || accessLevel === 'read-write')) {
      try {
        const { updateToolAccessLevel } = await import('../modules/tools');
        await updateToolAccessLevel(toolName, accessLevel, userId);
        await sendDMBlocks(userId, [
          { type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: *${toolName}* access level set to \`${accessLevel}\`` } },
        ], 'Access level updated');
      } catch (err: any) {
        await sendDMBlocks(userId, [
          { type: 'section', text: { type: 'mrkdwn', text: `:x: ${err.message}` } },
        ], 'Access update failed');
      }
    }
  });

  // Tool add-to-agent modal
  app.view('tool_add_to_agent_modal', async ({ ack, body, view }) => {
    await ack();
    const toolName = view.private_metadata;
    const userId = body.user.id;
    const agentId = view.state.values.agent_select_block?.agent_select?.selected_option?.value;

    if (agentId) {
      try {
        const { addToolToAgent } = await import('../modules/tools');
        await addToolToAgent(agentId, toolName, userId);
        const agent = await getAgent(agentId);
        await sendDMBlocks(userId, [
          { type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: *${toolName}* added to agent *${agent?.name || agentId}*` } },
        ], 'Tool added to agent');
      } catch (err: any) {
        await sendDMBlocks(userId, [
          { type: 'section', text: { type: 'mrkdwn', text: `:x: ${err.message}` } },
        ], 'Add to agent failed');
      }
    }
  });

  // KB add entry modal
  app.view('kb_add_modal', async ({ ack, body, view }) => {
    await ack();
    const userId = body.user.id;
    const vals = view.state.values;

    const title = vals.title_block?.title_input?.value?.trim();
    const category = vals.category_block?.category_input?.selected_option?.value || 'general';
    const content = vals.content_block?.content_input?.value?.trim();
    const tagsRaw = vals.tags_block?.tags_input?.value?.trim() || '';

    if (!title || !content) {
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: ':x: Title and content are required.' } },
      ], 'KB add failed');
      return;
    }

    const tags = tagsRaw ? tagsRaw.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

    try {
      const { createKBEntry } = await import('../modules/knowledge-base');
      const entry = await createKBEntry({
        title,
        summary: content.slice(0, 200),
        content,
        category,
        tags,
        accessScope: 'all',
        sourceType: 'manual',
        contributedBy: userId,
        approved: true,
      });

      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: KB entry *${entry.title}* created and indexed!\nCategory: ${category} | Tags: ${tags.join(', ') || 'none'}` } },
      ], 'KB entry created');
    } catch (err: any) {
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:x: Failed to create KB entry: ${err.message}` } },
      ], 'KB add failed');
    }
  });

  // ── KB Source Modals ──

  // Add source modal (step 1: name + type)
  app.view('kb_add_source_modal', async ({ ack, body, view }) => {
    await ack();
    const userId = body.user.id;
    const vals = view.state.values;
    const name = vals.source_name_block?.source_name_input?.value?.trim();
    const sourceType = vals.source_type_block?.source_type_input?.selected_option?.value;

    if (!name || !sourceType) {
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: ':x: Name and source type are required.' } },
      ], 'Source add failed');
      return;
    }

    try {
      const { getConnector, getProviderForConnector } = await import('../modules/kb-sources/connectors');
      const { createSource, isProviderConfigured } = await import('../modules/kb-sources');
      const connectorType = sourceType as import('../types').KBConnectorType;
      const connector = getConnector(connectorType);
      const provider = getProviderForConnector(connectorType);
      const providerReady = await isProviderConfigured(provider);

      // Create the source
      const source = await createSource({
        name,
        sourceType: connectorType,
        config: {},
        createdBy: userId,
      });

      if (!providerReady) {
        // Notify that API keys need to be set up first, with setup steps
        await sendDMBlocks(userId, [
          { type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: Source *${name}* created, but *${provider}* API keys need to be configured before syncing.` } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: `*Setup steps for ${connector.label}:*\n\n${connector.setupSteps.join('\n')}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `_Use \`/kb\` → :key: *API Keys* to enter your credentials, then configure and sync the source._` } },
        ], `Source created: ${name}`);
      } else {
        await sendDMBlocks(userId, [
          { type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: Source *${name}* created!\n\nAPI keys for *${provider}* are already configured. Use the :gear: *Configure* action on the source in \`/kb\` to set source-specific settings (folder ID, URL, etc.), then sync.` } },
        ], `Source created: ${name}`);
      }
    } catch (err: any) {
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:x: Failed to create source: ${err.message}` } },
      ], 'Source add failed');
    }
  });

  // Source config modal (source-specific settings like folder ID, URL, etc.)
  app.view('kb_source_config_modal', async ({ ack, body, view }) => {
    await ack();
    const userId = body.user.id;
    const meta = JSON.parse(view.private_metadata);
    const { sourceId, sourceType } = meta;
    const vals = view.state.values;

    try {
      const { getConnector } = await import('../modules/kb-sources/connectors');
      const { updateSource } = await import('../modules/kb-sources');
      const connector = getConnector(sourceType);

      const config: Record<string, string> = {};
      for (const field of connector.configFields) {
        const val = vals[`src_cfg_${field.key}`]?.[`src_input_${field.key}`]?.value?.trim();
        if (val) config[field.key] = val;
      }

      await updateSource(sourceId, { config_json: JSON.stringify(config) });

      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: Source config updated.\n${Object.entries(config).map(([k, v]) => `• \`${k}\` = \`${v}\``).join('\n') || '_No fields set_'}` } },
      ], 'Source config updated');
    } catch (err: any) {
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:x: Failed to update source config: ${err.message}` } },
      ], 'Source config failed');
    }
  });

  // API Key save modal
  app.view('kb_api_key_save_modal', async ({ ack, body, view }) => {
    await ack();
    const userId = body.user.id;
    const meta = JSON.parse(view.private_metadata);
    const { provider, requiredKeys } = meta;
    const vals = view.state.values;

    try {
      const { setApiKey } = await import('../modules/kb-sources');
      const config: Record<string, string> = {};

      for (const key of requiredKeys) {
        const val = vals[`apikey_${key}`]?.[`apikey_input_${key}`]?.value?.trim();
        if (val) config[key] = val;
      }

      await setApiKey(provider, config, userId);

      const allSet = requiredKeys.every((k: string) => config[k] && config[k].length > 0);
      await sendDMBlocks(userId, [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: allSet
              ? `:white_check_mark: *${provider}* API credentials saved and verified! You can now sync sources that use ${provider}.`
              : `:warning: *${provider}* credentials partially saved. Missing: ${requiredKeys.filter((k: string) => !config[k]).join(', ')}`,
          },
        },
      ], `API key ${allSet ? 'saved' : 'partially saved'}: ${provider}`);
    } catch (err: any) {
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:x: Failed to save API key: ${err.message}` } },
      ], 'API key save failed');
    }
  });

  // API Keys view (close-only, no submission needed)
  app.view('kb_api_keys_view', async ({ ack }) => {
    await ack();
  });

  // ── Register Tool Integration Modal ──
  app.view('register_tool_modal', async ({ ack, body, view }) => {
    await ack();
    const userId = body.user.id;
    const meta = JSON.parse(view.private_metadata);
    const { integrationId, requiredKeys } = meta;
    const vals = view.state.values;

    const integration = TOOL_INTEGRATIONS.find(i => i.id === integrationId);
    if (!integration) return;

    // Collect config values
    const config: Record<string, string> = {};
    for (const key of requiredKeys) {
      const val = vals[`reg_cfg_${key}`]?.[`reg_input_${key}`]?.value?.trim();
      if (val) config[key] = val;
    }

    const missingKeys = requiredKeys.filter((k: string) => !config[k]);
    if (missingKeys.length > 0) {
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:x: Missing required fields: ${missingKeys.join(', ')}` } },
      ], 'Registration failed');
      return;
    }

    try {
      // Look up manifest and call its register function
      const manifest = getIntegration(integrationId);
      if (!manifest) throw new Error(`Unknown integration: ${integrationId}`);
      await manifest.register(userId, config);

      const toolList = integration.tools.map(t => `\`${t}\``).join(', ');
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: *${integration.label}* registered!\n\nTools created: ${toolList}\nAPI credentials saved.\n\nUse \`/tools\` to manage, or add them to agents via the overflow menu.` } },
      ], `${integration.label} registered`);

    } catch (err: any) {
      await sendDMBlocks(userId, [
        { type: 'section', text: { type: 'mrkdwn', text: `:x: Failed to register ${integration.label}: ${err.message}` } },
      ], 'Registration failed');
    }
  });
}

// Handle thread replies for conversational flows
export async function handleConversationReply(
  userId: string,
  channelId: string,
  threadTs: string,
  text: string,
): Promise<boolean> {
  logger.info('handleConversationReply lookup', { threadTs, userId, channelId });
  const row = await queryOne<{ id: string; data: any }>(
    `SELECT id, data FROM pending_confirmations
     WHERE data->>'type' = 'conversation'
       AND data->>'step' IN ('awaiting_goal', 'awaiting_when', 'awaiting_update_request', 'awaiting_source_api_keys', 'awaiting_source_details', 'awaiting_api_keys')
       AND data->>'threadTs' = $1
       AND data->>'userId' = $2
       AND expires_at > NOW()
     LIMIT 1`,
    [threadTs, userId],
  );

  if (!row) {
    logger.info('handleConversationReply — no matching row', { threadTs, userId });
    return false;
  }

  const conv = row.data;
  const input = text.trim();
  if (!input) return false;

  logger.info('handleConversationReply — found row', { step: conv.step, flow: conv.flow, agentId: conv.agentId });
  await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [row.id]);

  if (conv.step === 'awaiting_update_request') {
    await handleUpdateRequest(conv.agentId, input, userId, channelId, threadTs);
    return true;
  }

  if (conv.step === 'awaiting_when' && conv.flow === 'new_agent') {
    await handleNewAgentWhen(conv.goal, input, userId, channelId, threadTs);
    return true;
  }

  // Source/API key conversation flows
  if (conv.step === 'awaiting_source_api_keys' && conv.flow === 'add_source') {
    await handleSourceApiKeys(input, conv.sourceType, userId, channelId, threadTs);
    return true;
  }

  if (conv.step === 'awaiting_source_details' && conv.flow === 'add_source') {
    await handleSourceDetails(input, conv.sourceType, userId, channelId, threadTs);
    return true;
  }

  if (conv.step === 'awaiting_api_keys' && conv.flow === 'api_keys') {
    await handleApiKeysInput(input, conv.provider, userId, channelId, threadTs);
    return true;
  }

  if (conv.flow === 'new_agent') {
    await handleNewAgentGoal(input, userId, channelId, threadTs);
  } else if (conv.flow === 'update_agent') {
    await handleUpdateAgentGoal(conv.agentId, input, userId, channelId, threadTs);
  }

  return true;
}

async function handleNewAgentGoal(goal: string, userId: string, channelId: string, threadTs: string): Promise<void> {
  // Step 1 complete — save goal and ask Step 2: When should it run?
  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
    [uuid(), JSON.stringify({
      type: 'conversation',
      step: 'awaiting_when',
      flow: 'new_agent',
      goal,
      userId,
      channelId,
      threadTs,
    })],
  );

  await postMessage(
    channelId,
    ':white_check_mark: Got it!\n\n'
    + '*Step 2:* When should this agent run? Pick an option or describe your own:\n\n'
    + '*Message-based:*\n'
    + '• `every message` — responds to every message in its channel\n'
    + '• `when tagged` — only responds when @mentioned\n'
    + '• `when relevant` — responds when the message matches certain criteria (describe what\'s relevant)\n\n'
    + '*Schedule-based:*\n'
    + '• `hourly` / `daily` / `weekly` / `fortnightly` / `monthly`\n'
    + '• Or a custom schedule like "every Monday at 9am" or "every 6 hours"\n\n'
    + '_You can combine these too, e.g. "when tagged, and also daily at 9am"_',
    threadTs,
  );
}

async function handleNewAgentWhen(goal: string, whenInput: string, userId: string, channelId: string, threadTs: string): Promise<void> {
  // Combine goal + when into a unified prompt for goal analysis
  const combinedGoal = `${goal}\n\nTRIGGER/SCHEDULE: ${whenInput}`;

  await postMessage(channelId, ':gear: Flexing tiny fingers... analyzing your goal and configuring the best setup.', threadTs);

  try {
    const analysis = await analyzeGoal(combinedGoal, undefined, userId);
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
        text: { type: 'mrkdwn', text: `✋ *${agentName}* is equipped and ready!\n\nWhere should this hand live?` },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'conversations_select',
            action_id: 'new_agent_channel_select',
            placeholder: { type: 'plain_text', text: 'Select a channel...' },
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
    `This hand needs equipment that isn't available yet:\n${blockerList}\n\n` +
    `I've nudged the admin — we'll let you know once it's ready to be created.`,
    threadTs,
  );

  // Detect unconfigured tool blockers
  const unconfiguredToolNames: string[] = [];
  for (const blocker of analysis.blockers) {
    const match = blocker.match(/^Tool '(.+)' is registered but not configured by admin\.$/);
    if (match) unconfiguredToolNames.push(match[1]);
  }

  // DM the owner (first superadmin)
  const superadmins = await listSuperadmins();
  if (superadmins.length > 0) {
    const ownerId = superadmins[0].user_id;

    const dmBlocks: any[] = [
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
          text: `*Suggested agent name:* \`${analysis.agent_name}\`\n*Model:* ${analysis.model}\n*Summary:* ${analysis.summary}`,
        },
      },
    ];

    // Add unconfigured tool section with configure buttons
    if (unconfiguredToolNames.length > 0) {
      dmBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:wrench: *Tools needing configuration:* ${unconfiguredToolNames.map(t => `\`${t}\``).join(', ')}\nConfigure the tools first, then click "Retry Creation".`,
        },
      });
      for (const toolName of unconfiguredToolNames) {
        dmBlocks.push({
          type: 'actions',
          elements: [{
            type: 'button',
            text: { type: 'plain_text', text: `:gear: Configure ${toolName}`.slice(0, 75) },
            action_id: 'configure_unconfigured_tool',
            value: JSON.stringify({ toolName, requestId }),
          }],
        });
      }
    }

    dmBlocks.push(
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
    );

    await sendDMBlocks(ownerId, dmBlocks, `Feature request from <@${userId}>: ${goal.slice(0, 100)}`);
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
    : `#tinyhands-${agentName}` + ' (new)';

  const defaultEffort = maxTurnsToEffort(analysis.max_turns || 25);
  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
    [confirmId, JSON.stringify({ analysis, name: agentName, goal, userId, existingChannelIds: selectedChannels, selectedModel: analysis.model, selectedEffort: defaultEffort, visibility: 'public', memberIds: [] })],
  );

  const configSummary = buildConfigSummary(agentName, analysis, goal);
  const toolWarnings = buildToolWarningBlocks(analysis);
  await postBlocks(channelId, [
    { type: 'header', text: { type: 'plain_text', text: `New Agent: ${agentName}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Channels:* ${channelLabel}\n${configSummary}` } },
    ...toolWarnings,
    { type: 'divider' },
    ...buildModelAndEffortBlocks(confirmId, analysis.model, defaultEffort),
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*:lock: Visibility*' },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'radio_buttons',
          action_id: `visibility_select:${confirmId}`,
          initial_option: { text: { type: 'plain_text', text: 'Public — everyone can use' }, value: 'public' },
          options: [
            { text: { type: 'plain_text', text: 'Public — everyone can use' }, value: 'public' },
            { text: { type: 'plain_text', text: 'Private — members only' }, value: 'private' },
          ],
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✋ Confirm & Create' },
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

async function handleUpdateRequest(agentId: string, userMessage: string, userId: string, channelId: string, threadTs: string): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) { await postMessage(channelId, ':x: Agent not found.', threadTs); return; }

  const currentChannels = agent.channel_ids?.length > 0 ? agent.channel_ids : [agent.channel_id];
  const channelLabels = currentChannels.map((c: string) => `<#${c}>`).join(', ');

  // Use Haiku to classify intent
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `You classify user requests about updating a Slack agent. The agent's current config:
- Name: ${agent.name}
- Model: ${agent.model}
- Channels: ${channelLabels}
- Memory: ${agent.memory_enabled ? 'on' : 'off'}

Respond with ONLY valid JSON:
{
  "intent": "goal_update" | "channel_update" | "info_query" | "goal_and_channel_update",
  "channel_action": "add" | "remove" | "replace" | "set" | null,
  "channel_ids_mentioned": ["C123", ...] or [],
  "info_response": "response text if intent is info_query" | null,
  "pass_through_message": "the user's message rephrased as an instruction for the goal analyzer" | null
}

Rules:
- "goal_update": user wants to change behavior/goal/prompt/model/tools (pass the message through as-is to goal analyzer)
- "channel_update": user wants to add/remove/replace channels ONLY (extract channel IDs from <#CXXX|name> format)
- "info_query": user is asking a question about current config (answer it directly using the config above)
- "goal_and_channel_update": user wants both goal changes AND channel changes
- channel_action: "add" = add to existing, "remove" = remove from existing, "replace" = swap one for another, "set" = replace all channels with specified ones
- For channel operations, extract the raw channel IDs from Slack's <#C123|name> format
- pass_through_message: for goal_update, rephrase to be a clear instruction. For info_query, set to null.`,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to parse intent');
    const intent = JSON.parse(jsonMatch[0]);

    logger.info('Update intent classified', { agentId, intent: intent.intent, channelAction: intent.channel_action });

    if (intent.intent === 'info_query') {
      await postMessage(channelId, intent.info_response || `*${agent.name}* config:\n• Model: ${agent.model}\n• Effort: ${maxTurnsToEffort(agent.max_turns)}\n• Channels: ${channelLabels}\n• Memory: ${agent.memory_enabled ? 'on' : 'off'}\n• Tools: ${agent.tools.join(', ')}`, threadTs);
      // Re-insert so the user can ask more questions or make changes
      await execute(
        `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [uuid(), JSON.stringify({ type: 'conversation', step: 'awaiting_update_request', flow: 'update_agent', agentId, userId, channelId, threadTs })],
      );
      return;
    }

    if (intent.intent === 'channel_update') {
      const mentionedIds: string[] = intent.channel_ids_mentioned || [];
      // Also parse from original message in case Haiku missed some
      const msgMatches = userMessage.match(/<#([A-Z0-9]+)(?:\|[^>]+)?>/g);
      if (msgMatches) {
        for (const m of msgMatches) {
          const id = m.replace(/<#([A-Z0-9]+)(?:\|[^>]+)?>/, '$1');
          if (!mentionedIds.includes(id)) mentionedIds.push(id);
        }
      }

      if (mentionedIds.length === 0) {
        await postMessage(channelId, ':x: I couldn\'t find any channel mentions. Please mention channels like #channel-name.', threadTs);
        await execute(
          `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
          [uuid(), JSON.stringify({ type: 'conversation', step: 'awaiting_update_request', flow: 'update_agent', agentId, userId, channelId, threadTs })],
        );
        return;
      }

      let newChannelIds: string[];
      const action = intent.channel_action || 'set';
      if (action === 'add') {
        newChannelIds = [...new Set([...currentChannels, ...mentionedIds])];
      } else if (action === 'remove') {
        newChannelIds = currentChannels.filter((c: string) => !mentionedIds.includes(c));
        if (newChannelIds.length === 0) {
          await postMessage(channelId, ':x: Can\'t remove all channels — agent needs at least one.', threadTs);
          await execute(
            `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
            [uuid(), JSON.stringify({ type: 'conversation', step: 'awaiting_update_request', flow: 'update_agent', agentId, userId, channelId, threadTs })],
          );
          return;
        }
      } else {
        // 'set' or 'replace' — use exactly the mentioned channels
        newChannelIds = mentionedIds;
      }

      try {
        await updateAgent(agentId, { channel_ids: newChannelIds } as any, userId);
        const newLabels = newChannelIds.map(c => `<#${c}>`).join(', ');
        await postMessage(channelId, `:white_check_mark: Agent *${agent.name}* channels updated to ${newLabels}`, threadTs);
      } catch (err: any) {
        await postMessage(channelId, `:x: Failed to update channels: ${err.message}`, threadTs);
      }
      // Re-insert so the user can make more changes in the same thread
      await execute(
        `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [uuid(), JSON.stringify({ type: 'conversation', step: 'awaiting_update_request', flow: 'update_agent', agentId, userId, channelId, threadTs })],
      );
      return;
    }

    // goal_update or goal_and_channel_update — run goal analysis
    const goalMessage = intent.pass_through_message || userMessage;

    if (intent.intent === 'goal_and_channel_update') {
      // Extract channels, then analyze goal
      const mentionedIds: string[] = intent.channel_ids_mentioned || [];
      const msgMatches = userMessage.match(/<#([A-Z0-9]+)(?:\|[^>]+)?>/g);
      if (msgMatches) {
        for (const m of msgMatches) {
          const id = m.replace(/<#([A-Z0-9]+)(?:\|[^>]+)?>/, '$1');
          if (!mentionedIds.includes(id)) mentionedIds.push(id);
        }
      }

      let newChannelIds: string[];
      const action = intent.channel_action || 'set';
      if (action === 'add') {
        newChannelIds = [...new Set([...currentChannels, ...mentionedIds])];
      } else if (action === 'remove') {
        newChannelIds = currentChannels.filter((c: string) => !mentionedIds.includes(c));
        if (newChannelIds.length === 0) newChannelIds = currentChannels;
      } else {
        newChannelIds = mentionedIds.length > 0 ? mentionedIds : currentChannels;
      }

      await handleUpdateAgentGoalWithChannels(agentId, goalMessage, userId, channelId, threadTs, newChannelIds);
    } else {
      await handleUpdateAgentGoal(agentId, goalMessage, userId, channelId, threadTs);
    }
  } catch (err: any) {
    logger.error('Update request classification failed', { error: err.message, agentId });
    // Fallback: treat the whole message as a goal update
    await handleUpdateAgentGoal(agentId, userMessage, userId, channelId, threadTs);
  }
}

async function handleUpdateAgentGoalWithChannels(agentId: string, newGoal: string, userId: string, channelId: string, threadTs: string, newChannelIds: string[]): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) { await postMessage(channelId, ':x: Agent not found.', threadTs); return; }

  await postMessage(channelId, `:gear: Analyzing updated goal for *${agent.name}*...`, threadTs);

  try {
    const analysis = await analyzeGoal(newGoal, agent.system_prompt, userId);
    await showUpdateAgentConfirmation(analysis, agentId, newGoal, userId, channelId, threadTs, newChannelIds);
  } catch (err: any) {
    logger.error('Update goal analysis failed', { error: err.message, agentId, userId });
    await postMessage(channelId, `:x: Failed to analyze updated goal: ${err.message}`, threadTs);
  }
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
    const currentChannels = agent.channel_ids?.length > 0 ? agent.channel_ids : [agent.channel_id];
    await showUpdateAgentConfirmation(analysis, agentId, newGoal, userId, channelId, threadTs, currentChannels);
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

  const defaultEffort = maxTurnsToEffort(analysis.max_turns || agent.max_turns || 25);
  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
    [confirmId, JSON.stringify({ analysis, name: agent.name, goal: newGoal, userId, agentId, newChannelIds, channelId, threadTs, selectedModel: analysis.model, selectedEffort: defaultEffort })],
  );

  const configSummary = buildConfigSummary(agent.name, analysis, newGoal, agent);
  const toolWarnings = buildToolWarningBlocks(analysis);
  await postBlocks(channelId, [
    { type: 'header', text: { type: 'plain_text', text: `Update: ${agent.name}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `${channelNote}${channelNote ? '\n' : ''}${configSummary}` } },
    ...toolWarnings,
    { type: 'divider' },
    ...buildModelAndEffortBlocks(confirmId, analysis.model, defaultEffort),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✋ Confirm & Update' },
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
      await replyToAction(body, ':x: This confirmation has expired. Please run `/agents` and try again.');
      return;
    }

    try {
      const { analysis, name, goal, userId, existingChannelIds, existingChannelId, selectedModel, selectedEffort, visibility, memberIds } = row.data;

      // Apply user-selected model and effort overrides
      const finalModel = selectedModel || analysis.model;
      const finalMaxTurns = selectedEffort ? (EFFORT_TO_MAX_TURNS[selectedEffort] || 25) : (analysis.max_turns || 25);

      await replyToAction(body, ':gear: Creating agent...');

      // Use existing channels or create new one
      const channelIds: string[] = existingChannelIds || (existingChannelId ? [existingChannelId] : [await createChannel(name)]);

      // Merge builtin tools + read-only custom tools into agent's tool list
      const agentTools = [...analysis.tools, ...(analysis.custom_tools || [])];

      const agent = await createAgent({
        name,
        channelId: channelIds[0],
        channelIds,
        systemPrompt: analysis.system_prompt,
        tools: agentTools,
        model: finalModel,
        memoryEnabled: analysis.memory_enabled,
        respondToAllMessages: analysis.respond_to_all_messages,
        mentionsOnly: analysis.mentions_only,
        visibility: visibility || 'public',
        relevanceKeywords: analysis.relevance_keywords,
        createdBy: userId,
        maxTurns: finalMaxTurns,
      });

      // Add members for private agents
      if (visibility === 'private' && memberIds?.length > 0) {
        await addAgentMembers(agent.id, memberIds, userId);
      }

      const allTools = [...analysis.tools, ...(analysis.custom_tools || [])];
      const visibilityLabel = visibility === 'private' ? ':lock: Private' : 'Public';
      const lines = [
        `✋ Meet *${agent.name}*! Deployed by <@${userId}> and ready to get to work. It's small, but it's ready.`,
        '',
        `*Goal:* ${goal.slice(0, 300)}`,
        `*Model:* ${finalModel} | *Memory:* ${analysis.memory_enabled ? 'on' : 'off'} | *Visibility:* ${visibilityLabel}`,
        `*Responds to:* ${respondModeLabel(analysis)}`,
        `*Tools:* ${allTools.join(', ')}`,
        analysis.skills.length > 0 ? `*Skills:* ${analysis.skills.join(', ')}` : '',
        analysis.triggers.length > 0 ? `*Triggers:* ${analysis.triggers.map((t: any) => t.description).join(', ')}` : '',
        visibility === 'private' && memberIds?.length > 0 ? `*Members:* ${memberIds.map((m: string) => `<@${m}>`).join(', ')}` : '',
      ].filter(Boolean);

      // Post announcement in first channel
      await postMessage(channelIds[0], lines.join('\n'));
      const channelLabels = channelIds.map((c: string) => `<#${c}>`).join(', ');
      await replyToAction(body, `✋ *${agent.name}* is live! Channels: ${channelLabels}`);

      // Fire-and-forget: skills, triggers, and admin notifications
      // These are non-critical and should not block the user-facing confirmation
      (async () => {
        try {
          for (const skillName of analysis.skills) {
            try { await attachSkillToAgent(agent.id, skillName, 'read', userId); }
            catch (err: any) { logger.warn('Skill attach failed', { skillName, error: err.message }); }
          }

          for (const trigger of analysis.triggers) {
            try {
              if (trigger.type === 'schedule' && trigger.config?.timezone === 'auto') {
                try {
                  const userInfo = await getSlackApp().client.users.info({ user: userId });
                  trigger.config.timezone = userInfo.user?.tz || 'UTC';
                } catch { trigger.config.timezone = 'UTC'; }
              }
              await createTrigger({
                agentId: agent.id,
                triggerType: trigger.type,
                config: { ...trigger.config, description: trigger.description },
                createdBy: userId,
              });
            } catch (err: any) { logger.warn('Trigger creation failed', { trigger: trigger.type, error: err.message }); }
          }

          if (analysis.write_tools_requested?.length > 0) {
            await notifyAdminWriteToolRequest(agent.id, agent.name, analysis.write_tools_requested, userId);
          }
          if (analysis.new_tools_needed?.length > 0) {
            await notifyAdminNewToolRequest(agent.id, agent.name, analysis.new_tools_needed, goal, userId);
          }
        } catch (err: any) {
          logger.error('Post-creation background tasks failed', { agentId: agent.id, error: err.message });
        }
      })();

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

  app.action('confirm_update_agent', async ({ action, ack, body, respond }) => {
    await ack();
    const confirmId = (action as any).value;
    logger.info('confirm_update_agent: start', { confirmId });

    const row = await queryOne<{ data: any; expires_at: Date }>(
      `DELETE FROM pending_confirmations WHERE id = $1 RETURNING data, expires_at`, [confirmId],
    );

    if (!row || !row.data.agentId || new Date(row.expires_at) < new Date()) {
      await respond({ text: ':x: This confirmation has expired. Please run `/agents` and try again.', replace_original: false });
      return;
    }

    const confirmChannelId = row.data.channelId as string | undefined;
    const confirmThreadTs = row.data.threadTs as string | undefined;

    try {
      const { analysis, agentId, userId, newChannelIds, newChannelId, selectedModel, selectedEffort } = row.data;
      logger.info('confirm_update_agent: fetching agent', { agentId });
      const agent = await getAgent(agentId!);
      if (!agent) throw new Error('Agent not found');

      // Apply user-selected model and effort overrides
      const finalModel = selectedModel || analysis.model;
      const finalMaxTurns = selectedEffort ? (EFFORT_TO_MAX_TURNS[selectedEffort] || 25) : (analysis.max_turns || agent.max_turns || 25);

      // Post to thread (not ephemeral to main channel)
      if (confirmChannelId && confirmThreadTs) {
        await postMessage(confirmChannelId, ':gear: Updating agent...', confirmThreadTs);
      } else {
        await respond({ text: ':gear: Updating agent...', replace_original: false });
      }

      const mergedTools = [...analysis.tools, ...(analysis.custom_tools || [])];
      const updates: any = {
        system_prompt: analysis.system_prompt,
        tools: mergedTools,
        model: finalModel,
        max_turns: finalMaxTurns,
        memory_enabled: analysis.memory_enabled,
        respond_to_all_messages: analysis.respond_to_all_messages,
        mentions_only: analysis.mentions_only,
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

      logger.info('confirm_update_agent: updating DB', { agentId });
      await updateAgent(agentId!, updates, userId);
      logger.info('confirm_update_agent: DB updated', { agentId });

      // Reply in thread (or fallback to respond)
      if (confirmChannelId && confirmThreadTs) {
        await postMessage(confirmChannelId, `✋ *${agent.name}* updated! High five.`, confirmThreadTs);
      } else {
        await respond({ text: `✋ *${agent.name}* updated! High five.`, replace_original: false });
      }

      // Post update summary to the agent's channel (best-effort)
      const postToChannel = updates.channel_ids?.[0] || agent.channel_ids?.[0] || agent.channel_id;
      const channelChangeNote = updates.channel_ids
        ? `\n*Channels:* ${updates.channel_ids.map((c: string) => `<#${c}>`).join(', ')}`
        : '';

      const allUpdateTools = [...analysis.tools, ...(analysis.custom_tools || [])];
      try {
        await postMessage(postToChannel,
          `:arrows_counterclockwise: Agent *${agent.name}* updated by <@${userId}>\n\n` +
          `*Model:* ${analysis.model} | *Memory:* ${analysis.memory_enabled ? 'on' : 'off'}\n` +
          `*Responds to:* ${respondModeLabel(analysis)}\n` +
          `*Tools:* ${allUpdateTools.join(', ')}` +
          channelChangeNote + '\n' +
          `_${analysis.summary}_`
        );
      } catch (err: any) {
        logger.warn('Failed to post update summary to agent channel', { agentId, channel: postToChannel, error: err.message });
      }
      logger.info('confirm_update_agent: done', { agentId });

      // Fire-and-forget: skills, triggers, and admin notifications
      // These are non-critical and should not block the user-facing confirmation
      (async () => {
        try {
          for (const skillName of (analysis.skills || [])) {
            try { await attachSkillToAgent(agentId!, skillName, 'read', userId); } catch { /* may exist */ }
          }

          for (const trigger of (analysis.triggers || [])) {
            try {
              if (trigger.type === 'schedule' && trigger.config?.timezone === 'auto') {
                try {
                  const userInfo = await getSlackApp().client.users.info({ user: userId });
                  trigger.config.timezone = userInfo.user?.tz || 'UTC';
                } catch { trigger.config.timezone = 'UTC'; }
              }
              await createTrigger({
                agentId: agentId!,
                triggerType: trigger.type,
                config: { ...trigger.config, description: trigger.description },
                createdBy: userId,
              });
            } catch (err: any) { logger.warn('Trigger creation failed during update', { error: err.message }); }
          }

          if (analysis.write_tools_requested?.length > 0) {
            await notifyAdminWriteToolRequest(agentId!, agent.name, analysis.write_tools_requested, userId);
          }
          if (analysis.new_tools_needed?.length > 0) {
            await notifyAdminNewToolRequest(agentId!, agent.name, analysis.new_tools_needed, row.data.goal || '', userId);
          }
        } catch (err: any) {
          logger.error('Post-update background tasks failed', { agentId, error: err.message });
        }
      })();

    } catch (err: any) {
      logger.error('Agent update failed', { error: err.message });
      if (confirmChannelId && confirmThreadTs) {
        await postMessage(confirmChannelId, `:x: Failed to update agent: ${err.message}`, confirmThreadTs);
      } else {
        await respond({ text: `:x: Failed to update agent: ${err.message}`, replace_original: false });
      }
    }
  });

  app.action('cancel_update_agent', async ({ action, ack, respond }) => {
    await ack();
    const cancelRow = await queryOne<{ data: any }>(`DELETE FROM pending_confirmations WHERE id = $1 RETURNING data`, [(action as any).value]);
    if (cancelRow?.data?.channelId && cancelRow?.data?.threadTs) {
      await postMessage(cancelRow.data.channelId, ':x: Agent update cancelled.', cancelRow.data.threadTs);
    } else {
      await respond({ text: ':x: Agent update cancelled.', replace_original: false });
    }
  });

  // ── Model & Effort Selection Actions ──

  app.action('select_agent_model', async ({ action, ack, body }) => {
    await ack();
    const selectedModel = (action as any).selected_option?.value;
    if (!selectedModel) return;

    // Extract confirmId from the block_id (format: model_effort_{confirmId})
    const blockId = (action as any).block_id || '';
    const confirmId = blockId.replace('model_effort_', '');
    if (!confirmId) return;

    await execute(
      `UPDATE pending_confirmations SET data = jsonb_set(data, '{selectedModel}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(selectedModel), confirmId],
    );
  });

  app.action('select_agent_effort', async ({ action, ack, body }) => {
    await ack();
    const selectedEffort = (action as any).selected_option?.value;
    if (!selectedEffort) return;

    const blockId = (action as any).block_id || '';
    const confirmId = blockId.replace('model_effort_', '');
    if (!confirmId) return;

    await execute(
      `UPDATE pending_confirmations SET data = jsonb_set(data, '{selectedEffort}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(selectedEffort), confirmId],
    );
  });

  // ── Visibility & Members Selection ──

  app.action(/^visibility_select:/, async ({ action, ack }: any) => {
    await ack();
    const selectedVisibility = action.selected_option?.value;
    if (!selectedVisibility) return;

    const confirmId = action.action_id.replace('visibility_select:', '');
    if (!confirmId) return;

    await execute(
      `UPDATE pending_confirmations SET data = jsonb_set(data, '{visibility}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(selectedVisibility), confirmId],
    );
  });

  app.action(/^member_select:/, async ({ action, ack }: any) => {
    await ack();
    const selectedUsers = action.selected_users || [];
    const confirmId = action.action_id.replace('member_select:', '');
    if (!confirmId) return;

    await execute(
      `UPDATE pending_confirmations SET data = jsonb_set(data, '{memberIds}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(selectedUsers), confirmId],
    );
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

      const retryTools = [...freshAnalysis.tools, ...(freshAnalysis.custom_tools || [])];
      const agent = await createAgent({
        name: agentName,
        channelId: agentChannelId,
        systemPrompt: freshAnalysis.system_prompt,
        tools: retryTools,
        model: freshAnalysis.model,
        memoryEnabled: freshAnalysis.memory_enabled,
        respondToAllMessages: freshAnalysis.respond_to_all_messages,
        mentionsOnly: freshAnalysis.mentions_only,
        relevanceKeywords: freshAnalysis.relevance_keywords,
        createdBy: requestedBy,
      });

      for (const skillName of freshAnalysis.skills) {
        try { await attachSkillToAgent(agent.id, skillName, 'read', requestedBy); }
        catch (err: any) { logger.warn('Skill attach failed', { skillName, error: err.message }); }
      }

      for (const trigger of freshAnalysis.triggers) {
        try {
          // Auto-detect timezone for schedule triggers
          if (trigger.type === 'schedule' && trigger.config?.timezone === 'auto') {
            try {
              const userInfo = await getSlackApp().client.users.info({ user: requestedBy });
              trigger.config.timezone = userInfo.user?.tz || 'UTC';
            } catch { trigger.config.timezone = 'UTC'; }
          }
          await createTrigger({
            agentId: agent.id,
            triggerType: trigger.type,
            config: { ...trigger.config, description: trigger.description },
            createdBy: requestedBy,
          });
        } catch (err: any) { logger.warn('Trigger creation failed', { error: err.message }); }
      }

      // If new tools or write tools were needed, notify admin
      if (freshAnalysis.new_tools_needed?.length > 0) {
        await notifyAdminNewToolRequest(agent.id, agent.name, freshAnalysis.new_tools_needed, goal, requestedBy);
      }
      if (freshAnalysis.write_tools_requested?.length > 0) {
        await notifyAdminWriteToolRequest(agent.id, agent.name, freshAnalysis.write_tools_requested, requestedBy);
      }

      // Remove the feature request
      await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [requestId]);

      // Notify the original requester
      await postMessage(requestedInChannel,
        `✋ <@${requestedBy}> High five! *${agent.name}* has been created and is waiting in <#${agentChannelId}>. Let's get to work.`
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

  // ── Write Tool Approval Actions ──

  app.action('approve_write_tools', async ({ action, ack, body }) => {
    await ack();
    const requestId = (action as any).value;
    const row = await queryOne<{ data: any }>(
      `SELECT data FROM pending_confirmations WHERE id = $1`, [requestId],
    );

    if (!row || row.data.type !== 'write_tool_approval') {
      await replyToAction(body, ':x: This request no longer exists.');
      return;
    }

    const { agentId, agentName, writeTools, requestedBy } = row.data;

    try {
      const { addToolToAgent } = await import('../modules/tools');
      const adminUserId = body.user.id;
      for (const toolName of writeTools) {
        try { await addToolToAgent(agentId, toolName, adminUserId); }
        catch (err: any) { logger.warn('Write tool attach failed', { toolName, error: err.message }); }
      }

      await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [requestId]);
      await replyToAction(body, `:white_check_mark: Write tools (${writeTools.join(', ')}) approved and added to *${agentName}*!`);

      // Notify the requesting user
      const agentObj = await getAgent(agentId);
      if (agentObj) {
        const postChannel = agentObj.channel_ids?.[0] || agentObj.channel_id;
        await postMessage(postChannel,
          `:unlock: <@${requestedBy}> The write tools (${writeTools.join(', ')}) have been approved for *${agentName}* by an admin.`
        );
      }
    } catch (err: any) {
      await replyToAction(body, `:x: Failed to approve: ${err.message}`);
    }
  });

  app.action('deny_write_tools', async ({ action, ack, body }) => {
    await ack();
    const requestId = (action as any).value;
    await execute(`DELETE FROM pending_confirmations WHERE id = $1`, [requestId]);
    await replyToAction(body, ':x: Write tool request denied.');
  });

  app.action('ack_new_tool_request', async ({ action, ack, body }) => {
    await ack();
    const requestId = (action as any).value;
    await replyToAction(body, ':white_check_mark: Acknowledged. The tool(s) will need to be created by an admin via code.');
  });

  // ── Unconfigured Tool Configuration Action ──

  app.action('configure_unconfigured_tool', async ({ action, ack, body }) => {
    await ack();
    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;

    let parsed: { toolName: string; requestId: string };
    try {
      parsed = JSON.parse((action as any).value);
    } catch {
      return;
    }

    const { getCustomTool } = await import('../modules/tools');
    const tool = await getCustomTool(parsed.toolName);
    if (!tool) {
      await replyToAction(body, `:x: Tool \`${parsed.toolName}\` not found.`);
      return;
    }

    const existingConfig = JSON.parse(tool.config_json || '{}');
    const configKeys = Object.keys(existingConfig);

    const existingBlocks: any[] = configKeys.length > 0
      ? [{
          type: 'section', block_id: 'existing_config',
          text: {
            type: 'mrkdwn',
            text: '*Current config:*\n' + configKeys.map(k => {
              const v = String(existingConfig[k]);
              const masked = v.length > 6 ? v.slice(0, 3) + '***' + v.slice(-3) : '***';
              return `• \`${k}\` = \`${masked}\``;
            }).join('\n'),
          },
        }]
      : [{ type: 'section', text: { type: 'mrkdwn', text: '_No config set yet_' } }];

    await openModal(triggerId, {
      type: 'modal',
      callback_id: 'tool_config_modal',
      private_metadata: parsed.toolName,
      title: { type: 'plain_text', text: `Configure ${parsed.toolName}`.slice(0, 24) },
      submit: { type: 'plain_text', text: 'Save' },
      blocks: [
        ...existingBlocks,
        { type: 'divider' },
        {
          type: 'input', block_id: 'config_key', optional: true,
          label: { type: 'plain_text', text: 'Config Key' },
          element: { type: 'plain_text_input', action_id: 'key_input', placeholder: { type: 'plain_text', text: 'e.g. api_key' } },
        },
        {
          type: 'input', block_id: 'config_value', optional: true,
          label: { type: 'plain_text', text: 'Config Value' },
          element: { type: 'plain_text_input', action_id: 'value_input', placeholder: { type: 'plain_text', text: 'e.g. your-api-key' } },
        },
        {
          type: 'input', block_id: 'remove_key', optional: true,
          label: { type: 'plain_text', text: 'Remove Key (leave blank to skip)' },
          element: { type: 'plain_text_input', action_id: 'remove_input', placeholder: { type: 'plain_text', text: 'e.g. old_key' } },
        },
      ],
    });
  });
}

// ── Effort Level Mapping ──

const EFFORT_TO_MAX_TURNS: Record<string, number> = {
  low: 5,
  medium: 15,
  high: 25,
  max: 50,
};

const MAX_TURNS_TO_EFFORT: Record<number, string> = {
  5: 'low',
  15: 'medium',
  25: 'high',
  50: 'max',
};

function maxTurnsToEffort(maxTurns: number): string {
  if (maxTurns <= 5) return 'low';
  if (maxTurns <= 15) return 'medium';
  if (maxTurns <= 25) return 'high';
  return 'max';
}

function respondModeLabel(analysis: { respond_to_all_messages: boolean; mentions_only?: boolean }): string {
  if (analysis.respond_to_all_messages) return 'all messages';
  if (analysis.mentions_only) return '@mentions only';
  return 'relevant messages + @mentions';
}

function respondModeLabelFromAgent(agent: { respond_to_all_messages: boolean; mentions_only: boolean }): string {
  if (agent.respond_to_all_messages) return 'all messages';
  if (agent.mentions_only) return '@mentions only';
  return 'relevant messages + @mentions';
}

function buildModelAndEffortBlocks(confirmId: string, selectedModel: string, selectedEffort: string): any[] {
  const models = [
    { text: { type: 'plain_text' as const, text: 'Haiku — fast, simple tasks' }, value: 'haiku' },
    { text: { type: 'plain_text' as const, text: 'Sonnet — balanced (default)' }, value: 'sonnet' },
    { text: { type: 'plain_text' as const, text: 'Opus — complex reasoning' }, value: 'opus' },
  ];
  const efforts = [
    { text: { type: 'plain_text' as const, text: 'Low — quick responses (5 turns)' }, value: 'low' },
    { text: { type: 'plain_text' as const, text: 'Medium — balanced (15 turns)' }, value: 'medium' },
    { text: { type: 'plain_text' as const, text: 'High — thorough (25 turns)' }, value: 'high' },
    { text: { type: 'plain_text' as const, text: 'Max — maximum depth (50 turns)' }, value: 'max' },
  ];

  return [
    {
      type: 'actions',
      block_id: `model_effort_${confirmId}`,
      elements: [
        {
          type: 'static_select',
          action_id: 'select_agent_model',
          placeholder: { type: 'plain_text', text: 'Model' },
          initial_option: models.find(m => m.value === selectedModel) || models[1],
          options: models,
        },
        {
          type: 'static_select',
          action_id: 'select_agent_effort',
          placeholder: { type: 'plain_text', text: 'Effort' },
          initial_option: efforts.find(e => e.value === selectedEffort) || efforts[2],
          options: efforts,
        },
      ],
    },
  ];
}

// ── Helpers ──

function buildToolWarningBlocks(analysis: any): any[] {
  const blocks: any[] = [];

  if (analysis.new_tools_needed?.length > 0) {
    const toolList = analysis.new_tools_needed
      .map((t: any) => `• \`${t.name}\` — ${t.description}`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *New tools needed (admin setup required):*\n${toolList}\n_The system prompt references these tools but they don't exist yet. The agent will work without them but won't have these capabilities until they're registered via \`/tools\`._`,
      },
    });
  }

  if (analysis.new_skills_needed?.length > 0) {
    const skillList = analysis.new_skills_needed
      .map((s: any) => `• \`${s.name}\` — ${s.description}`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *New skills needed:*\n${skillList}`,
      },
    });
  }

  const unconfiguredTools = (analysis.blockers || [])
    .map((b: string) => b.match(/^Tool '(.+)' is registered but not configured/))
    .filter(Boolean)
    .map((m: RegExpMatchArray) => m[1]);

  if (unconfiguredTools.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:key: *Tools need API keys:* ${unconfiguredTools.map((t: string) => `\`${t}\``).join(', ')}\n_These tools are registered but not configured. Add API keys via \`/tools\` before they'll work._`,
      },
    });
  }

  return blocks;
}

function buildConfigSummary(name: string, analysis: any, goal: string, existingAgent?: any): string {
  const lines: string[] = [];

  const displayGoal = analysis.summary || goal;
  lines.push(`*Goal:* ${displayGoal.slice(0, 300)}${displayGoal.length > 300 ? '...' : ''}`);
  lines.push('');
  lines.push(`*Name:* ${name}`);
  lines.push(`*Model:* ${analysis.model}`);
  lines.push(`*Memory:* ${analysis.memory_enabled ? 'enabled' : 'disabled'}`);
  const allConfigTools = [...analysis.tools, ...(analysis.custom_tools || [])];
  lines.push(`*Tools:* ${allConfigTools.join(', ')}`);

  if (analysis.write_tools_requested?.length > 0) {
    lines.push(`*Write tools (pending admin approval):* ${analysis.write_tools_requested.join(', ')}`);
  }

  if (analysis.skills?.length > 0) {
    lines.push(`*Skills:* ${analysis.skills.join(', ')}`);
  }

  // When will it respond section
  lines.push('');
  lines.push('*:zap: When will it respond:*');
  if (analysis.respond_to_all_messages) {
    lines.push('• Responds to *every message* in the channel');
  } else if (analysis.mentions_only) {
    lines.push('• Responds only when *@mentioned*');
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
    lines.push(`*Needs tools (admin must create):* ${analysis.new_tools_needed.map((t: any) => t.name).join(', ')}`);
  }
  if (analysis.new_skills_needed?.length > 0) {
    lines.push(`*Needs skills (admin must create):* ${analysis.new_skills_needed.map((s: any) => s.name).join(', ')}`);
  }

  if (existingAgent) {
    const changes: string[] = [];
    if (existingAgent.model !== analysis.model) changes.push(`model: ${existingAgent.model} → ${analysis.model}`);
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

async function notifyAdminWriteToolRequest(
  agentId: string, agentName: string, writeTools: string[], requestedBy: string,
): Promise<void> {
  const superadmins = await listSuperadmins();
  if (superadmins.length === 0) return;

  const requestId = uuid();
  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [requestId, JSON.stringify({
      type: 'write_tool_approval',
      agentId,
      agentName,
      writeTools,
      requestedBy,
    })],
  );

  const toolList = writeTools.map(t => `• \`${t}\``).join('\n');
  await sendDMBlocks(superadmins[0].user_id, [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':lock: Write Tool Approval Request' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<@${requestedBy}> created agent *${agentName}* which needs read-write tools:\n${toolList}\n\nApprove to add these tools to the agent.`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':white_check_mark: Approve' },
          style: 'primary',
          action_id: 'approve_write_tools',
          value: requestId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':x: Deny' },
          action_id: 'deny_write_tools',
          value: requestId,
        },
      ],
    },
  ], `Write tool approval for ${agentName}`);
}

async function notifyAdminNewToolRequest(
  agentId: string, agentName: string,
  newTools: Array<{ name: string; description: string }>,
  goal: string, requestedBy: string,
): Promise<void> {
  const superadmins = await listSuperadmins();
  if (superadmins.length === 0) return;

  const requestId = uuid();
  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [requestId, JSON.stringify({
      type: 'new_tool_request',
      agentId,
      agentName,
      newTools,
      goal,
      requestedBy,
    })],
  );

  const toolList = newTools.map(t => `• *${t.name}*: ${t.description}`).join('\n');
  await sendDMBlocks(superadmins[0].user_id, [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':wrench: New Tool Request' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<@${requestedBy}> created agent *${agentName}* which needs tools that don't exist yet:\n${toolList}\n\n*Agent goal:* ${goal.slice(0, 500)}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':white_check_mark: Acknowledge' },
          action_id: 'ack_new_tool_request',
          value: requestId,
        },
      ],
    },
  ], `New tool request for ${agentName}`);
}

// ── Thread-based Source & API Key Flows ──

async function handleSourceTypeSelected(
  sourceType: string, userId: string, channelId: string, threadTs: string,
): Promise<void> {
  const { getConnector } = await import('../modules/kb-sources/connectors');
  const { isProviderConfigured } = await import('../modules/kb-sources');
  const connector = getConnector(sourceType);

  const providerReady = await isProviderConfigured(connector.provider);

  if (!providerReady) {
    // Need API keys first — show setup steps and ask for keys
    const keyFields = connector.requiredKeys.map(k =>
      `\`${k}\`: your_value_here`
    ).join('\n');

    await postMessage(
      channelId,
      `:white_check_mark: *${connector.icon} ${connector.label}* selected.\n\n`
      + `*Step 2:* I need your *${connector.provider}* API credentials first.\n\n`
      + `*How to get them:*\n${connector.setupSteps.join('\n')}\n\n`
      + `Once you have them, paste them here in this format (one per line):\n\`\`\`\n${keyFields}\n\`\`\``,
      threadTs,
    );

    await execute(
      `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [uuid(), JSON.stringify({
        type: 'conversation',
        step: 'awaiting_source_api_keys',
        flow: 'add_source',
        sourceType,
        userId,
        channelId,
        threadTs,
      })],
    );
  } else {
    // API keys ready — ask for source name and config
    await askForSourceDetails(connector, sourceType, userId, channelId, threadTs);
  }
}

async function askForSourceDetails(
  connector: any, sourceType: string, userId: string, channelId: string, threadTs: string,
): Promise<void> {
  const requiredFields = connector.configFields.filter((f: any) => !f.optional);
  const optionalFields = connector.configFields.filter((f: any) => f.optional);

  let configPrompt = ':white_check_mark: API keys are configured!\n\n'
    + `*Step 3:* Give this source a name and configure it.\n\n`
    + `Please reply with the details in this format:\n\`\`\`\n`
    + `name: My Source Name\n`;

  for (const field of connector.configFields) {
    configPrompt += `${field.key}: ${field.placeholder}${field.optional ? ' (optional)' : ''}\n`;
  }
  configPrompt += '```';

  if (requiredFields.length === 0) {
    configPrompt = ':white_check_mark: API keys are configured!\n\n'
      + `*Step 3:* Give this source a name.\n\n`
      + `Please reply with a name for this source, e.g.:\n`
      + `\`Engineering Docs\``;
  }

  await postMessage(channelId, configPrompt, threadTs);

  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
    [uuid(), JSON.stringify({
      type: 'conversation',
      step: 'awaiting_source_details',
      flow: 'add_source',
      sourceType,
      userId,
      channelId,
      threadTs,
    })],
  );
}

async function handleSourceApiKeys(
  text: string, sourceType: string, userId: string, channelId: string, threadTs: string,
): Promise<void> {
  const { getConnector } = await import('../modules/kb-sources/connectors');
  const { setApiKey } = await import('../modules/kb-sources');
  const connector = getConnector(sourceType);

  // Parse key: value pairs from text
  const config: Record<string, string> = {};
  const lines = text.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().replace(/`/g, '');
      const val = line.slice(colonIdx + 1).trim();
      if (key && val && val !== 'your_value_here') {
        config[key] = val;
      }
    }
  }

  // Check that all required keys are present
  const missing = connector.requiredKeys.filter((k: string) => !config[k]);
  if (missing.length > 0) {
    await postMessage(
      channelId,
      `:warning: Missing required keys: ${missing.map((k: string) => `\`${k}\``).join(', ')}\n\nPlease provide all keys in the format:\n\`key: value\` (one per line)`,
      threadTs,
    );
    // Re-insert state to keep waiting
    await execute(
      `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [uuid(), JSON.stringify({
        type: 'conversation',
        step: 'awaiting_source_api_keys',
        flow: 'add_source',
        sourceType,
        userId,
        channelId,
        threadTs,
      })],
    );
    return;
  }

  try {
    await setApiKey(connector.provider, config, userId);
    await postMessage(channelId, `:white_check_mark: *${connector.provider}* API keys saved!`, threadTs);

    // Now ask for source details
    await askForSourceDetails(connector, sourceType, userId, channelId, threadTs);
  } catch (err: any) {
    await postMessage(channelId, `:x: Failed to save API keys: ${err.message}`, threadTs);
  }
}

async function handleSourceDetails(
  text: string, sourceType: string, userId: string, channelId: string, threadTs: string,
): Promise<void> {
  const { getConnector } = await import('../modules/kb-sources/connectors');
  const { createSource, startSync } = await import('../modules/kb-sources');
  const connector = getConnector(sourceType);

  // Parse the reply for name and config fields
  const config: Record<string, string> = {};
  let sourceName = '';

  const lines = text.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().replace(/`/g, '').toLowerCase();
      const val = line.slice(colonIdx + 1).trim();
      if (key === 'name') {
        sourceName = val;
      } else if (val) {
        // Match against known config fields
        const matchedField = connector.configFields.find((f: any) =>
          f.key.toLowerCase() === key || f.label.toLowerCase() === key
        );
        if (matchedField) {
          config[matchedField.key] = val;
        }
      }
    }
  }

  // If no structured format found, treat the whole reply as the name
  if (!sourceName && Object.keys(config).length === 0) {
    sourceName = text.trim();
  }

  if (!sourceName) {
    await postMessage(channelId, ':warning: Please provide at least a name for this source.', threadTs);
    // Re-insert state
    await execute(
      `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [uuid(), JSON.stringify({
        type: 'conversation',
        step: 'awaiting_source_details',
        flow: 'add_source',
        sourceType,
        userId,
        channelId,
        threadTs,
      })],
    );
    return;
  }

  try {
    const source = await createSource({
      name: sourceName,
      sourceType: sourceType as any,
      config,
      createdBy: userId,
    });

    let msg = `:white_check_mark: Source *${sourceName}* created!\n`
      + `• Type: ${connector.icon} ${connector.label}\n`
      + `• Status: \`${source.status}\`\n`;

    if (Object.keys(config).length > 0) {
      msg += `• Config: ${Object.entries(config).map(([k, v]) => `${k}=\`${v}\``).join(', ')}\n`;
    }

    if (source.status === 'active') {
      try {
        await startSync(source.id);
        msg += '\n:arrows_counterclockwise: Sync started in background!';
      } catch (syncErr: any) {
        msg += `\n:warning: Sync failed to start: ${syncErr.message}`;
      }
    }

    await postMessage(channelId, msg, threadTs);
  } catch (err: any) {
    await postMessage(channelId, `:x: Failed to create source: ${err.message}`, threadTs);
  }
}

async function startApiKeySetup(
  provider: string, userId: string, channelId: string, threadTs: string,
): Promise<void> {
  const { getApiKey } = await import('../modules/kb-sources');
  const { CONNECTORS } = await import('../modules/kb-sources/connectors');

  const connector = Object.values(CONNECTORS).find((c: any) => c.provider === provider);
  if (!connector) return;

  const existingKey = await getApiKey(provider as any);
  const existingConfig = existingKey ? JSON.parse(existingKey.config_json) : {};

  let msg = `:key: *Setup ${provider} API credentials*\n\n`
    + `*How to get them:*\n${connector.setupSteps.join('\n')}\n\n`;

  if (existingKey?.setup_complete) {
    const maskedKeys = connector.requiredKeys.map((k: string) => {
      const val = existingConfig[k];
      if (!val) return `\`${k}\`: _(not set)_`;
      const masked = val.length > 8 ? val.slice(0, 4) + '...' + val.slice(-4) : '****';
      return `\`${k}\`: \`${masked}\``;
    }).join('\n');
    msg += `*Current values:*\n${maskedKeys}\n\n`;
  }

  const keyFields = connector.requiredKeys.map((k: string) =>
    `\`${k}\`: ${existingConfig[k] ? '(keep current or paste new value)' : 'your_value_here'}`
  ).join('\n');

  msg += `Paste your credentials here (one per line):\n\`\`\`\n${keyFields}\n\`\`\``;

  await postMessage(channelId, msg, threadTs);

  await execute(
    `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
    [uuid(), JSON.stringify({
      type: 'conversation',
      step: 'awaiting_api_keys',
      flow: 'api_keys',
      provider,
      userId,
      channelId,
      threadTs,
    })],
  );
}

async function handleApiKeysInput(
  text: string, provider: string, userId: string, channelId: string, threadTs: string,
): Promise<void> {
  const { setApiKey, getApiKey } = await import('../modules/kb-sources');
  const { CONNECTORS } = await import('../modules/kb-sources/connectors');

  const connector = Object.values(CONNECTORS).find((c: any) => c.provider === provider);
  if (!connector) return;

  // Get existing config to preserve unchanged values
  const existingKey = await getApiKey(provider as any);
  const existingConfig = existingKey ? JSON.parse(existingKey.config_json) : {};

  // Parse key: value pairs
  const config: Record<string, string> = { ...existingConfig };
  const lines = text.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().replace(/`/g, '');
      const val = line.slice(colonIdx + 1).trim();
      if (key && val && val !== 'your_value_here' && !val.startsWith('(keep current')) {
        config[key] = val;
      }
    }
  }

  const missing = connector.requiredKeys.filter((k: string) => !config[k]);
  if (missing.length > 0) {
    await postMessage(
      channelId,
      `:warning: Missing required keys: ${missing.map((k: string) => `\`${k}\``).join(', ')}\n\nPlease provide all keys.`,
      threadTs,
    );
    await execute(
      `INSERT INTO pending_confirmations (id, data, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [uuid(), JSON.stringify({
        type: 'conversation',
        step: 'awaiting_api_keys',
        flow: 'api_keys',
        provider,
        userId,
        channelId,
        threadTs,
      })],
    );
    return;
  }

  try {
    await setApiKey(provider as any, config, userId);
    await postMessage(
      channelId,
      `:white_check_mark: *${provider}* API keys saved and verified!\n`
      + `Keys configured: ${connector.requiredKeys.map((k: string) => `\`${k}\``).join(', ')}`,
      threadTs,
    );
  } catch (err: any) {
    await postMessage(channelId, `:x: Failed to save: ${err.message}`, threadTs);
  }
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
