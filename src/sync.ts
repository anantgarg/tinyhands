process.env.PROCESS_TYPE = 'sync';
import { initDb, listActiveWorkspaces, upsertWorkspace, setDefaultWorkspaceId, closeDb } from './db';
import { getSourcesDueForSync, updateSourceStatus, ingestContent } from './modules/sources';
import {
  getSourcesDueForSync as getKBSourcesDueForSync,
  resetStuckSyncingSources,
} from './modules/kb-sources';
import { syncSource as syncKBSource } from './modules/kb-sources/sync-handlers';
import { checkAlerts, generateDailyDigest } from './modules/observability';
import { getBotClient, initSlackClient, getSystemSlackClient, runInSlackContext, postMessage } from './slack';
import { config } from './config';
import { logger } from './utils/logger';
import { checkForUpdates } from './modules/auto-update';
import type { WorkspaceRecord } from './db';

const TINYHANDS_CHANNEL = process.env.TINYHANDS_CHANNEL_ID || 'tinyhands';

const SOURCE_SYNC_INTERVAL_MS = 15 * 60 * 1000;     // agent data sources
const KB_SYNC_INTERVAL_MS = 5 * 60 * 1000;          // KB sources (auto-sync tick)
const ALERT_CHECK_INTERVAL_MS = 60 * 1000;
const CONNECTION_HEALTH_INTERVAL_MS = 30 * 60 * 1000;

// Slack errors that mean "this workspace's bot can't talk to this channel" —
// we log once per workspace and move on instead of spamming stderr.
const BENIGN_SLACK_ERRORS = new Set([
  'account_inactive',
  'channel_not_found',
  'not_in_channel',
  'is_archived',
  'invalid_auth',
  'token_revoked',
]);

function isBenignSlackError(err: any): boolean {
  return err?.data?.error && BENIGN_SLACK_ERRORS.has(err.data.error);
}

async function bootstrapSelfWorkspace(): Promise<void> {
  // Keep legacy single-tenant bootstrap so env-token workspaces still populate
  // on first boot. Multi-tenant workspaces join via OAuth install.
  if (!config.slack.botToken) return;
  try {
    const authResult = await getSystemSlackClient().auth.test();
    await upsertWorkspace({
      id: authResult.team_id as string,
      team_name: (authResult.team as string) || 'default',
      bot_token: config.slack.botToken,
      bot_user_id: authResult.user_id as string,
      bot_id: authResult.bot_id as string,
    });
    setDefaultWorkspaceId(authResult.team_id as string);
    logger.info('Sync workspace bootstrapped', { workspaceId: authResult.team_id });
  } catch (err: any) {
    if (isBenignSlackError(err)) {
      logger.warn('Sync bootstrap: env Slack token is inactive — skipping', { error: err.data.error });
    } else {
      throw err;
    }
  }
}

async function forEachWorkspace(
  label: string,
  fn: (ws: WorkspaceRecord) => Promise<void>,
): Promise<void> {
  const workspaces = await listActiveWorkspaces();
  for (const ws of workspaces) {
    try {
      await fn(ws);
    } catch (err: any) {
      if (isBenignSlackError(err)) {
        logger.warn(`${label}: benign Slack error — skipping workspace`, {
          workspaceId: ws.id,
          error: err.data.error,
        });
      } else {
        logger.error(`${label} failed for workspace`, { workspaceId: ws.id, error: err.message });
      }
    }
  }
}

// ── Agent data sources (sources table) ──
async function runAgentSourceSync(): Promise<void> {
  try {
    const sources = await getSourcesDueForSync();
    if (sources.length > 0) {
      logger.info(`Agent source sync: ${sources.length} sources due for re-index`);
    }
    for (const source of sources) {
      try {
        const wsId = source.workspace_id;
        await updateSourceStatus(wsId, source.id, 'syncing');

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
            await ingestContent(wsId, source.id, source.agent_id, [
              { path: source.label || parsed.fileId, content: driveFile.content },
            ]);
          }
        }

        await updateSourceStatus(wsId, source.id, 'active');
      } catch (err: any) {
        await updateSourceStatus(source.workspace_id, source.id, 'error', err.message);
        logger.error('Source sync failed', { sourceId: source.id, error: err.message });
      }
    }
  } catch (err: any) {
    logger.error('Agent source sync cycle failed', { error: err.message });
  }
}

// ── Database tables backed by Google Sheets ──
async function runDatabaseSheetSync(): Promise<void> {
  try {
    const { getSheetTablesDueForSync, syncGoogleSheet } = await import('./modules/database');
    const tables = await getSheetTablesDueForSync();
    if (tables.length === 0) return;
    logger.info(`Database sheet sync: ${tables.length} tables due for re-sync`);
    for (const t of tables) {
      try {
        const started = Date.now();
        const result = await syncGoogleSheet(t.workspace_id, t.id);
        logger.info('Database sheet sync completed', {
          workspaceId: t.workspace_id,
          tableId: t.id,
          status: result.status,
          rowsImported: result.rowsImported,
          rowsSkipped: result.rowsSkipped,
          issues: result.issues.length,
          durationMs: Date.now() - started,
        });
      } catch (err: any) {
        logger.error('Database sheet sync failed', {
          workspaceId: t.workspace_id, tableId: t.id, error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('Database sheet sync cycle failed', { error: err.message });
  }
}

// ── KB sources (kb_sources table) ──
async function runKBSourceSync(): Promise<void> {
  try {
    await resetStuckSyncingSources();
    const sources = await getKBSourcesDueForSync();
    if (sources.length === 0) return;

    logger.info(`KB source sync: ${sources.length} sources due for re-index`);
    for (const source of sources) {
      try {
        const started = Date.now();
        const count = await syncKBSource(source.workspace_id, source);
        logger.info('KB source auto-sync completed', {
          sourceId: source.id,
          workspaceId: source.workspace_id,
          type: source.source_type,
          entries: count,
          durationMs: Date.now() - started,
        });
      } catch (err: any) {
        // syncKBSource already updated the row to status='error' with message
        logger.error('KB source auto-sync failed', {
          sourceId: source.id,
          workspaceId: source.workspace_id,
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.error('KB sync cycle failed', { error: err.message });
  }
}

// ── Alerts ──
async function runAlertCheck(): Promise<void> {
  await forEachWorkspace('Alert check', async (ws) => {
    const alerts = await checkAlerts(ws.id);
    if (alerts.length === 0) return;
    const client = await getBotClient(ws.id).catch(() => null);
    await runInSlackContext({ workspaceId: ws.id, client: client || getSystemSlackClient() }, async () => {
      for (const alert of alerts) {
        logger.warn('Alert triggered', {
          workspaceId: ws.id,
          condition: alert.condition,
          value: alert.value,
          threshold: alert.threshold,
          message: alert.message,
        });
        try {
          await postMessage(TINYHANDS_CHANNEL, `:rotating_light: ${alert.message}`);
        } catch (err: any) {
          if (!isBenignSlackError(err)) throw err;
        }
      }
    });
  });
}

// ── Daily digest ──
async function runDailyDigestIfDue(): Promise<void> {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (time !== config.observability.dailyDigestTime) return;

  await forEachWorkspace('Daily digest', async (ws) => {
    const digest = await generateDailyDigest(ws.id);
    logger.info('Daily digest generated', { workspaceId: ws.id, digest: digest.slice(0, 200) });
    const client = await getBotClient(ws.id).catch(() => null);
    if (!client) return;
    await runInSlackContext({ workspaceId: ws.id, client }, async () => {
      try {
        await postMessage(TINYHANDS_CHANNEL, digest);
      } catch (err: any) {
        if (!isBenignSlackError(err)) throw err;
      }
    });
  });
}

// ── Connection health ──
async function runConnectionHealthCheck(): Promise<void> {
  const { checkConnectionHealth } = await import('./modules/connections/health');
  await forEachWorkspace('Connection health', async (ws) => {
    const client = await getBotClient(ws.id).catch(() => null);
    await runInSlackContext({ workspaceId: ws.id, client: client || getSystemSlackClient() }, async () => {
      await checkConnectionHealth(ws.id);
    });
  });
}

async function main(): Promise<void> {
  logger.info('Starting TinyHands sync process...');

  await initDb();
  initSlackClient();
  await bootstrapSelfWorkspace();

  const sourceInterval = setInterval(() => {
    runAgentSourceSync().catch(err => logger.error('Agent source sync uncaught', { error: err.message }));
  }, SOURCE_SYNC_INTERVAL_MS);

  const kbSyncInterval = setInterval(() => {
    runKBSourceSync().catch(err => logger.error('KB source sync uncaught', { error: err.message }));
  }, KB_SYNC_INTERVAL_MS);

  // Database sheet sync runs on the same cadence as KB source auto-sync.
  const dbSheetSyncInterval = setInterval(() => {
    runDatabaseSheetSync().catch(err => logger.error('Database sheet sync uncaught', { error: err.message }));
  }, KB_SYNC_INTERVAL_MS);

  // Kick off a KB sync pass immediately so restart-triggered stuck rows
  // (status=syncing) are recovered without waiting a full interval.
  runKBSourceSync().catch(err => logger.error('Initial KB sync failed', { error: err.message }));
  runDatabaseSheetSync().catch(err => logger.error('Initial database sheet sync failed', { error: err.message }));

  const alertInterval = setInterval(() => {
    runAlertCheck().catch(err => logger.error('Alert check uncaught', { error: err.message }));
  }, ALERT_CHECK_INTERVAL_MS);

  const digestInterval = setInterval(() => {
    runDailyDigestIfDue().catch(err => logger.error('Daily digest uncaught', { error: err.message }));
  }, 60000);

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

  const connectionHealthInterval = setInterval(() => {
    runConnectionHealthCheck().catch(err => logger.error('Connection health uncaught', { error: err.message }));
  }, CONNECTION_HEALTH_INTERVAL_MS);

  logger.info('Sync process ready');

  const shutdown = async () => {
    logger.info('Sync process shutting down...');
    clearInterval(sourceInterval);
    clearInterval(kbSyncInterval);
    clearInterval(dbSheetSyncInterval);
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
