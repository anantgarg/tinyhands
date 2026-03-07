import type { App } from '@slack/bolt';
import { v4 as uuid } from 'uuid';
import { getAgentByChannel } from '../modules/agents';
import { enqueueRun } from '../queue';
import { handleWizardMessage, isInWizard } from './commands';
import { postMessage, publishHomeTab } from './index';
import { detectCritique } from '../modules/self-improvement';
import { parseModelOverride, stripModelOverride } from '../modules/model-selection';
import { findSlackChannelTriggers, fireTrigger } from '../modules/triggers';
import { buildDashboardBlocks } from '../modules/dashboard';
import { initSuperadmin } from '../modules/access-control';
import type { JobData } from '../types';
import { logger } from '../utils/logger';

// ── Slack Event Buffer for Rate Limiting ──

const EVENT_BUFFER_INTERVAL_MS = 1500;

export function registerEvents(app: App): void {
  // ── Message Events ──
  app.event('message', async ({ event, client }) => {
    const msg = event as any;
    if (msg.bot_id || msg.subtype) return; // Ignore bot messages

    const channelId = msg.channel;
    const userId = msg.user;
    const text = msg.text || '';
    const threadTs = msg.thread_ts || msg.ts;

    // Check if user is in creation wizard
    if (isInWizard(userId, channelId)) {
      const response = await handleWizardMessage(userId, channelId, text);
      if (response) {
        await postMessage(channelId, response, threadTs);
      }
      return;
    }

    // Check if message is in an agent channel
    const agent = getAgentByChannel(channelId);
    if (agent) {
      // Handle interactive agent-channel commands
      const interactiveResult = await handleAgentChannelCommand(text, agent, channelId, userId, threadTs);
      if (interactiveResult) return;

      // Check for model override
      const modelOverride = parseModelOverride(text);
      const cleanInput = modelOverride ? stripModelOverride(text) : text;

      // Check if this is critique (in-thread reply)
      if (msg.thread_ts && detectCritique(cleanInput)) {
        // Handle self-improvement via AI-powered diff generation
        const { applyPromptDiff, generatePromptDiff, formatDiffForSlack } = await import('../modules/self-improvement');

        const diff = await generatePromptDiff(agent.system_prompt, cleanInput, '');
        const diffText = formatDiffForSlack(diff.original, diff.proposed);

        await postMessage(
          channelId,
          `:brain: Analyzing critique and proposing prompt update...\n${diffText}`,
          threadTs,
          agent.name,
          agent.avatar_emoji
        );
        return;
      }

      // Normal agent task — enqueue
      const traceId = uuid();
      const jobData: JobData = {
        agentId: agent.id,
        channelId,
        threadTs,
        input: cleanInput,
        userId,
        traceId,
        modelOverride: modelOverride || undefined,
      };

      await enqueueRun(jobData, 'high');

      // Post acknowledgment
      await postMessage(
        channelId,
        `:hourglass: Working on it... (trace: \`${traceId.slice(0, 8)}\`)`,
        threadTs,
        agent.name,
        agent.avatar_emoji
      );

      logger.info('Task enqueued from Slack', {
        agentId: agent.id,
        traceId,
        userId,
        model: modelOverride || agent.model,
      });
      return;
    }

    // Check for Slack channel triggers
    const triggers = findSlackChannelTriggers(channelId);
    for (const trigger of triggers) {
      await fireTrigger({
        triggerId: trigger.id,
        idempotencyKey: `slack:${channelId}:${msg.ts}`,
        payload: { text, user: userId, channel: channelId, ts: msg.ts },
        sourceChannel: channelId,
        sourceThreadTs: threadTs,
      });
    }
  });

  // ── File Upload for KB ──
  app.event('file_shared' as any, async ({ event }: any) => {
    const channelId = event.channel_id;
    const agent = getAgentByChannel(channelId);
    if (!agent) return;

    try {
      const { createWizardState, advanceWizard, completeWizard } = await import('../modules/kb-wizard');
      // File uploads in agent channels auto-trigger KB wizard
      await postMessage(
        channelId,
        ':file_folder: File received. Processing for knowledge base...\n' +
        'Use `/kb add` to manually add content, or I\'ll index this automatically.',
      );
    } catch (err: any) {
      logger.error('File upload KB processing failed', { error: err.message });
    }
  });

  // ── DM Events (Superadmin) ──
  app.event('message' as any, async ({ event }: any) => {
    const msg = event;
    if (msg.channel_type !== 'im' || msg.bot_id) return;

    // First DM initializes superadmin
    initSuperadmin(msg.user);

    // Handle superadmin commands via DM
    const text = (msg.text || '').trim().toLowerCase();

    if (text.startsWith('add ') && text.includes('as superadmin')) {
      const { addSuperadmin } = await import('../modules/access-control');
      const match = text.match(/add\s+<@(\w+)>\s+as\s+superadmin/);
      if (match) {
        try {
          addSuperadmin(match[1], msg.user);
          await postMessage(msg.channel, `:white_check_mark: <@${match[1]}> added as superadmin`);
        } catch (err: any) {
          await postMessage(msg.channel, `:x: ${err.message}`);
        }
      }
    }
  });

  // ── App Home Opened ──
  app.event('app_home_opened', async ({ event }) => {
    const blocks = buildDashboardBlocks();
    await publishHomeTab(event.user, blocks);
  });
}

// ── Interactive Agent Channel Commands ──

async function handleAgentChannelCommand(
  text: string,
  agent: any,
  channelId: string,
  userId: string,
  threadTs: string
): Promise<boolean> {
  const lower = text.trim().toLowerCase();

  // "connect to github.com/..." or "connect to owner/repo"
  const connectGithubMatch = lower.match(/^connect\s+(?:to\s+)?(?:https?:\/\/)?(?:github\.com\/)?([\w.-]+\/[\w.-]+)/);
  if (connectGithubMatch) {
    try {
      const { connectSource, detectSourceType } = await import('../modules/sources');
      const { cloneRepo, parseGitHubUri } = await import('../modules/sources/github');
      const uri = connectGithubMatch[1];
      const parsed = parseGitHubUri(uri);
      if (!parsed) {
        await postMessage(channelId, ':x: Invalid GitHub URL. Use format: `connect to owner/repo`', threadTs);
        return true;
      }
      const source = connectSource({
        agentId: agent.id,
        sourceType: 'github',
        uri: `https://github.com/${parsed.owner}/${parsed.repo}`,
        label: `${parsed.owner}/${parsed.repo}`,
      });
      await postMessage(
        channelId,
        `:white_check_mark: Connected to GitHub repo \`${parsed.owner}/${parsed.repo}\` (branch: ${parsed.branch})\nSource ID: \`${source.id.slice(0, 8)}\`\nSyncing in background...`,
        threadTs,
      );
      // Trigger initial clone in background
      const repoDir = `/tmp/tinyjobs-sources-cache/${agent.id}/${source.id}`;
      cloneRepo(parsed.owner, parsed.repo, repoDir, parsed.branch).catch(err => {
        logger.error('Initial clone failed', { error: err.message });
      });
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: Failed to connect: ${err.message}`, threadTs);
      return true;
    }
  }

  // "connect to drive.google.com/..." or "connect to docs.google.com/..."
  const connectDriveMatch = lower.match(/^connect\s+(?:to\s+)?(https?:\/\/(?:docs|drive)\.google\.com\S+)/);
  if (connectDriveMatch) {
    try {
      const { connectSource } = await import('../modules/sources');
      const { parseDriveUri } = await import('../modules/sources/google-drive');
      const uri = connectDriveMatch[1];
      const parsed = parseDriveUri(uri);
      if (!parsed) {
        await postMessage(channelId, ':x: Invalid Google Drive URL.', threadTs);
        return true;
      }
      const source = connectSource({
        agentId: agent.id,
        sourceType: 'google_drive',
        uri,
        label: `Drive: ${parsed.fileId.slice(0, 12)}...`,
      });
      await postMessage(
        channelId,
        `:white_check_mark: Connected to Google Drive file.\nSource ID: \`${source.id.slice(0, 8)}\`\nWill sync every 15 minutes.`,
        threadTs,
      );
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: Failed to connect: ${err.message}`, threadTs);
      return true;
    }
  }

  // "trigger this agent when..." or "add trigger ..."
  const triggerMatch = lower.match(/^(?:trigger\s+(?:this\s+agent\s+)?when|add\s+trigger)\s+(.+)/);
  if (triggerMatch) {
    try {
      const { createTrigger } = await import('../modules/triggers');
      const description = triggerMatch[1];

      // Detect trigger type from description
      let triggerType: any = 'webhook';
      let triggerConfig: any = { description };

      if (description.includes('linear') || description.includes('issue')) {
        triggerType = 'linear';
        triggerConfig = { events: ['Issue'], description };
      } else if (description.includes('zendesk') || description.includes('ticket')) {
        triggerType = 'zendesk';
        triggerConfig = { events: ['ticket.created'], description };
      } else if (description.includes('intercom') || description.includes('conversation')) {
        triggerType = 'intercom';
        triggerConfig = { events: ['conversation.created'], description };
      } else if (description.includes('message') || description.includes('channel')) {
        triggerType = 'slack_channel';
        triggerConfig = { channel_id: channelId, description };
      }

      const trigger = createTrigger({
        agentId: agent.id,
        triggerType,
        config: triggerConfig,
        createdBy: userId,
      });

      await postMessage(
        channelId,
        `:zap: Trigger created!\nType: \`${triggerType}\`\nID: \`${trigger.id.slice(0, 8)}\`\n\nThis agent will now fire when: _${description}_`,
        threadTs,
      );
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: Failed to create trigger: ${err.message}`, threadTs);
      return true;
    }
  }

  // "add <skill> skill" or "add linear skill"
  const skillMatch = lower.match(/^add\s+([\w-]+)\s+skill(?:\s+with\s+(read|write|admin))?/);
  if (skillMatch) {
    try {
      const { attachSkillToAgent } = await import('../modules/skills');
      const skillName = skillMatch[1];
      const permLevel = (skillMatch[2] as any) || 'read';

      const agentSkill = attachSkillToAgent(agent.id, skillName, permLevel, userId);
      await postMessage(
        channelId,
        `:jigsaw: Skill *${skillName}* attached with \`${permLevel}\` permissions.`,
        threadTs,
      );
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "add @user as admin"
  const adminMatch = text.match(/^add\s+<@(\w+)>\s+as\s+admin/i);
  if (adminMatch) {
    try {
      const { addAgentAdmin } = await import('../modules/access-control');
      addAgentAdmin(agent.id, adminMatch[1], userId);
      await postMessage(channelId, `:white_check_mark: <@${adminMatch[1]}> is now an admin of *${agent.name}*`, threadTs);
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "forget about X"
  const forgetMatch = lower.match(/^forget\s+(?:about\s+)?(.+)/);
  if (forgetMatch && agent.memory_enabled) {
    try {
      const { forgetMemory } = await import('../modules/sources/memory');
      const count = forgetMemory(agent.id, forgetMatch[1]);
      await postMessage(
        channelId,
        count > 0
          ? `:wastebasket: Forgot ${count} memory/memories matching "${forgetMatch[1]}"`
          : `:shrug: No memories found matching "${forgetMatch[1]}"`,
        threadTs,
      );
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "create a tool that..." — AI-powered tool authoring
  const createToolMatch = lower.match(/^(?:create|write|build|make)\s+(?:a\s+)?tool\s+(?:that|to|for|which)\s+(.+)/);
  if (createToolMatch) {
    try {
      const { authorTool } = await import('../modules/self-authoring');
      await postMessage(
        channelId,
        ':hammer_and_wrench: Generating tool implementation...',
        threadTs,
        agent.name,
        agent.avatar_emoji,
      );

      const result = await authorTool(agent.id, createToolMatch[1]);
      const statusMsg = result.requiresApproval
        ? '\n:warning: Requires admin approval before use. An admin can say `approve tool ' + result.tool.name + '`'
        : '\n:white_check_mark: Auto-approved and ready to use.';

      await postMessage(
        channelId,
        `:hammer_and_wrench: Tool *${result.tool.name}* created!\n` +
        `Language: \`${result.tool.language}\`\n` +
        `Code: ${result.code.split('\n').length} lines (stored in DB)\n` +
        statusMsg,
        threadTs,
        agent.name,
        agent.avatar_emoji,
      );
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: Tool creation failed: ${err.message}`, threadTs);
      return true;
    }
  }

  // "create a skill that..." — AI-powered skill authoring
  const createSkillMatch = lower.match(/^(?:create|write|build|make)\s+(?:a\s+)?skill\s+(?:that|to|for|which)\s+(.+)/);
  if (createSkillMatch) {
    try {
      const { authorSkill } = await import('../modules/self-authoring');
      await postMessage(
        channelId,
        ':brain: Generating skill template...',
        threadTs,
        agent.name,
        agent.avatar_emoji,
      );

      const skill = await authorSkill(agent.id, createSkillMatch[1]);
      const statusMsg = skill.approved
        ? ':white_check_mark: Auto-approved and ready to use.'
        : ':warning: Requires admin approval.';

      await postMessage(
        channelId,
        `:jigsaw: Skill *${skill.name}* authored!\n` +
        `Description: ${skill.description}\n` +
        `Template preview:\n\`\`\`${skill.template.slice(0, 300)}${skill.template.length > 300 ? '...' : ''}\`\`\`\n` +
        statusMsg,
        threadTs,
        agent.name,
        agent.avatar_emoji,
      );
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: Skill creation failed: ${err.message}`, threadTs);
      return true;
    }
  }

  // "approve tool <name>" — admin approval for agent-authored tools
  const approveToolMatch = lower.match(/^approve\s+tool\s+([\w-]+)/);
  if (approveToolMatch) {
    try {
      const { approveCustomTool } = await import('../modules/tools');
      approveCustomTool(approveToolMatch[1], userId);
      await postMessage(
        channelId,
        `:white_check_mark: Tool *${approveToolMatch[1]}* approved and ready for use.`,
        threadTs,
      );
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "show tools" / "list tools"
  if (lower === 'show tools' || lower === 'list tools' || lower === 'my tools') {
    try {
      const { getAgentToolSummary } = await import('../modules/tools');
      const summary = getAgentToolSummary(agent.id);
      const lines = [
        `:toolbox: *Tools for ${agent.name}*`,
        `Built-in: ${summary.builtin.join(', ') || 'none'}`,
        `Custom: ${summary.custom.join(', ') || 'none'}`,
        `MCP: ${summary.mcp.join(', ') || 'none'}`,
      ];

      // Also show authored skills
      const { getAuthoredSkills } = await import('../modules/self-authoring');
      const authored = getAuthoredSkills(agent.id);
      if (authored.length > 0) {
        lines.push(`\nAuthored skills: ${authored.map(s => `${s.name}${s.approved ? '' : ' (pending)'}`).join(', ')}`);
      }

      await postMessage(channelId, lines.join('\n'), threadTs);
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "add to kb" — trigger KB wizard from a quoted reply
  if (lower === 'add to kb' || lower === 'add to knowledge base') {
    await postMessage(
      channelId,
      ':books: To add content to the knowledge base, paste or upload the content here, or use `/kb add`.',
      threadTs,
    );
    return true;
  }

  return false;
}
