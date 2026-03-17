import type { App } from '@slack/bolt';
import { v4 as uuid } from 'uuid';
import { getAgentByChannel, getAgentsByChannel, canAccessAgent, getDmConversation, touchDmConversation, createDmConversation, getAccessibleAgents } from '../modules/agents';
import { enqueueRun } from '../queue';
import { handleWizardMessage, isInWizard, handleConversationReply } from './commands';
import { postMessage, postBlocks, publishHomeTab, updateMessage, getSlackApp, getThreadHistory } from './index';
import { detectCritique } from '../modules/self-improvement';
import { parseModelOverride, stripModelOverride } from '../modules/model-selection';
import { checkMessageRelevance } from '../modules/agents/goal-analyzer';
import { findSlackChannelTriggers, fireTrigger } from '../modules/triggers';
import { buildDashboardBlocks } from '../modules/dashboard';
import { initSuperadmin } from '../modules/access-control';
import { queryOne } from '../db';
import type { JobData, ModelAlias } from '../types';
import { logger } from '../utils/logger';

// ── Slack Event Buffer for Rate Limiting ──

const EVENT_BUFFER_INTERVAL_MS = 1500;

// Cache our own bot user ID so we only ignore our own messages, not other bots
let ownBotUserId: string | null = null;
let ownBotId: string | null = null;

async function getOwnBotIdentity(): Promise<void> {
  if (ownBotUserId) return;
  try {
    const authResult = await getSlackApp().client.auth.test();
    ownBotUserId = authResult.user_id as string;
    ownBotId = authResult.bot_id as string || null;
  } catch { /* will retry next message */ }
}

export function registerEvents(app: App): void {
  // ── Message Events ──
  app.event('message', async ({ event, client }) => {
    try {
    const msg = event as any;

    logger.info('Message event received', {
      channel: msg.channel,
      user: msg.user,
      subtype: msg.subtype,
      thread_ts: msg.thread_ts,
      ts: msg.ts,
      bot_id: msg.bot_id,
      textPreview: (msg.text || '').slice(0, 60),
    });

    // Skip non-message subtypes (message_changed, message_deleted, etc.)
    // but allow bot_message and undefined subtype (normal messages)
    if (msg.subtype && msg.subtype !== 'bot_message') {
      logger.info('Skipping message — subtype filtered', { subtype: msg.subtype });
      return;
    }

    // Ignore our own bot's messages to prevent infinite loops
    await getOwnBotIdentity();
    if (
      (msg.bot_id && msg.bot_id === ownBotId) ||
      (ownBotUserId && msg.user === ownBotUserId)
    ) {
      logger.info('Skipping own bot message', { bot_id: msg.bot_id, user: msg.user, ownBotId, ownBotUserId });
      return;
    }

    // Skip messages with no identifiable sender (system/webhook messages)
    if (!msg.user && !msg.bot_id) {
      logger.info('Skipping message — no user or bot_id', { subtype: msg.subtype, ts: msg.ts });
      return;
    }

    const channelId = msg.channel;
    const userId = msg.user || msg.bot_id; // bot messages may not have user
    const text = msg.text || '';
    const threadTs = msg.thread_ts || msg.ts;

    // Check if user is in creation wizard
    if (isInWizard(userId, channelId)) {
      logger.info('Message handled by wizard', { userId, channelId });
      const response = await handleWizardMessage(userId, channelId, text);
      if (response) {
        await postMessage(channelId, response, threadTs);
      }
      return;
    }

    // Check if this is a thread reply to a conversational /new-agent or /update-agent flow
    if (msg.thread_ts) {
      try {
        const handled = await handleConversationReply(userId, channelId, msg.thread_ts, text);
        if (handled) {
          logger.info('Thread reply handled by conversation flow', { threadTs: msg.thread_ts });
          return;
        }
      } catch (err: any) {
        logger.error('handleConversationReply threw', { threadTs: msg.thread_ts, error: err.message, stack: err.stack });
        // Tell the user something went wrong instead of silently dropping
        try {
          await postMessage(channelId, `:x: Something went wrong processing your reply. Please try again.`, msg.thread_ts);
        } catch { /* best effort */ }
        return;
      }

      // Check if this thread belongs to a wizard/conversation flow (even if this user isn't the flow owner)
      // This prevents agents from processing messages in wizard threads
      try {
        const wizardThread = await queryOne<{ id: string }>(
          `SELECT id FROM pending_confirmations WHERE data->>'type' = 'conversation' AND data->>'threadTs' = $1 AND expires_at > NOW() LIMIT 1`,
          [msg.thread_ts],
        );
        if (wizardThread) {
          logger.info('Thread reply in active wizard thread — skipping agent processing', { threadTs: msg.thread_ts });
          return;
        }
      } catch {
        // DB check failed — fall through to normal agent handling
      }

      logger.info('Thread reply — continuing to agent check', { threadTs: msg.thread_ts, channelId });
    }

    // Check if message is in an agent channel (supports multiple agents per channel)
    const allAgents = await getAgentsByChannel(channelId);
    // Filter out private agents the user doesn't have access to
    const agentAccessResults = await Promise.all(
      allAgents.map(async (a) => {
        if (a.visibility !== 'private') return true;
        return canAccessAgent(a.id, userId);
      })
    );
    const agents = allAgents.filter((_, i) => agentAccessResults[i]);
    logger.info('Agent lookup result', { channelId, agentCount: agents.length, totalInChannel: allAgents.length, agentNames: agents.map(a => a.name) });

    // Check if agent is @mentioned (always respond to mentions)
    const isMentioned = ownBotUserId ? text.includes(`<@${ownBotUserId}>`) : false;
    // Thread replies are always relevant — the user is continuing a conversation
    const isThreadReply = !!msg.thread_ts;

    // No agents in channel but bot is @mentioned — helpful message
    if (agents.length === 0 && isMentioned) {
      await postMessage(
        channelId,
        `👋 I'm here, but no agents are assigned to this channel yet.\n\nUse \`/agents\` to see available agents, or \`/new-agent\` to create one and add it to this channel.`,
        threadTs,
      );
      return;
    }

    if (agents.length > 0) {
      // Handle interactive agent-channel commands (use first agent for channel-level commands)
      const interactiveResult = await handleAgentChannelCommand(text, agents[0], channelId, userId, threadTs);
      if (interactiveResult) return;

      // Check for model override
      const modelOverride = parseModelOverride(text);
      const cleanInput = modelOverride ? stripModelOverride(text) : text;

      // @mention with multiple agents: show picker (like DM flow)
      if (isMentioned && agents.length > 1) {
        const relevanceResults = await Promise.all(
          agents.map(async (agent) => {
            try {
              const isRelevant = await checkMessageRelevance(
                cleanInput, agent.relevance_keywords, agent.system_prompt, agent.respond_to_all_messages
              );
              return { agent, relevant: isRelevant };
            } catch {
              return { agent, relevant: false };
            }
          })
        );

        const matches = relevanceResults.filter(r => r.relevant);

        if (matches.length === 1) {
          // Single relevance match — process just that agent
          const agent = matches[0].agent;
          await enqueueAgentRun(agent, cleanInput, channelId, threadTs, userId, modelOverride, msg, isThreadReply);
          return;
        }

        // Zero or multiple matches — show picker
        const agentsToShow = matches.length > 1 ? matches.map(m => m.agent) : agents;
        const buttons = agentsToShow.map(a => ({
          type: 'button' as const,
          text: { type: 'plain_text' as const, text: `${a.avatar_emoji} ${a.name}`.slice(0, 75) },
          action_id: `channel_pick_agent:${a.id}`,
          value: JSON.stringify({ agentId: a.id, originalText: text.slice(0, 2000), channelId, threadTs }),
        }));

        await postBlocks(channelId, [
          { type: 'section', text: { type: 'mrkdwn', text: '*Which agent should handle this?*' } },
          { type: 'actions', elements: buttons },
        ], 'Pick an agent', threadTs);
        return;
      }

      // Process each agent in the channel
      for (const agent of agents) {
        // mentions_only agents only respond to @mentions and thread replies
        if (agent.mentions_only && !isMentioned && !isThreadReply) {
          logger.debug('Message skipped — agent is mentions-only', { agentId: agent.id });
          continue;
        }

        // Relevance check: skip for @mentions, thread replies, and mentions-only agents
        if (!isMentioned && !isThreadReply && !agent.mentions_only) {
          const isRelevant = await checkMessageRelevance(
            cleanInput,
            agent.relevance_keywords,
            agent.system_prompt,
            agent.respond_to_all_messages
          );
          if (!isRelevant) {
            logger.debug('Message skipped — not relevant to agent', { agentId: agent.id, message: cleanInput.slice(0, 50) });
            continue;
          }
        }

        // Check if this is critique (in-thread reply)
        if (msg.thread_ts && detectCritique(cleanInput)) {
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
          continue;
        }

        // Normal agent task — enqueue
        const traceId = uuid();

        // For thread replies, fetch conversation history so the agent has context
        let inputWithContext = cleanInput;
        if (isThreadReply) {
          const history = await getThreadHistory(channelId, threadTs);
          if (history) {
            inputWithContext = `<conversation_history>\n${history}\n</conversation_history>\n\n<current_message>\n${cleanInput}\n</current_message>`;
          }
        }

        const jobData: JobData = {
          agentId: agent.id,
          channelId,
          threadTs,
          input: inputWithContext,
          userId,
          traceId,
          modelOverride: modelOverride || undefined,
        };

        // Post temporary status message with agent identity
        const statusTs = await postBlocks(
          channelId,
          [
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `✋ On it...` },
              ],
            },
          ],
          `${agent.name} is adjusting its grip...`,
          threadTs,
          agent.name,
          agent.avatar_emoji,
        );

        // Pass status message TS through job data so the worker can delete it
        if (statusTs) {
          jobData.statusMessageTs = statusTs;
        }

        await enqueueRun(jobData, 'high');

        logger.info('Task enqueued from Slack', {
          agentId: agent.id,
          traceId,
          userId,
          model: modelOverride || agent.model,
        });
      }
      return;
    }

    // ── DM handling (superadmin commands + agent routing) ──
    if (msg.channel_type === 'im') {
      await initSuperadmin(userId);

      // Handle superadmin commands via DM
      const lower = text.toLowerCase();
      if (lower.startsWith('add ') && lower.includes('as superadmin')) {
        const { addSuperadmin } = await import('../modules/access-control');
        const match = text.match(/add\s+<@(\w+)>\s+as\s+superadmin/i);
        if (match) {
          try {
            await addSuperadmin(match[1], userId);
            await postMessage(channelId, `:white_check_mark: <@${match[1]}> added as superadmin`);
          } catch (err: any) {
            await postMessage(channelId, `:x: ${err.message}`);
          }
          return;
        }
      }

      // Thread reply: route to existing DM conversation
      if (msg.thread_ts) {
        const dmConv = await getDmConversation(channelId, msg.thread_ts);
        if (dmConv) {
          const { getAgent } = await import('../modules/agents');
          const agent = await getAgent(dmConv.agent_id);
          if (agent && agent.status === 'active') {
            await touchDmConversation(channelId, msg.thread_ts);
            await routeDmToAgent(agent, text, userId, channelId, msg.thread_ts);
            return;
          }
        }
        // Expired DM thread
        logger.info('DM thread reply not handled by any flow', { threadTs: msg.thread_ts, channelId, userId });
        await postMessage(channelId, `This conversation has expired or was already completed. Please use \`/agents\` to start a new update.`, msg.thread_ts);
        return;
      }

      // Skip bot messages in DMs — only real user messages should be routed to agents
      if (msg.bot_id || msg.subtype === 'bot_message') {
        logger.info('Skipping bot message in DM — not routing to agents', { bot_id: msg.bot_id, subtype: msg.subtype });
        return;
      }

      // New DM message: smart-route to an agent
      try {
        const accessible = await getAccessibleAgents(userId);
        const activeAgents = accessible.filter(a => a.status === 'active');

        if (activeAgents.length === 0) {
          await postMessage(channelId, `No agents available. Use \`/new-agent\` to create one.`);
          return;
        }

        if (activeAgents.length === 1) {
          const agent = activeAgents[0];
          const statusTs = await postBlocks(
            channelId,
            [{ type: 'context', elements: [{ type: 'mrkdwn', text: `${agent.avatar_emoji} *${agent.name}* is on it...` }] }],
            `${agent.name} is on it...`,
          );
          const replyThreadTs = statusTs || msg.ts;
          await createDmConversation(userId, agent.id, channelId, replyThreadTs);
          await routeDmToAgent(agent, text, userId, channelId, replyThreadTs);
          return;
        }

        // Multiple agents: run relevance check
        const relevanceResults = await Promise.all(
          activeAgents.map(async (agent) => {
            try {
              const isRelevant = await checkMessageRelevance(
                text, agent.relevance_keywords, agent.system_prompt, agent.respond_to_all_messages
              );
              return { agent, relevant: isRelevant };
            } catch {
              return { agent, relevant: false };
            }
          })
        );

        const matches = relevanceResults.filter(r => r.relevant);

        if (matches.length === 1) {
          const agent = matches[0].agent;
          const statusTs = await postBlocks(
            channelId,
            [{ type: 'context', elements: [{ type: 'mrkdwn', text: `${agent.avatar_emoji} *${agent.name}* is on it...` }] }],
            `${agent.name} is on it...`,
          );
          const replyThreadTs = statusTs || msg.ts;
          await createDmConversation(userId, agent.id, channelId, replyThreadTs);
          await routeDmToAgent(agent, text, userId, channelId, replyThreadTs);
          return;
        }

        // Zero or multiple matches — show picker
        const agentsToShow = matches.length > 1 ? matches.map(m => m.agent) : activeAgents.slice(0, 10);
        const buttons = agentsToShow.map(a => ({
          type: 'button',
          text: { type: 'plain_text', text: `${a.avatar_emoji} ${a.name}`.slice(0, 75) },
          action_id: `dm_pick_agent:${a.id}`,
          value: JSON.stringify({ agentId: a.id, originalText: text.slice(0, 2000), dmChannelId: channelId }),
        }));

        await postBlocks(channelId, [
          { type: 'section', text: { type: 'mrkdwn', text: '*Which agent should handle this?*' } },
          { type: 'actions', elements: buttons },
        ], 'Pick an agent');

      } catch (err: any) {
        logger.error('DM agent routing failed', { error: err.message, userId });
        await postMessage(channelId, `:x: Something went wrong. Try again or use \`/agents\`.`);
      }
      return;
    }

    // Check for Slack channel triggers
    const triggers = await findSlackChannelTriggers(channelId);
    for (const trigger of triggers) {
      await fireTrigger({
        triggerId: trigger.id,
        idempotencyKey: `slack:${channelId}:${msg.ts}`,
        payload: { text, user: userId, channel: channelId, ts: msg.ts },
        sourceChannel: channelId,
        sourceThreadTs: threadTs,
      });
    }
    } catch (err: any) {
      logger.error('Unhandled error in message handler', { error: err.message, stack: err.stack });
    }
  });

  // ── File Upload for KB ──
  app.event('file_shared' as any, async ({ event }: any) => {
    const channelId = event.channel_id;
    const agent = await getAgentByChannel(channelId);
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

  // (DM handling is consolidated into the main message handler above)

  // ── DM Agent Picker ──
  app.action(/^dm_pick_agent:/, async ({ action, ack, body }: any) => {
    await ack();
    try {
      const payload = JSON.parse(action.value);
      const { agentId, originalText, dmChannelId } = payload;
      const userId = body.user.id;

      const { getAgent } = await import('../modules/agents');
      const agent = await getAgent(agentId);
      if (!agent || agent.status !== 'active') {
        await postMessage(dmChannelId, ':x: Agent not available.');
        return;
      }

      const statusTs = await postBlocks(
        dmChannelId,
        [{ type: 'context', elements: [{ type: 'mrkdwn', text: `${agent.avatar_emoji} *${agent.name}* is on it...` }] }],
        `${agent.name} is on it...`,
      );
      const replyThreadTs = statusTs || body.message?.ts || Date.now().toString();
      await createDmConversation(userId, agentId, dmChannelId, replyThreadTs);
      await routeDmToAgent(agent, originalText, userId, dmChannelId, replyThreadTs);
    } catch (err: any) {
      logger.error('DM agent pick failed', { error: err.message });
    }
  });

  // ── Channel Agent Picker ──
  app.action(/^channel_pick_agent:/, async ({ action, ack, body }: any) => {
    await ack();
    try {
      const payload = JSON.parse(action.value);
      const { agentId, originalText, channelId, threadTs } = payload;
      const userId = body.user.id;

      const { getAgent } = await import('../modules/agents');
      const agent = await getAgent(agentId);
      if (!agent || agent.status !== 'active') {
        await postMessage(channelId, ':x: Agent not available.', threadTs);
        return;
      }

      // Check for model override
      const modelOverride = parseModelOverride(originalText);
      const cleanInput = modelOverride ? stripModelOverride(originalText) : originalText;

      const traceId = uuid();

      // For thread replies, fetch conversation history
      let inputWithContext = cleanInput;
      const isThreadReply = !!body.message?.thread_ts;
      if (isThreadReply) {
        const history = await getThreadHistory(channelId, threadTs);
        if (history) {
          inputWithContext = `<conversation_history>\n${history}\n</conversation_history>\n\n<current_message>\n${cleanInput}\n</current_message>`;
        }
      }

      const jobData: JobData = {
        agentId: agent.id,
        channelId,
        threadTs,
        input: inputWithContext,
        userId,
        traceId,
        modelOverride: modelOverride || undefined,
      };

      const statusTs = await postBlocks(
        channelId,
        [{ type: 'context', elements: [{ type: 'mrkdwn', text: `✋ On it...` }] }],
        `${agent.name} is adjusting its grip...`,
        threadTs,
        agent.name,
        agent.avatar_emoji,
      );

      if (statusTs) {
        jobData.statusMessageTs = statusTs;
      }

      await enqueueRun(jobData, 'high');
      logger.info('Channel pick: task enqueued', { agentId: agent.id, traceId, userId });
    } catch (err: any) {
      logger.error('Channel agent pick failed', { error: err.message });
    }
  });

  // ── App Home Opened ──
  app.event('app_home_opened', async ({ event }) => {
    const blocks = await buildDashboardBlocks();
    await publishHomeTab(event.user, blocks);
  });
}

// ── Channel Agent Enqueue Helper ──

async function enqueueAgentRun(
  agent: any,
  cleanInput: string,
  channelId: string,
  threadTs: string,
  userId: string,
  modelOverride: ModelAlias | null,
  msg: any,
  isThreadReply: boolean,
): Promise<void> {
  const traceId = uuid();

  // For thread replies, fetch conversation history so the agent has context
  let inputWithContext = cleanInput;
  if (isThreadReply) {
    const history = await getThreadHistory(channelId, threadTs);
    if (history) {
      inputWithContext = `<conversation_history>\n${history}\n</conversation_history>\n\n<current_message>\n${cleanInput}\n</current_message>`;
    }
  }

  const jobData: JobData = {
    agentId: agent.id,
    channelId,
    threadTs,
    input: inputWithContext,
    userId,
    traceId,
    modelOverride: modelOverride || undefined,
  };

  // Post temporary status message with agent identity
  const statusTs = await postBlocks(
    channelId,
    [
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `✋ On it...` },
        ],
      },
    ],
    `${agent.name} is adjusting its grip...`,
    threadTs,
    agent.name,
    agent.avatar_emoji,
  );

  // Pass status message TS through job data so the worker can delete it
  if (statusTs) {
    jobData.statusMessageTs = statusTs;
  }

  await enqueueRun(jobData, 'high');

  logger.info('Task enqueued from Slack', {
    agentId: agent.id,
    traceId,
    userId,
    model: modelOverride || agent.model,
  });
}

// ── DM-to-Agent Routing ──

async function routeDmToAgent(agent: any, text: string, userId: string, dmChannelId: string, threadTs: string): Promise<void> {
  const traceId = uuid();

  // Fetch thread history for context in follow-up messages
  let inputWithContext = text;
  const history = await getThreadHistory(dmChannelId, threadTs);
  if (history) {
    inputWithContext = `<conversation_history>\n${history}\n</conversation_history>\n\n<current_message>\n${text}\n</current_message>`;
  }

  const jobData: JobData = {
    agentId: agent.id,
    channelId: dmChannelId,
    threadTs,
    input: inputWithContext,
    userId,
    traceId,
  };

  const { setStatusMessageTs } = await import('./buffer');
  const { bufferEvent } = await import('./buffer');

  const statusTs = await postBlocks(
    dmChannelId,
    [{ type: 'context', elements: [{ type: 'mrkdwn', text: `✋ On it...` }] }],
    `${agent.name} is adjusting its grip...`,
    threadTs,
    agent.name,
    agent.avatar_emoji,
  );

  if (statusTs) {
    jobData.statusMessageTs = statusTs;
  }

  await enqueueRun(jobData, 'high');

  logger.info('DM task enqueued', { agentId: agent.id, traceId, userId });
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
      const source = await connectSource({
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
      const repoDir = `/tmp/tinyhands-sources-cache/${agent.id}/${source.id}`;
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
      const source = await connectSource({
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

      const trigger = await createTrigger({
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

      const agentSkill = await attachSkillToAgent(agent.id, skillName, permLevel, userId);
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

  // "add member @user" / "remove member @user"
  const addMemberMatch = text.match(/^add\s+member\s+<@(\w+)>/i);
  if (addMemberMatch) {
    try {
      const { canModifyAgent } = await import('../modules/access-control');
      if (!(await canModifyAgent(agent.id, userId))) {
        await postMessage(channelId, ':x: You don\'t have permission to manage members.', threadTs);
        return true;
      }
      const { addAgentMember } = await import('../modules/agents');
      await addAgentMember(agent.id, addMemberMatch[1], userId);
      await postMessage(channelId, `:white_check_mark: <@${addMemberMatch[1]}> added as a member of *${agent.name}*`, threadTs);
      return true;
    } catch (err: any) {
      await postMessage(channelId, `:x: ${err.message}`, threadTs);
      return true;
    }
  }
  const removeMemberMatch = text.match(/^remove\s+member\s+<@(\w+)>/i);
  if (removeMemberMatch) {
    try {
      const { canModifyAgent } = await import('../modules/access-control');
      if (!(await canModifyAgent(agent.id, userId))) {
        await postMessage(channelId, ':x: You don\'t have permission to manage members.', threadTs);
        return true;
      }
      const { removeAgentMember } = await import('../modules/agents');
      await removeAgentMember(agent.id, removeMemberMatch[1]);
      await postMessage(channelId, `:white_check_mark: <@${removeMemberMatch[1]}> removed from *${agent.name}*`, threadTs);
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
      await addAgentAdmin(agent.id, adminMatch[1], 'admin', userId);
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
      const count = await forgetMemory(agent.id, forgetMatch[1]);
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

  // "create a tool that..." — redirect to feature request (tools are admin-only)
  const createToolMatch = lower.match(/^(?:create|write|build|make)\s+(?:a\s+)?tool\s+(?:that|to|for|which)\s+(.+)/);
  if (createToolMatch) {
    await postMessage(
      channelId,
      ':lock: Tool creation is admin-only. Use `/new-agent` to describe what you need — if a new tool is required, it will be sent as a request to an admin.',
      threadTs, agent.name, agent.avatar_emoji,
    );
    return true;
  }

  // "create a skill that..." — redirect to feature request (skills are admin-only)
  const createSkillMatch = lower.match(/^(?:create|write|build|make)\s+(?:a\s+)?skill\s+(?:that|to|for|which)\s+(.+)/);
  if (createSkillMatch) {
    await postMessage(
      channelId,
      ':lock: Skill creation is admin-only. Use `/new-agent` to describe what you need — if a new skill is required, it will be sent as a request to an admin.',
      threadTs, agent.name, agent.avatar_emoji,
    );
    return true;
  }

  // "approve tool <name>" — admin approval
  const approveToolMatch = lower.match(/^approve\s+tool\s+([\w-]+)/);
  if (approveToolMatch) {
    try {
      const { approveCustomTool } = await import('../modules/tools');
      await approveCustomTool(approveToolMatch[1], userId);
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
      await shareToolWithAgent(shareToolMatch[1], agent.id, shareToolMatch[2]);
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
      await rollbackTool(rollbackMatch[1], parseInt(rollbackMatch[2], 10), userId);
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
      const analytics = await getAllToolAnalytics(agent.id);
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
      const versions = await getToolVersions(versionsMatch[1]);
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
      const tools = await discoverTools(findToolMatch[1]);
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

      const summary = await getAgentToolSummary(agent.id);
      const authored = await getAuthoredSkills(agent.id);
      const mcpConfigs = await getMcpConfigs(agent.id);
      const artifacts = await getCodeArtifacts(agent.id);

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
