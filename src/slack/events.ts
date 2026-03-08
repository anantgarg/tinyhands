import type { App } from '@slack/bolt';
import { v4 as uuid } from 'uuid';
import { getAgentByChannel } from '../modules/agents';
import { enqueueRun } from '../queue';
import { handleWizardMessage, isInWizard } from './commands';
import { postMessage, postBlocks, publishHomeTab, updateMessage, getSlackApp } from './index';
import { detectCritique } from '../modules/self-improvement';
import { parseModelOverride, stripModelOverride } from '../modules/model-selection';
import { checkMessageRelevance } from '../modules/agents/goal-analyzer';
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

      // Check if agent is @mentioned (always respond to mentions)
      let botUserId: string | null = null;
      try {
        const authResult = await getSlackApp().client.auth.test();
        botUserId = authResult.user_id as string;
      } catch { /* ignore */ }
      const isMentioned = botUserId ? text.includes(`<@${botUserId}>`) : false;

      // Relevance check: only respond if @mentioned, or message is relevant to agent's goal
      if (!isMentioned) {
        const isRelevant = await checkMessageRelevance(
          cleanInput,
          agent.relevance_keywords,
          agent.system_prompt,
          agent.respond_to_all_messages
        );
        if (!isRelevant) {
          logger.debug('Message skipped — not relevant to agent', { agentId: agent.id, message: cleanInput.slice(0, 50) });
          return;
        }
      }

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

      // Post temporary status message that will be updated with the final output
      const statusTs = await postBlocks(
        channelId,
        [
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: ':hourglass_flowing_sand: Thinking...' },
            ],
          },
        ],
        'Thinking...',
        threadTs,
      );

      // Store the status message ts so the buffer can update it when done
      if (statusTs) {
        const { setStatusMessageTs } = await import('./buffer');
        setStatusMessageTs(channelId, threadTs, statusTs);
      }

      await enqueueRun(jobData, 'high');

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
      try {
        cloneRepo(parsed.owner, parsed.repo, repoDir, parsed.branch);
      } catch (err: any) {
        logger.error('Initial clone failed', { error: err.message });
      }
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
      addAgentAdmin(agent.id, adminMatch[1], 'admin', userId);
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

  // "create a tool that..." — AI-powered tool authoring with sandbox testing
  const createToolMatch = lower.match(/^(?:create|write|build|make)\s+(?:a\s+)?tool\s+(?:that|to|for|which)\s+(.+)/);
  if (createToolMatch) {
    try {
      const { authorTool } = await import('../modules/self-authoring');
      await postMessage(
        channelId,
        ':hammer_and_wrench: Generating tool implementation...',
        threadTs, agent.name, agent.avatar_emoji,
      );

      const result = await authorTool(agent.id, createToolMatch[1]);
      const testLine = result.testResult
        ? `\nSandbox test: ${result.testResult.passed ? 'PASSED' : 'FAILED'} (${result.testResult.durationMs}ms)`
        : '\nSandbox test: skipped';
      const statusMsg = result.requiresApproval
        ? '\n:warning: Requires admin approval. Say `approve tool ' + result.tool.name + '`'
        : '\n:white_check_mark: Auto-approved and ready to use.';

      await postMessage(
        channelId,
        `:hammer_and_wrench: Tool *${result.tool.name}* created!\n` +
        `Language: \`${result.tool.language}\` | ${result.code.split('\n').length} lines | stored in DB` +
        testLine + statusMsg,
        threadTs, agent.name, agent.avatar_emoji,
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
      await postMessage(channelId, ':brain: Generating skill template...', threadTs, agent.name, agent.avatar_emoji);

      const skill = await authorSkill(agent.id, createSkillMatch[1]);
      const statusMsg = skill.approved ? ':white_check_mark: Ready to use.' : ':warning: Requires admin approval.';

      await postMessage(
        channelId,
        `:jigsaw: Skill *${skill.name}* authored!\n${skill.description}\n` +
        `\`\`\`${skill.template.slice(0, 300)}${skill.template.length > 300 ? '...' : ''}\`\`\`\n${statusMsg}`,
        threadTs, agent.name, agent.avatar_emoji,
      );
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: Skill creation failed: ${err.message}`, threadTs);
      return true;
    }
  }

  // "approve tool <name>" — admin approval
  const approveToolMatch = lower.match(/^approve\s+tool\s+([\w-]+)/);
  if (approveToolMatch) {
    try {
      const { approveCustomTool } = await import('../modules/tools');
      approveCustomTool(approveToolMatch[1], userId);
      await postMessage(channelId, `:white_check_mark: Tool *${approveToolMatch[1]}* approved.`, threadTs);
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "share tool <name> with @agent" — cross-agent tool sharing
  const shareToolMatch = lower.match(/^share\s+tool\s+([\w-]+)\s+with\s+([\w-]+)/);
  if (shareToolMatch) {
    try {
      const { shareToolWithAgent } = await import('../modules/self-authoring');
      shareToolWithAgent(shareToolMatch[1], agent.id, shareToolMatch[2]);
      await postMessage(channelId, `:handshake: Tool *${shareToolMatch[1]}* shared with *${shareToolMatch[2]}*.`, threadTs);
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "rollback tool <name> to version <n>"
  const rollbackMatch = lower.match(/^rollback\s+tool\s+([\w-]+)\s+(?:to\s+)?(?:v(?:ersion)?\s*)?(\d+)/);
  if (rollbackMatch) {
    try {
      const { rollbackTool } = await import('../modules/self-authoring');
      rollbackTool(rollbackMatch[1], parseInt(rollbackMatch[2], 10), userId);
      await postMessage(channelId, `:rewind: Tool *${rollbackMatch[1]}* rolled back to version ${rollbackMatch[2]}.`, threadTs);
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "tool stats" / "tool analytics"
  if (lower === 'tool stats' || lower === 'tool analytics') {
    try {
      const { getAllToolAnalytics } = await import('../modules/self-authoring');
      const analytics = getAllToolAnalytics(agent.id);
      if (analytics.length === 0) {
        await postMessage(channelId, ':bar_chart: No tool usage data yet.', threadTs);
        return true;
      }
      const lines = [':bar_chart: *Tool Analytics*', ''];
      for (const a of analytics) {
        const pct = (a.successRate * 100).toFixed(0);
        lines.push(`*${a.toolName}*: ${a.totalRuns} runs, ${pct}% success, avg ${a.avgDurationMs}ms${a.lastError ? ` | last error: ${a.lastError.slice(0, 80)}` : ''}`);
      }
      await postMessage(channelId, lines.join('\n'), threadTs);
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "tool versions <name>"
  const versionsMatch = lower.match(/^tool\s+versions?\s+([\w-]+)/);
  if (versionsMatch) {
    try {
      const { getToolVersions } = await import('../modules/self-authoring');
      const versions = getToolVersions(versionsMatch[1]);
      if (versions.length === 0) {
        await postMessage(channelId, `:file_folder: No version history for *${versionsMatch[1]}*.`, threadTs);
        return true;
      }
      const lines = [`:file_folder: *Versions for ${versionsMatch[1]}*`, ''];
      for (const v of versions) {
        lines.push(`v${v.version} — ${v.created_at} by ${v.changed_by}`);
      }
      await postMessage(channelId, lines.join('\n'), threadTs);
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }

  // "find tool <query>" — semantic tool discovery
  const findToolMatch = lower.match(/^(?:find|search|discover)\s+tool(?:s)?\s+(.+)/);
  if (findToolMatch) {
    try {
      const { discoverTools } = await import('../modules/self-authoring');
      const tools = discoverTools(findToolMatch[1]);
      if (tools.length === 0) {
        await postMessage(channelId, `:mag: No tools found matching "${findToolMatch[1]}".`, threadTs);
        return true;
      }
      const lines = [`:mag: *Tools matching "${findToolMatch[1]}"*`, ''];
      for (const t of tools) {
        lines.push(`*${t.name}* (\`${t.language}\`) ${t.approved ? '' : '[pending]'} — by ${t.registered_by.slice(0, 8)}`);
      }
      await postMessage(channelId, lines.join('\n'), threadTs);
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
      const { getAuthoredSkills, getMcpConfigs, getCodeArtifacts } = await import('../modules/self-authoring');

      const summary = getAgentToolSummary(agent.id);
      const authored = getAuthoredSkills(agent.id);
      const mcpConfigs = getMcpConfigs(agent.id);
      const artifacts = getCodeArtifacts(agent.id);

      const lines = [
        `:toolbox: *Capabilities for ${agent.name}*`,
        `Built-in tools: ${summary.builtin.join(', ') || 'none'}`,
        `Custom tools: ${summary.custom.join(', ') || 'none'}`,
        `MCP integrations: ${summary.mcp.join(', ') || 'none'}`,
      ];

      if (mcpConfigs.length > 0) {
        lines.push(`DB MCP configs: ${mcpConfigs.map(m => `${m.name}${m.approved ? '' : ' (pending)'}`).join(', ')}`);
      }
      if (authored.length > 0) {
        lines.push(`Authored skills: ${authored.map(s => `${s.name}${s.approved ? '' : ' (pending)'}`).join(', ')}`);
      }
      if (artifacts.length > 0) {
        lines.push(`Code artifacts: ${artifacts.length} files (v${Math.max(...artifacts.map(a => a.version))} latest)`);
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
