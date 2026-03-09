import { App, LogLevel } from '@slack/bolt';
import { config } from '../config';
import { registerCommands, registerModalHandlers, registerConfirmationActions, registerInlineActions } from './commands';
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

export async function createChannel(name: string): Promise<string> {
  const client = getSlackApp().client;
  const result = await client.conversations.create({
    name: `agent-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`,
    is_private: false,
  });
  return result.channel?.id || '';
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
