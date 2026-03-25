process.env.PROCESS_TYPE = 'worker';
import { createWorker } from './modules/execution';
import { initSlackClient, getSlackApp } from './slack';
import { initDb, upsertWorkspace, setDefaultWorkspaceId, execute, getDefaultWorkspaceId } from './db';
import { config } from './config';
import { processExpiredTimers } from './modules/workflows';
import { expireOldProposals } from './modules/self-evolution';
import { logger } from './utils/logger';
import { listAgentContainers, removeContainer } from './docker';
import Dockerode from 'dockerode';

const workerId = process.env.WORKER_ID || '1';

/**
 * Clean up orphaned containers and stuck runs from previous crashes/restarts.
 * Finds tinyhands containers that are no longer running and marks their
 * corresponding run records as failed.
 */
async function cleanupOrphans(): Promise<void> {
  try {
    const containers = await listAgentContainers();
    const docker = new Dockerode();

    for (const info of containers) {
      const traceId = info.Labels['tinyhands.trace_id'];
      const agentId = info.Labels['tinyhands.agent_id'];
      if (!traceId) continue;

      // If container exited (not running), clean it up
      if (info.State !== 'running') {
        try {
          const container = docker.getContainer(info.Id);
          await container.remove({ force: true }).catch(() => {});
          logger.info('Cleaned up exited orphan container', { containerId: info.Id.slice(0, 12), traceId, agentId });
        } catch { /* already removed */ }
      }
    }

    // Mark any "running" runs older than 35 minutes as failed (max timeout is 30 min)
    const result = await execute(
      `UPDATE run_history SET status = 'failed', output = 'Run interrupted — process restarted during execution.', completed_at = NOW()
       WHERE status = 'running' AND created_at < NOW() - INTERVAL '35 minutes'`
    );
    if (result.rowCount > 0) {
      logger.warn('Marked stale runs as failed', { count: result.rowCount });
    }
  } catch (err: any) {
    logger.warn('Orphan cleanup failed', { error: err.message });
  }
}

// Retry workspace bootstrap — table may not exist yet if migrations are still running
async function bootstrapWorkspace(): Promise<void> {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const authResult = await getSlackApp().client.auth.test();
      await upsertWorkspace({
        id: authResult.team_id as string,
        team_name: (authResult.team as string) || 'default',
        bot_token: config.slack.botToken,
        bot_user_id: authResult.user_id as string,
        bot_id: authResult.bot_id as string,
      });
      setDefaultWorkspaceId(authResult.team_id as string);
      return;
    } catch (err: any) {
      if (attempt === 10) throw err;
      logger.warn(`Workspace bootstrap attempt ${attempt} failed, retrying in 2s...`, { error: err.message });
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function main(): Promise<void> {
  logger.info(`Starting TinyHands worker ${workerId}...`);

  // Initialize database
  await initDb();

  // Initialize Slack Web API client only (no Socket Mode — avoids extra WebSocket connections)
  initSlackClient();
  logger.info(`Worker ${workerId} Slack client initialized`);

  // Bootstrap workspace from bot token
  await bootstrapWorkspace();
  logger.info(`Worker ${workerId} workspace bootstrapped`, { workspaceId: getDefaultWorkspaceId() });

  // Clean up orphaned containers and stuck runs from previous crashes
  await cleanupOrphans();

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

  // Periodic orphan cleanup (every 5 minutes)
  setInterval(async () => {
    await cleanupOrphans();
  }, 5 * 60 * 1000);

  // Graceful shutdown — wait for active job to finish
  const shutdown = async () => {
    logger.info(`Worker ${workerId} shutting down gracefully...`);
    // worker.close() tells BullMQ to stop taking new jobs and wait for the active one to finish
    // Default timeout is 30s; we use the job timeout since agent runs can be long
    try {
      await worker.close(true);
      logger.info(`Worker ${workerId} shutdown complete`);
    } catch (err: any) {
      logger.warn(`Worker ${workerId} forced shutdown`, { error: err.message });
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  logger.error(`Worker ${workerId} failed to start`, { error: err.message });
  process.exit(1);
});
