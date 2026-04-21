process.env.PROCESS_TYPE = 'scheduler';
import { initDb, upsertWorkspace, setDefaultWorkspaceId, closeDb, queryOne, query } from './db';
import { getLintQueue, getNamespaceMode } from './modules/kb-wiki';
import { initSlackClient, getSystemSlackClient } from './slack';
import { config } from './config';
import { getScheduledTriggersDue, fireTrigger, updateTriggerLastFired, getTriggerLastFiredAt } from './modules/triggers';
import { logger } from './utils/logger';
import { CronExpressionParser } from 'cron-parser';

const SCHEDULER_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

async function main(): Promise<void> {
  logger.info('Starting TinyHands scheduler process...');

  await initDb();
  initSlackClient();

  // Bootstrap workspace from bot token
  const authResult = await getSystemSlackClient().auth.test();
  await upsertWorkspace({
    id: authResult.team_id as string,
    team_name: (authResult.team as string) || 'default',
    bot_token: config.slack.botToken,
    bot_user_id: authResult.user_id as string,
    bot_id: authResult.bot_id as string,
  });
  setDefaultWorkspaceId(authResult.team_id as string);
  logger.info('Scheduler workspace bootstrapped', { workspaceId: authResult.team_id });

  const schedulerInterval = setInterval(async () => {
    try {
      const triggers = await getScheduledTriggersDue();
      if (triggers.length === 0) return;

      for (const trigger of triggers) {
        try {
          const triggerConfig = JSON.parse(trigger.config_json);
          const cronExpr = triggerConfig.cron;
          if (!cronExpr) {
            logger.warn('Schedule trigger missing cron expression', { triggerId: trigger.id });
            continue;
          }

          const timezone = triggerConfig.timezone || 'UTC';
          const interval = CronExpressionParser.parse(cronExpr, {
            currentDate: new Date(),
            tz: timezone,
          });

          const prevTime = interval.prev().toDate();
          const lastFiredAt = await getTriggerLastFiredAt(trigger.workspace_id, trigger.id);

          // If we haven't fired since the last scheduled time, fire now
          if (!lastFiredAt || lastFiredAt < prevTime) {
            const idempotencyKey = `schedule:${trigger.id}:${prevTime.toISOString()}`;

            logger.info('Firing schedule trigger', {
              triggerId: trigger.id,
              agentId: trigger.agent_id,
              cron: cronExpr,
              prevTime: prevTime.toISOString(),
            });

            // Look up agent's channel so scheduled runs post results to Slack
            const agent = await queryOne<{ channel_id: string }>('SELECT channel_id FROM agents WHERE id = $1', [trigger.agent_id]);

            await fireTrigger(trigger.workspace_id, {
              triggerId: trigger.id,
              idempotencyKey,
              sourceChannel: agent?.channel_id || '',
              payload: {
                firedAt: new Date().toISOString(),
                scheduledFor: prevTime.toISOString(),
                cron: cronExpr,
                description: triggerConfig.description || 'Scheduled execution',
              },
            });

            await updateTriggerLastFired(trigger.workspace_id, trigger.id);
          }
        } catch (err: any) {
          logger.error('Schedule trigger evaluation failed', {
            triggerId: trigger.id,
            error: err.message,
          });
        }
      }
    } catch (err: any) {
      logger.error('Scheduler cycle failed', { error: err.message });
    }
  }, SCHEDULER_INTERVAL_MS);

  // Nightly wiki lint at 03:00 UTC. We poll once a minute and dispatch a
  // single job per (workspace, namespace) when the wall-clock minute matches.
  const lintInterval = setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() !== 3 || now.getUTCMinutes() !== 0) return;
    try {
      const workspaces = await query<{ id: string }>('SELECT id FROM workspaces');
      const queue = getLintQueue();
      for (const ws of workspaces) {
        for (const namespace of ['kb', 'docs'] as const) {
          const mode = await getNamespaceMode(ws.id, namespace);
          if (mode === 'search') continue;
          await queue.add('lint', { workspaceId: ws.id, namespace }, {
            jobId: `lint-${ws.id}-${namespace}-${now.toISOString().slice(0, 10)}`,
          });
        }
      }
    } catch (err: any) {
      logger.error('Nightly wiki lint dispatch failed', { error: err.message });
    }
  }, 60 * 1000);

  logger.info('Scheduler process ready');

  const shutdown = async () => {
    logger.info('Scheduler process shutting down...');
    clearInterval(schedulerInterval);
    clearInterval(lintInterval);
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  logger.error('Scheduler process failed to start', { error: err.message });
  process.exit(1);
});
