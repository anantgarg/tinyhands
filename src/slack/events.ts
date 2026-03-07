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
