import { createWorker } from './modules/execution';
import { initializeSchema } from './db';
import { processExpiredTimers } from './modules/workflows';
import { expireOldProposals } from './modules/self-evolution';
import { logger } from './utils/logger';

const workerId = process.env.WORKER_ID || '1';

async function main(): Promise<void> {
  logger.info(`Starting TinyJobs worker ${workerId}...`);

  // Initialize database
  await initializeSchema();

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
