import type { App } from '@slack/bolt';
import { v4 as uuid } from 'uuid';
import { createAgent, listAgents, getAgent, getAgentByName } from '../modules/agents';
import { initSuperadmin } from '../modules/access-control';
import { createChannel, postMessage } from './index';
import { logger } from '../utils/logger';

// ── Wizard State ──

interface WizardState {
  step: 'name' | 'persona' | 'tools' | 'permissions' | 'model' | 'confirm';
  name?: string;
  persona?: string;
  tools?: string[];
  permissionLevel?: string;
  model?: string;
  userId: string;
  channelId: string;
}

const wizardStates = new Map<string, WizardState>();
const WIZARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function registerCommands(app: App): void {
  // /new-agent — Start agent creation wizard
  app.command('/new-agent', async ({ command, ack, respond }) => {
    await ack();

    const userId = command.user_id;
    const key = `${userId}:${command.channel_id}`;

    // Initialize superadmin on first use
    initSuperadmin(userId);

    const state: WizardState = {
      step: 'name',
      userId,
      channelId: command.channel_id,
    };
    wizardStates.set(key, state);

    // Auto-cleanup after timeout
    setTimeout(() => {
      if (wizardStates.has(key)) {
        wizardStates.delete(key);
      }
    }, WIZARD_TIMEOUT_MS);

    await respond({
      text: ':robot_face: *Agent Creation Wizard*\n\nStep 1/5: What should this agent be named?',
      response_type: 'ephemeral',
    });
  });

  // /agents — List all agents
  app.command('/agents', async ({ command, ack, respond }) => {
    await ack();

    const agents = listAgents();

    if (agents.length === 0) {
      await respond({
        text: 'No agents created yet. Use `/new-agent` to create one.',
        response_type: 'ephemeral',
      });
      return;
    }

    const lines = agents.map(a =>
      `${a.avatar_emoji} *${a.name}* — <#${a.channel_id}> — ${a.status} — ${a.model} — ${a.permission_level}`
    );

    await respond({
      text: `*Active Agents (${agents.length}):*\n\n${lines.join('\n')}`,
      response_type: 'ephemeral',
    });
  });

  // /kb — Knowledge base commands
  app.command('/kb', async ({ command, ack, respond }) => {
    await ack();

    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0];

    switch (subcommand) {
      case 'add':
        await respond({
          text: 'Upload a file or paste content to add to the knowledge base.',
          response_type: 'ephemeral',
        });
        break;

      case 'search': {
        const query = args.slice(1).join(' ');
        if (!query) {
          await respond({ text: 'Usage: `/kb search <query>`', response_type: 'ephemeral' });
          return;
        }
        const { searchKB } = await import('../modules/knowledge-base');
        const results = searchKB(query);
        if (results.length === 0) {
          await respond({ text: 'No KB entries found.', response_type: 'ephemeral' });
        } else {
          const lines = results.map(r => `- *${r.title}* (${r.category}): ${r.summary}`);
          await respond({ text: `*KB Results:*\n${lines.join('\n')}`, response_type: 'ephemeral' });
        }
        break;
      }

      default:
        await respond({
          text: 'Usage: `/kb add` or `/kb search <query>`',
          response_type: 'ephemeral',
        });
    }
  });
}

// ── Wizard Message Handler ──

export async function handleWizardMessage(
  userId: string,
  channelId: string,
  text: string
): Promise<string | null> {
  const key = `${userId}:${channelId}`;
  const state = wizardStates.get(key);
  if (!state) return null;

  switch (state.step) {
    case 'name': {
      // Check duplicate
      const existing = getAgentByName(text.trim());
      if (existing) {
        return `:x: Agent "${text.trim()}" already exists. Please choose a different name.`;
      }
      state.name = text.trim();
      state.step = 'persona';
      return 'Step 2/5: Describe this agent\'s persona / system prompt:';
    }

    case 'persona':
      state.persona = text.trim();
      state.step = 'tools';
      return 'Step 3/5: Which tools should this agent have?\n' +
        'Options: `Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch`\n' +
        'Type `all` for all tools, or list specific ones (comma-separated):';

    case 'tools': {
      if (text.trim().toLowerCase() === 'all') {
        state.tools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
      } else {
        state.tools = text.split(',').map(t => t.trim()).filter(Boolean);
      }
      state.step = 'permissions';
      return 'Step 4/5: Permission level?\n' +
        '- `read-only` — Read, Glob, Grep, WebSearch, WebFetch\n' +
        '- `standard` — + Write, Edit, Bash (default)\n' +
        '- `full` — Unrestricted + sub-agents';
    }

    case 'permissions':
      state.permissionLevel = text.trim().toLowerCase() || 'standard';
      state.step = 'model';
      return 'Step 5/5: Which model?\n' +
        '- `sonnet` — General purpose (default)\n' +
        '- `opus` — Complex reasoning\n' +
        '- `haiku` — Fast/cheap (no thinking traces)';

    case 'model': {
      state.model = text.trim().toLowerCase() || 'sonnet';
      state.step = 'confirm';

      return `*Confirm Agent Creation:*\n\n` +
        `Name: *${state.name}*\n` +
        `Persona: ${state.persona?.slice(0, 100)}...\n` +
        `Tools: ${state.tools?.join(', ')}\n` +
        `Permissions: ${state.permissionLevel}\n` +
        `Model: ${state.model}\n\n` +
        `Type \`yes\` to create or \`cancel\` to abort.`;
    }

    case 'confirm': {
      if (text.trim().toLowerCase() === 'cancel') {
        wizardStates.delete(key);
        return ':x: Agent creation cancelled.';
      }

      if (text.trim().toLowerCase() !== 'yes') {
        return 'Type `yes` to create or `cancel` to abort.';
      }

      try {
        const agentChannelId = await createChannel(state.name!);

        const agent = createAgent({
          name: state.name!,
          channelId: agentChannelId,
          systemPrompt: state.persona!,
          tools: state.tools,
          model: (state.model as any) || 'sonnet',
          permissionLevel: (state.permissionLevel as any) || 'standard',
          createdBy: userId,
        });

        wizardStates.delete(key);

        return `:white_check_mark: Agent *${agent.name}* created!\n` +
          `Channel: <#${agent.channel_id}>\n` +
          `Model: ${agent.model} | Permissions: ${agent.permission_level}`;
      } catch (err: any) {
        wizardStates.delete(key);
        return `:x: Failed to create agent: ${err.message}`;
      }
    }

    default:
      wizardStates.delete(key);
      return null;
  }
}

export function isInWizard(userId: string, channelId: string): boolean {
  return wizardStates.has(`${userId}:${channelId}`);
}
