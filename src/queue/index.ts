import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import type { JobData, QueuePriority } from '../types';
import { logger } from '../utils/logger';

let connection: IORedis;

export function getRedisConnection(): IORedis {
  if (!connection) {
    const opts: any = { maxRetriesPerRequest: null };
    if (config.redis.url.startsWith('rediss://')) {
      opts.tls = { rejectUnauthorized: false };
    }
    connection = new IORedis(config.redis.url, opts);
  }
  return connection;
}

// ── Queues ──

const QUEUE_NAME = 'tinyhands-runs';

let queue: Queue<JobData>;

export function getQueue(): Queue<JobData> {
  if (!queue) {
    queue = new Queue<JobData>(QUEUE_NAME, {
      connection: getRedisConnection() as any,
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

// ── Token Bucket Rate Limiter ──
// Tracks TPM and RPM against Anthropic API tier limits.
// Pre-flight check before dispatch, in-flight estimation, backpressure at 90%.

const RATE_LIMITER_KEY = 'tinyhands:rate_limiter';
const INFLIGHT_KEY = 'tinyhands:inflight_tokens';

export async function checkRateLimit(): Promise<{ allowed: boolean; usage: number }> {
  const redis = getRedisConnection();
  const now = Math.floor(Date.now() / 60000); // minute window
  const key = `${RATE_LIMITER_KEY}:tpm:${now}`;

  const [current, inflight] = await Promise.all([
    redis.get(key),
    redis.get(INFLIGHT_KEY),
  ]);

  const actualUsage = current ? parseInt(current, 10) : 0;
  const inflightEstimate = inflight ? parseInt(inflight, 10) : 0;
  const totalUsage = actualUsage + inflightEstimate;
  const limit = config.anthropic.tpmLimit;
  const usageRatio = totalUsage / limit;

  // At >80%: delay 5 seconds and re-check. At >90%: pause queue.
  return {
    allowed: usageRatio < 0.9,
    usage: usageRatio,
  };
}

export async function recordTokenUsage(tokens: number): Promise<void> {
  const redis = getRedisConnection();
  const now = Math.floor(Date.now() / 60000);
  const key = `${RATE_LIMITER_KEY}:tpm:${now}`;

  await redis.incrby(key, tokens);
  await redis.expire(key, 120); // 2 minute TTL

  // Reconcile: reduce in-flight estimate
  await redis.decrby(INFLIGHT_KEY, tokens);
  const remaining = await redis.get(INFLIGHT_KEY);
  if (remaining && parseInt(remaining, 10) < 0) {
    await redis.set(INFLIGHT_KEY, '0');
  }
}

export async function estimateInflightUsage(estimatedTokens: number): Promise<void> {
  const redis = getRedisConnection();
  await redis.incrby(INFLIGHT_KEY, estimatedTokens);
  await redis.expire(INFLIGHT_KEY, 300);
}

export async function checkRequestRate(): Promise<boolean> {
  const redis = getRedisConnection();
  const now = Math.floor(Date.now() / 60000);
  const key = `${RATE_LIMITER_KEY}:rpm:${now}`;

  const current = await redis.incr(key);
  await redis.expire(key, 120);

  return current <= config.anthropic.rpmLimit;
}

export async function handleRateLimitResponse(retryAfterSec: number): Promise<void> {
  const redis = getRedisConnection();
  // Mark rate limit hit — workers check this before dispatch
  await redis.set('tinyhands:rate_limited', '1', 'EX', retryAfterSec);
  logger.warn('Anthropic 429 recorded', { retryAfter: retryAfterSec });
}

export async function isRateLimited(): Promise<boolean> {
  const redis = getRedisConnection();
  const limited = await redis.get('tinyhands:rate_limited');
  return limited === '1';
}

export async function getQueueDepth(): Promise<number> {
  const q = getQueue();
  const counts = await q.getJobCounts();
  return (counts.waiting || 0) + (counts.delayed || 0);
}

// ── Trigger Dedup ──

const DEDUP_PREFIX = 'tinyhands:dedup:';
const DEDUP_WINDOW_SECONDS = 300; // 5 minutes

export async function isDuplicateEvent(idempotencyKey: string): Promise<boolean> {
  const redis = getRedisConnection();
  const key = `${DEDUP_PREFIX}${idempotencyKey}`;
  const result = await redis.set(key, '1', 'EX', DEDUP_WINDOW_SECONDS, 'NX');
  return result === null; // null means key already existed
}

// ── Queue Events ──

export function createQueueEvents(): QueueEvents {
  return new QueueEvents(QUEUE_NAME, { connection: getRedisConnection() as any });
}

// ── Cleanup ──

export async function closeQueue(): Promise<void> {
  if (queue) await queue.close();
  if (connection) await connection.quit();
}
