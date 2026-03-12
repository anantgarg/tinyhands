import { initDb } from './db';
import { initSlackClient } from './slack';
import { getScheduledTriggersDue, fireTrigger, updateTriggerLastFired, getTriggerLastFiredAt } from './modules/triggers';
import { logger } from './utils/logger';
import { CronExpressionParser } from 'cron-parser';

const SCHEDULER_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

async function main(): Promise<void> {
  logger.info('Starting TinyJobs scheduler process...');

  await initDb();
  initSlackClient();

  setInterval(async () => {
    try {
      const triggers = await getScheduledTriggersDue();
      if (triggers.length === 0) return;

      for (const trigger of triggers) {
        try {
          const config = JSON.parse(trigger.config_json);
          const cronExpr = config.cron;
          if (!cronExpr) {
            logger.warn('Schedule trigger missing cron expression', { triggerId: trigger.id });
            continue;
          }

          const timezone = config.timezone || 'UTC';
          const interval = CronExpressionParser.parse(cronExpr, {
            currentDate: new Date(),
            tz: timezone,
          });

          const prevTime = interval.prev().toDate();
          const lastFiredAt = await getTriggerLastFiredAt(trigger.id);

          // If we haven't fired since the last scheduled time, fire now
          if (!lastFiredAt || lastFiredAt < prevTime) {
            const idempotencyKey = `schedule:${trigger.id}:${prevTime.toISOString()}`;

            logger.info('Firing schedule trigger', {
              triggerId: trigger.id,
              agentId: trigger.agent_id,
              cron: cronExpr,
              prevTime: prevTime.toISOString(),
            });

            await fireTrigger({
              triggerId: trigger.id,
              idempotencyKey,
              payload: {
                firedAt: new Date().toISOString(),
                scheduledFor: prevTime.toISOString(),
                cron: cronExpr,
                description: config.description || 'Scheduled execution',
              },
            });

            await updateTriggerLastFired(trigger.id);
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

  logger.info('Scheduler process ready');

  process.on('SIGTERM', () => {
    logger.info('Scheduler process shutting down...');
    process.exit(0);
  });
}

main().catch(err => {
  logger.error('Scheduler process failed to start', { error: err.message });
  process.exit(1);
});
