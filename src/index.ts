import { createSlackApp } from './slack';
import { startWebhookServer } from './server';
import { initDb } from './db';
import { logger } from './utils/logger';
import { ensureBotInAllAgentChannels } from './modules/agents';

async function main(): Promise<void> {
  logger.info('Starting Tiny Hands...');

  // Initialize database
  await initDb();
  logger.info('Database initialized');

  // Start Slack app (Socket Mode)
  const app = createSlackApp();
  await app.start();
  logger.info('Slack app started (Socket Mode)');

  // Ensure bot is a member of all agent channels (for receiving events)
  ensureBotInAllAgentChannels().catch(err =>
    logger.warn('Auto-join agent channels failed', { error: err.message })
  );

  // Register built-in tools (KB, etc.)
  try {
    const { registerKBTools } = await import('./modules/tools/kb');
    await registerKBTools();
  } catch (err: any) {
    logger.warn('KB tool registration failed', { error: err.message });
  }

  // Start webhook server (Express)
  startWebhookServer();

  logger.info('Tiny Hands listener ready');
}

main().catch(err => {
  logger.error('Failed to start Tiny Hands', { error: err.message });
  process.exit(1);
});
