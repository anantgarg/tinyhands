import { createSlackApp } from './slack';
import { startWebhookServer } from './server';
import { initDb, upsertWorkspace, setDefaultWorkspaceId } from './db';
import { config } from './config';
import { logger } from './utils/logger';
import { startWatchdog } from './utils/watchdog';
import { ensureBotInAllAgentChannels } from './modules/agents';

async function main(): Promise<void> {
  logger.info('Starting TinyHands...');

  // Initialize database
  await initDb();
  logger.info('Database initialized');

  // Start Slack app (Socket Mode)
  const app = createSlackApp();
  await app.start();
  logger.info('Slack app started (Socket Mode)');

  // Bootstrap workspace from bot token
  const authResult = await app.client.auth.test();
  await upsertWorkspace({
    id: authResult.team_id as string,
    team_name: (authResult.team as string) || 'default',
    bot_token: config.slack.botToken,
    bot_user_id: authResult.user_id as string,
    bot_id: authResult.bot_id as string,
  });
  setDefaultWorkspaceId(authResult.team_id as string);
  logger.info('Workspace bootstrapped', { workspaceId: authResult.team_id });

  // Ensure bot is a member of all agent channels (for receiving events)
  ensureBotInAllAgentChannels().catch(err =>
    logger.warn('Auto-join agent channels failed', { error: err.message })
  );

  // Register built-in tools (KB, etc.)
  try {
    const { getIntegration } = await import('./modules/tools/integrations');
    const kb = getIntegration('kb');
    if (kb) await kb.register('system', {});
  } catch (err: any) {
    logger.warn('KB tool registration failed', { error: err.message });
  }

  // Start webhook server (Express)
  startWebhookServer();

  // Start event loop watchdog — restarts process if main thread is blocked for >60s
  startWatchdog();

  logger.info('TinyHands listener ready');
}

main().catch(err => {
  logger.error('Failed to start TinyHands', { error: err.message });
  process.exit(1);
});
