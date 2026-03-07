import { getDb } from './db';
import { getSourcesDueForSync, updateSourceStatus, ingestContent } from './modules/sources';
import { checkAlerts } from './modules/observability';
import { generateDailyDigest } from './modules/observability';
import { config } from './config';
import { logger } from './utils/logger';

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const ALERT_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

async function main(): Promise<void> {
  logger.info('Starting TinyJobs sync process...');

  // Initialize database
  getDb();

  // Source sync loop
  setInterval(async () => {
    try {
      const sources = getSourcesDueForSync();
      logger.info(`Sync: ${sources.length} sources due for re-index`);

      for (const source of sources) {
        try {
          updateSourceStatus(source.id, 'syncing');

          // In production: fetch content from source type (GitHub, Drive, etc.)
          // For now, mark as synced
          updateSourceStatus(source.id, 'active');
        } catch (err: any) {
          updateSourceStatus(source.id, 'error', err.message);
          logger.error('Source sync failed', { sourceId: source.id, error: err.message });
        }
      }
    } catch (err: any) {
      logger.error('Sync cycle failed', { error: err.message });
    }
  }, SYNC_INTERVAL_MS);

  // Alert check loop
  setInterval(() => {
    try {
      const alerts = checkAlerts();
      for (const alert of alerts) {
        logger.warn('Alert triggered', {
          condition: alert.condition,
          value: alert.value,
          threshold: alert.threshold,
          message: alert.message,
        });
        // In production: post to #tinyjobs Slack channel
      }
    } catch (err: any) {
      logger.error('Alert check failed', { error: err.message });
    }
  }, ALERT_CHECK_INTERVAL_MS);

  // Daily digest (check every minute if it's digest time)
  setInterval(() => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (time === config.observability.dailyDigestTime) {
      const digest = generateDailyDigest();
      logger.info('Daily digest generated', { digest: digest.slice(0, 200) });
      // In production: post digest to #tinyjobs Slack channel
    }
  }, 60000);

  logger.info('Sync process ready');

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Sync process shutting down...');
    process.exit(0);
  });
}

main().catch(err => {
  logger.error('Sync process failed to start', { error: err.message });
  process.exit(1);
});
