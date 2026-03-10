import { App, LogLevel } from '@slack/bolt';
import { config } from '../config';
import { registerCommands, registerModalHandlers, registerConfirmationActions, registerInlineActions, registerToolAndKBModals } from './commands';
import { registerEvents } from './events';
import { registerActions } from './actions';
import { logger } from '../utils/logger';

let app: App;

export function createSlackApp(): App {
  app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  registerCommands(app);
  registerModalHandlers(app);
  registerConfirmationActions(app);
  registerInlineActions(app);
  registerToolAndKBModals(app);
  registerEvents(app);
  registerActions(app);

  return app;
}

export function getSlackApp(): App {
  if (!app) throw new Error('Slack app not initialized');
  return app;
}

export async function postMessage(
  channelId: string,
  text: string,
  threadTs?: string,
  username?: string,
  iconEmoji?: string
): Promise<void> {
  const client = getSlackApp().client;
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
  const client = getSlackApp().client;
  await client.chat.update({
    channel: channelId,
    ts,
    text,
  });
}

export async function deleteMessage(channelId: string, ts: string): Promise<void> {
  const client = getSlackApp().client;
  try {
    await client.chat.delete({ channel: channelId, ts });
  } catch (err: any) {
    if (err.data?.error !== 'message_not_found') throw err;
  }
}

export async function createChannel(name: string): Promise<string> {
  const client = getSlackApp().client;
  const channelName = `tinyjobs-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
  try {
    const result = await client.conversations.create({
      name: channelName,
      is_private: false,
    });
    return result.channel?.id || '';
  } catch (err: any) {
    // Channel already exists — find it and join it
    if (err.data?.error === 'name_taken') {
      const list = await client.conversations.list({ types: 'public_channel', limit: 1000 });
      const existing = list.channels?.find(c => c.name === channelName);
      if (existing?.id) {
        try { await client.conversations.join({ channel: existing.id }); } catch { /* already in */ }
        return existing.id;
      }
    }
    throw err;
  }
}

export async function postBlocks(
  channelId: string,
  blocks: any[],
  text: string,
  threadTs?: string,
): Promise<string | undefined> {
  const client = getSlackApp().client;
  const result = await client.chat.postMessage({
    channel: channelId,
    blocks,
    text,
    thread_ts: threadTs,
  });
  return result.ts;
}

export async function openModal(triggerId: string, view: any): Promise<void> {
  const client = getSlackApp().client;
  await client.views.open({
    trigger_id: triggerId,
    view,
  });
}

export async function pushModal(triggerId: string, view: any): Promise<void> {
  const client = getSlackApp().client;
  await client.views.push({
    trigger_id: triggerId,
    view,
  });
}

export async function updateModal(viewId: string, view: any): Promise<void> {
  const client = getSlackApp().client;
  await client.views.update({
    view_id: viewId,
    view,
  });
}

export async function publishHomeTab(userId: string, blocks: any[]): Promise<void> {
  const client = getSlackApp().client;
  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      blocks,
    },
  });
}

export async function sendDM(userId: string, text: string, blocks?: any[]): Promise<string | undefined> {
  const client = getSlackApp().client;
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
