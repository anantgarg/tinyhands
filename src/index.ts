import { createSlackApp } from './slack';
import { startWebhookServer } from './server';
import { initializeSchema } from './db';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  logger.info('Starting TinyJobs...');

  // Initialize database
  await initializeSchema();
  logger.info('Database initialized');

  // Start Slack app (Socket Mode)
  const app = createSlackApp();
  await app.start();
  logger.info('Slack app started (Socket Mode)');

  // Start webhook server (Express)
  startWebhookServer();

  logger.info('TinyJobs listener ready');
}

main().catch(err => {
  logger.error('Failed to start TinyJobs', { error: err.message });
  process.exit(1);
});
