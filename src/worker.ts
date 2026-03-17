import { createWorker } from './modules/execution';
import { initSlackClient, getSlackApp } from './slack';
import { initDb, upsertWorkspace, setDefaultWorkspaceId } from './db';
import { config } from './config';
import { processExpiredTimers } from './modules/workflows';
import { expireOldProposals } from './modules/self-evolution';
import { logger } from './utils/logger';

const workerId = process.env.WORKER_ID || '1';

async function main(): Promise<void> {
  logger.info(`Starting TinyHands worker ${workerId}...`);

  // Initialize database
  await initDb();

  // Initialize Slack Web API client only (no Socket Mode — avoids extra WebSocket connections)
  initSlackClient();
  logger.info(`Worker ${workerId} Slack client initialized`);

  // Bootstrap workspace from bot token
  const authResult = await getSlackApp().client.auth.test();
  await upsertWorkspace({
    id: authResult.team_id as string,
    team_name: (authResult.team as string) || 'default',
    bot_token: config.slack.botToken,
    bot_user_id: authResult.user_id as string,
    bot_id: authResult.bot_id as string,
  });
  setDefaultWorkspaceId(authResult.team_id as string);
  logger.info(`Worker ${workerId} workspace bootstrapped`, { workspaceId: authResult.team_id });

  // Create BullMQ worker
  const worker = createWorker();
  logger.info(`Worker ${workerId} ready, waiting for jobs...`);

  // Periodic tasks
  setInterval(async () => {
    try {
      const expired = await processExpiredTimers();
      if (expired > 0) {
        logger.info('Processed expired workflow timers', { count: expired });
      }
    } catch (err: any) {
      logger.error('Timer processing failed', { error: err.message });
    }
  }, 10000); // Check every 10 seconds

  setInterval(async () => {
    try {
      await expireOldProposals();
    } catch (err: any) {
      logger.error('Proposal expiry failed', { error: err.message });
    }
  }, 60000); // Check every minute

  // Graceful shutdown
  const shutdown = async () => {
    logger.info(`Worker ${workerId} shutting down...`);
    await worker.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  logger.error(`Worker ${workerId} failed to start`, { error: err.message });
  process.exit(1);
});
