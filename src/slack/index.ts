import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { AsyncLocalStorage } from 'async_hooks';
import { config } from '../config';
import { getWorkspace } from '../db';
import { registerModalHandlers, registerConfirmationActions, registerInlineActions, registerToolAndKBModals } from './commands';
import { registerEvents } from './events';
import { registerActions } from './actions';
import { logger } from '../utils/logger';

// Per-event workspace context. Bolt's middleware wraps each handler in a run,
// so any helper called below (postMessage, postBlocks, …) picks up the right
// workspace-scoped WebClient automatically. Workers/sync/scheduler don't set
// this context and fall through to getSystemSlackClient() (env token).
interface SlackCtx {
  workspaceId?: string;
  client: WebClient;
}
const slackCtxStore = new AsyncLocalStorage<SlackCtx>();

export function runInSlackContext<T>(ctx: SlackCtx, fn: () => Promise<T> | T): Promise<T> | T {
  return slackCtxStore.run(ctx, fn);
}

function resolveClient(): WebClient {
  const ctx = slackCtxStore.getStore();
  if (ctx?.client) return ctx.client;
  return getSystemSlackClient();
}

let app: App;

// Multi-tenant authorize callback. Bolt invokes this for every incoming event
// and uses the returned botToken to construct the WebClient passed to handlers
// in their ctx.client, so per-workspace events respond with the correct bot.
async function authorize({ teamId }: { teamId?: string }): Promise<{ botToken: string; botUserId?: string; botId?: string; teamId?: string }> {
  if (!teamId) {
    // No team context — very rare, fall back to env token
    if (!config.slack.botToken) {
      throw new Error('No teamId on incoming event and no fallback SLACK_BOT_TOKEN');
    }
    return { botToken: config.slack.botToken };
  }
  const ws = await getWorkspace(teamId);
  if (ws?.bot_token && ws.status === 'active') {
    return {
      botToken: ws.bot_token,
      botUserId: ws.bot_user_id,
      botId: ws.bot_id ?? undefined,
      teamId,
    };
  }
  // Fallback: workspace not in DB yet (shouldn't happen once OAuth install ran)
  if (config.slack.botToken) {
    logger.warn('authorize: workspace missing from DB, falling back to env token', { teamId });
    return { botToken: config.slack.botToken };
  }
  throw new Error(`No bot token available for workspace ${teamId}`);
}

/**
 * Create a full Slack app with Socket Mode (events, commands, actions).
 * Only the LISTENER process should use this. Uses `authorize` for per-workspace
 * bot token lookup so events from any installed workspace route correctly.
 */
export function createSlackApp(): App {
  app = new App({
    authorize,
    appToken: config.slack.appToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  // Middleware: wrap every incoming event in an AsyncLocalStorage run so
  // downstream helpers (postMessage, postBlocks, …) automatically use the
  // authorize'd per-workspace WebClient instead of a hardcoded one.
  app.use(async ({ client, context, next }) => {
    await runInSlackContext({ workspaceId: context.teamId, client: client as WebClient }, async () => {
      await next();
    });
  });

  // Global error handler — catch any unhandled errors in event/action handlers
  app.error(async (error) => {
    logger.error('Bolt global error handler', { error: String(error), message: (error as any)?.message, stack: (error as any)?.stack });
  });

  registerModalHandlers(app);
  registerConfirmationActions(app);
  registerInlineActions(app);
  registerToolAndKBModals(app);
  registerEvents(app);
  registerActions(app);

  return app;
}

/**
 * Initialize the Slack app WITHOUT starting Socket Mode.
 * Workers and sync processes should call this to get the Web API client
 * without opening extra WebSocket connections.
 */
export function initSlackClient(): void {
  if (app) return; // already initialized
  app = new App({
    authorize,
    appToken: config.slack.appToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });
  // Don't call app.start() — we only need the Web API client
}

export function getSlackApp(): App {
  if (!app) throw new Error('Slack app not initialized');
  return app;
}

// ── Workspace-scoped Slack clients ──
// With `authorize` in Bolt, `app.client` has no default token — every call must
// pass `{ token }` explicitly. These helpers resolve the right bot token per
// workspace. Use `getBotClient(workspaceId)` for workspace-scoped calls; use
// `getSystemSlackClient()` only for boot-time verification where the env token
// is the right authority (auth.test at process startup).

const botClientCache = new Map<string, { client: WebClient; token: string }>();

export async function getBotClient(workspaceId: string): Promise<WebClient> {
  const ws = await getWorkspace(workspaceId);
  if (!ws?.bot_token) throw new Error(`No bot token for workspace ${workspaceId}`);
  const cached = botClientCache.get(workspaceId);
  if (cached && cached.token === ws.bot_token) return cached.client;
  const client = new WebClient(ws.bot_token);
  botClientCache.set(workspaceId, { client, token: ws.bot_token });
  return client;
}

export function getSystemSlackClient(): WebClient {
  return new WebClient(config.slack.botToken);
}

export async function postMessage(
  channelId: string,
  text: string,
  threadTs?: string,
  username?: string,
  iconEmoji?: string
): Promise<void> {
  const client = resolveClient();
  await client.chat.postMessage({
    channel: channelId,
    text,
    thread_ts: threadTs,
    username,
    icon_emoji: iconEmoji,
  });
}

export async function updateMessage(
  channelId: string,
  ts: string,
  text: string
): Promise<void> {
  const client = resolveClient();
  await client.chat.update({
    channel: channelId,
    ts,
    text,
    blocks: [],
  });
}

export async function deleteMessage(channelId: string, ts: string): Promise<void> {
  const client = resolveClient();
  try {
    await client.chat.delete({ channel: channelId, ts });
  } catch (err: any) {
    if (err.data?.error !== 'message_not_found') throw err;
  }
}

export async function createChannel(name: string): Promise<string> {
  const client = resolveClient();
  const baseName = `tinyhands-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 80);

  // Try the base name first, then add a suffix if taken
  for (let attempt = 0; attempt < 5; attempt++) {
    const channelName = attempt === 0 ? baseName : `${baseName}-${Date.now().toString(36).slice(-4)}`;
    try {
      const result = await client.conversations.create({
        name: channelName,
        is_private: false,
      });
      const channelId = result.channel?.id || '';
      if (channelId) {
        try { await client.conversations.join({ channel: channelId }); } catch { /* already in */ }
      }
      return channelId;
    } catch (err: any) {
      if (err.data?.error === 'name_taken' && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error('Failed to create channel after multiple attempts');
}

export async function postBlocks(
  channelId: string,
  blocks: any[],
  text: string,
  threadTs?: string,
  username?: string,
  iconEmoji?: string,
): Promise<string | undefined> {
  const client = resolveClient();
  const result = await client.chat.postMessage({
    channel: channelId,
    blocks,
    text,
    thread_ts: threadTs,
    username,
    icon_emoji: iconEmoji,
  });
  return result.ts;
}

export async function postEphemeral(
  channelId: string,
  userId: string,
  blocks: any[],
  text: string,
): Promise<void> {
  const client = resolveClient();
  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    blocks,
    text,
  });
}

export async function openModal(triggerId: string, view: any): Promise<void> {
  const client = resolveClient();
  await client.views.open({
    trigger_id: triggerId,
    view,
  });
}

export async function pushModal(triggerId: string, view: any): Promise<void> {
  const client = resolveClient();
  await client.views.push({
    trigger_id: triggerId,
    view,
  });
}

export async function updateModal(viewId: string, view: any): Promise<void> {
  const client = resolveClient();
  await client.views.update({
    view_id: viewId,
    view,
  });
}

export async function publishHomeTab(userId: string, blocks: any[]): Promise<void> {
  const client = resolveClient();
  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      blocks,
    },
  });
}

export async function sendDM(userId: string, text: string, blocks?: any[]): Promise<string | undefined> {
  const client = resolveClient();
  const conv = await client.conversations.open({ users: userId });
  const dmChannelId = conv.channel?.id;
  if (!dmChannelId) return undefined;

  const result = await client.chat.postMessage({
    channel: dmChannelId,
    text,
    blocks,
  });
  return result.ts;
}

export async function sendDMBlocks(userId: string, blocks: any[], text: string): Promise<string | undefined> {
  return sendDM(userId, text, blocks);
}

// Slack errors for channel types that don't support conversations.join
// (Slack Connect, shared external, DMs, group DMs)
const UNJOINABLE_CHANNEL_ERRORS = new Set([
  'already_in_channel',
  'method_not_supported_for_channel_type',
  'channel_type_not_supported',
  'is_archived',
]);

/**
 * Ensure the bot is a member of the given channels so it receives events.
 * Silently skips channel types that don't support joining (Slack Connect, DMs, etc.).
 */
export async function ensureBotInChannels(channelIds: string[]): Promise<void> {
  const client = resolveClient();
  for (const channelId of channelIds) {
    try {
      await client.conversations.join({ channel: channelId });
      logger.info('Bot joined channel', { channelId });
    } catch (err: any) {
      const code = err.data?.error || err.message;
      if (!UNJOINABLE_CHANNEL_ERRORS.has(code)) {
        logger.warn('Could not auto-join channel — invite the bot manually', { channelId, error: code });
      }
    }
  }
}

/**
 * Fetch thread conversation history for context in follow-up messages.
 * Returns messages formatted as a conversation transcript.
 */
export async function getThreadHistory(channelId: string, threadTs: string, limit: number = 20): Promise<string> {
  const client = resolveClient();
  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit,
      inclusive: true,
    });

    if (!result.messages || result.messages.length <= 1) return '';

    // Get our own bot info for labeling
    const authResult = await client.auth.test();
    const botUserId = authResult.user_id;

    // Format messages as conversation, excluding the very latest (that's the current input)
    const history = result.messages.slice(0, -1).map(msg => {
      const isBot = msg.bot_id || msg.user === botUserId;
      const role = isBot ? 'assistant' : 'user';
      const text = msg.text || '';
      return `[${role}]: ${text}`;
    }).join('\n\n');

    return history;
  } catch (err: any) {
    logger.warn('Failed to fetch thread history', { error: err.message, channelId, threadTs });
    return '';
  }
}
