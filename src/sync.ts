process.env.PROCESS_TYPE = 'sync';
import { initDb, upsertWorkspace, setDefaultWorkspaceId, getDefaultWorkspaceId, closeDb } from './db';
import { getSourcesDueForSync, updateSourceStatus, ingestContent, getSource } from './modules/sources';
import { checkAlerts } from './modules/observability';
import { generateDailyDigest } from './modules/observability';
import { initSlackClient, getSlackApp } from './slack';
import { config } from './config';
import { logger } from './utils/logger';
import { postMessage } from './slack';
import { checkForUpdates } from './modules/auto-update';

const TINYHANDS_CHANNEL = process.env.TINYHANDS_CHANNEL_ID || 'tinyhands';

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const ALERT_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const CONNECTION_HEALTH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function main(): Promise<void> {
  logger.info('Starting TinyHands sync process...');

  // Initialize database
  await initDb();

  // Initialize Slack Web API client only (no Socket Mode — avoids extra WebSocket connections)
  initSlackClient();

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
  logger.info('Sync workspace bootstrapped', { workspaceId: authResult.team_id });

  // Source sync loop
  const syncInterval = setInterval(async () => {
    try {
      const sources = await getSourcesDueForSync();
      logger.info(`Sync: ${sources.length} sources due for re-index`);

      for (const source of sources) {
        try {
          const wsId = source.workspace_id;
          await updateSourceStatus(wsId, source.id, 'syncing');

          // Fetch and re-index based on source type
          if (source.source_type === 'github') {
            const { pullLatest, readRepoFiles } = await import('./modules/sources/github');
            const repoDir = `/tmp/tinyhands-sources-cache/${source.agent_id}/${source.id}`;
            await pullLatest(repoDir);
            const files = readRepoFiles(repoDir);
            await ingestContent(wsId, source.id, source.agent_id, files);
          } else if (source.source_type === 'google_drive') {
            const { fetchDriveFile, parseDriveUri, getServiceAccountToken } = await import('./modules/sources/google-drive');
            const parsed = parseDriveUri(source.uri);
            if (parsed) {
              const token = await getServiceAccountToken();
              const driveFile = await fetchDriveFile(parsed.fileId, token!);
              await ingestContent(wsId, source.id, source.agent_id, [{ path: source.label || parsed.fileId, content: driveFile.content }]);
            }
          }

          await updateSourceStatus(wsId, source.id, 'active');
        } catch (err: any) {
          await updateSourceStatus(source.workspace_id, source.id, 'error', err.message);
          logger.error('Source sync failed', { sourceId: source.id, error: err.message });
        }
      }
    } catch (err: any) {
      logger.error('Sync cycle failed', { error: err.message });
    }
  }, SYNC_INTERVAL_MS);

  // Alert check loop
  const alertInterval = setInterval(async () => {
    try {
      const workspaceId = getDefaultWorkspaceId();
      const alerts = await checkAlerts(workspaceId);
      for (const alert of alerts) {
        logger.warn('Alert triggered', {
          condition: alert.condition,
          value: alert.value,
          threshold: alert.threshold,
          message: alert.message,
        });
        // Post alert to #tinyhands Slack channel
        try {
          await postMessage(
            TINYHANDS_CHANNEL,
            `:rotating_light: ${alert.message}`
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
  const digestInterval = setInterval(async () => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (time === config.observability.dailyDigestTime) {
      const workspaceId = getDefaultWorkspaceId();
      const digest = await generateDailyDigest(workspaceId);
      logger.info('Daily digest generated', { digest: digest.slice(0, 200) });
      // Post digest to #tinyhands Slack channel
      postMessage(TINYHANDS_CHANNEL, digest).catch((err: any) => {
        logger.error('Failed to post daily digest to Slack', { error: err.message });
      });
    }
  }, 60000);

  // Auto-update check (pull-based deployment)
  let updateInterval: ReturnType<typeof setInterval> | undefined;
  if (config.autoUpdate.enabled) {
    updateInterval = setInterval(async () => {
      try {
        await checkForUpdates();
      } catch (err: any) {
        logger.error('Auto-update check failed', { error: err.message });
      }
    }, config.autoUpdate.intervalMs);
    logger.info('Auto-update enabled', { interval: config.autoUpdate.intervalMs, branch: config.autoUpdate.branch });
  }

  // Connection health check loop
  const connectionHealthInterval = setInterval(async () => {
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { checkConnectionHealth } = await import('./modules/connections/health');
      await checkConnectionHealth(workspaceId);
    } catch (err: any) {
      logger.error('Connection health check failed', { error: err.message });
    }
  }, CONNECTION_HEALTH_INTERVAL_MS);

  logger.info('Sync process ready');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Sync process shutting down...');
    clearInterval(syncInterval);
    clearInterval(alertInterval);
    clearInterval(digestInterval);
    clearInterval(connectionHealthInterval);
    if (updateInterval) clearInterval(updateInterval);
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  logger.error('Sync process failed to start', { error: err.message });
  process.exit(1);
});
