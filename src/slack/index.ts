import { App, LogLevel } from '@slack/bolt';
import { config } from '../config';
import { registerCommands } from './commands';
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
