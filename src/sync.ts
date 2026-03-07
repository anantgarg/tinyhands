import { initializeSchema } from './db';
import { getSourcesDueForSync, updateSourceStatus, ingestContent, getSource } from './modules/sources';
import { checkAlerts } from './modules/observability';
import { generateDailyDigest } from './modules/observability';
import { config } from './config';
import { logger } from './utils/logger';
import { postMessage } from './slack';

const TINYJOBS_CHANNEL = process.env.TINYJOBS_CHANNEL_ID || 'tinyjobs';

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const ALERT_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

async function main(): Promise<void> {
  logger.info('Starting TinyJobs sync process...');

  // Initialize database
  await initializeSchema();

  // Source sync loop
  setInterval(async () => {
    try {
      const sources = await getSourcesDueForSync();
      logger.info(`Sync: ${sources.length} sources due for re-index`);

      for (const source of sources) {
        try {
          await updateSourceStatus(source.id, 'syncing');

          // Fetch and re-index based on source type
          if (source.source_type === 'github') {
            const { pullLatest, readRepoFiles } = await import('./modules/sources/github');
            const repoDir = `/tmp/tinyjobs-sources-cache/${source.agent_id}/${source.id}`;
            await pullLatest(repoDir);
            const files = readRepoFiles(repoDir);
            await ingestContent(source.id, source.agent_id, files);
          } else if (source.source_type === 'google_drive') {
            const { fetchDriveFile, parseDriveUri, getServiceAccountToken } = await import('./modules/sources/google-drive');
            const parsed = parseDriveUri(source.uri);
            if (parsed) {
              const token = await getServiceAccountToken();
              if (!token) throw new Error('No Google service account token');
              const driveFile = await fetchDriveFile(parsed.fileId, token);
              await ingestContent(source.id, source.agent_id, [{ path: source.label, content: driveFile.content }]);
            }
          }

          await updateSourceStatus(source.id, 'active');
        } catch (err: any) {
          await updateSourceStatus(source.id, 'error', err.message);
          logger.error('Source sync failed', { sourceId: source.id, error: err.message });
        }
      }
    } catch (err: any) {
      logger.error('Sync cycle failed', { error: err.message });
    }
  }, SYNC_INTERVAL_MS);

  // Alert check loop
  setInterval(async () => {
    try {
      const alerts = await checkAlerts();
      for (const alert of alerts) {
        logger.warn('Alert triggered', {
          condition: alert.condition,
          value: alert.value,
          threshold: alert.threshold,
          message: alert.message,
        });
        // Post alert to #tinyjobs Slack channel
        try {
          await postMessage(
            TINYJOBS_CHANNEL,
            `:rotating_light: *Alert: ${alert.condition}*\n${alert.message}\nThreshold: ${alert.threshold} | Value: ${typeof alert.value === 'number' ? alert.value.toFixed(4) : alert.value}`
          );
        } catch (slackErr: any) {
          logger.error('Failed to post alert to Slack', { error: slackErr.message });
        }
      }
    } catch (err: any) {
      logger.error('Alert check failed', { error: err.message });
    }
  }, ALERT_CHECK_INTERVAL_MS);

  // Daily digest (check every minute if it's digest time)
  setInterval(async () => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (time === config.observability.dailyDigestTime) {
      const digest = await generateDailyDigest();
      logger.info('Daily digest generated', { digest: digest.slice(0, 200) });
      // Post digest to #tinyjobs Slack channel
      postMessage(TINYJOBS_CHANNEL, digest).catch((err: any) => {
        logger.error('Failed to post daily digest to Slack', { error: err.message });
      });
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
