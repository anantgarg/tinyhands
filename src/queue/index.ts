import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import type { JobData, QueuePriority } from '../types';
import { logger } from '../utils/logger';

let connection: IORedis;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
  }
  return connection;
}

// ── Queues ──

const QUEUE_NAME = 'tinyjobs-runs';

let queue: Queue<JobData>;

export function getQueue(): Queue<JobData> {
  if (!queue) {
    queue = new Queue<JobData>(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return queue;
}

const PRIORITY_MAP: Record<QueuePriority, number> = {
  high: 1,
  normal: 2,
  low: 3,
};

export async function enqueueRun(
  data: JobData,
  priority: QueuePriority = 'normal',
  delayMs?: number
): Promise<Job<JobData>> {
  const q = getQueue();

  const job = await q.add('agent-run', data, {
    priority: PRIORITY_MAP[priority],
    delay: delayMs,
    jobId: data.traceId,
    attempts: 1,
  });

  logger.info('Job enqueued', {
    jobId: job.id,
    traceId: data.traceId,
    agentId: data.agentId,
    priority,
  });

  return job;
}

// ── Rate Limiter ──

const RATE_LIMITER_KEY = 'tinyjobs:rate_limiter';

export async function checkRateLimit(): Promise<{ allowed: boolean; usage: number }> {
  const redis = getRedisConnection();
  const now = Math.floor(Date.now() / 60000); // minute window
  const key = `${RATE_LIMITER_KEY}:${now}`;

  const current = await redis.get(key);
  const usage = current ? parseInt(current, 10) : 0;
  const limit = config.anthropic.tpmLimit;

  return {
    allowed: usage < limit * 0.9,
    usage: usage / limit,
  };
}

export async function recordTokenUsage(tokens: number): Promise<void> {
  const redis = getRedisConnection();
  const now = Math.floor(Date.now() / 60000);
  const key = `${RATE_LIMITER_KEY}:${now}`;

  await redis.incrby(key, tokens);
  await redis.expire(key, 120); // 2 minute TTL
}

export async function checkRequestRate(): Promise<boolean> {
  const redis = getRedisConnection();
  const now = Math.floor(Date.now() / 60000);
  const key = `${RATE_LIMITER_KEY}:rpm:${now}`;

  const current = await redis.incr(key);
  await redis.expire(key, 120);

  return current <= config.anthropic.rpmLimit;
}

// ── Trigger Dedup ──

const DEDUP_PREFIX = 'tinyjobs:dedup:';
const DEDUP_WINDOW_SECONDS = 300; // 5 minutes

export async function isDuplicateEvent(idempotencyKey: string): Promise<boolean> {
  const redis = getRedisConnection();
  const key = `${DEDUP_PREFIX}${idempotencyKey}`;
  const result = await redis.set(key, '1', 'EX', DEDUP_WINDOW_SECONDS, 'NX');
  return result === null; // null means key already existed
}

// ── Queue Events ──

export function createQueueEvents(): QueueEvents {
  return new QueueEvents(QUEUE_NAME, { connection: getRedisConnection() });
}

// ── Cleanup ──

export async function closeQueue(): Promise<void> {
  if (queue) await queue.close();
  if (connection) await connection.quit();
}
