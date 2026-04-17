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

// Priority bands — BullMQ treats lower numbers as higher priority.
// Base bands are widely spaced so per-workspace pending count offsets can fit
// in the gap without a high-priority job ever falling behind a normal one.
const PRIORITY_BASE: Record<QueuePriority, number> = {
  high: 100,
  normal: 10_000,
  low: 100_000,
};

/**
 * Compute an effective BullMQ priority that round-robins across workspaces.
 * The more jobs a workspace already has waiting, the larger the offset, so a
 * workspace with an empty queue is always picked ahead of a workspace with a
 * backlog at the same user-visible priority band.
 */
async function computeEffectivePriority(
  priority: QueuePriority,
  workspaceId: string,
): Promise<number> {
  const q = getQueue();
  const waiting = await q.getJobs(['waiting', 'prioritized', 'delayed'], 0, 500);
  const sameWs = waiting.filter((j) => j?.data && (j.data as any).workspaceId === workspaceId).length;
  return PRIORITY_BASE[priority] + sameWs;
}

export async function enqueueRun(
  data: JobData,
  priority: QueuePriority = 'normal',
  delayMs?: number
): Promise<Job<JobData>> {
  const q = getQueue();
  const effectivePriority = await computeEffectivePriority(priority, data.workspaceId);

  const job = await q.add('agent-run', data, {
    priority: effectivePriority,
    delay: delayMs,
    jobId: data.traceId,
    attempts: 1,
  });

  logger.info('Job enqueued', {
    jobId: job.id,
    traceId: data.traceId,
    agentId: data.agentId,
    workspaceId: data.workspaceId,
    priority,
    effectivePriority,
  });

  return job;
}

// ── Token Bucket Rate Limiter ──
// Tracks TPM and RPM against Anthropic API tier limits.
// Pre-flight check before dispatch, in-flight estimation, backpressure at 90%.
// All keys are scoped by workspaceId for multi-tenant isolation.

function rateLimiterKey(workspaceId: string): string {
  return `tinyhands:${workspaceId}:rate_limiter`;
}

function inflightKey(workspaceId: string): string {
  return `tinyhands:${workspaceId}:inflight_tokens`;
}

export async function checkRateLimit(workspaceId: string): Promise<{ allowed: boolean; usage: number }> {
  const redis = getRedisConnection();
  const now = Math.floor(Date.now() / 60000); // minute window
  const key = `${rateLimiterKey(workspaceId)}:tpm:${now}`;

  const [current, inflight] = await Promise.all([
    redis.get(key),
    redis.get(inflightKey(workspaceId)),
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

export async function recordTokenUsage(workspaceId: string, tokens: number): Promise<void> {
  const redis = getRedisConnection();
  const now = Math.floor(Date.now() / 60000);
  const key = `${rateLimiterKey(workspaceId)}:tpm:${now}`;
  const iKey = inflightKey(workspaceId);

  await redis.incrby(key, tokens);
  await redis.expire(key, 120); // 2 minute TTL

  // Reconcile: reduce in-flight estimate
  await redis.decrby(iKey, tokens);
  const remaining = await redis.get(iKey);
  if (remaining && parseInt(remaining, 10) < 0) {
    await redis.set(iKey, '0');
  }
}

export async function estimateInflightUsage(workspaceId: string, estimatedTokens: number): Promise<void> {
  const redis = getRedisConnection();
  const iKey = inflightKey(workspaceId);
  await redis.incrby(iKey, estimatedTokens);
  await redis.expire(iKey, 300);
}

export async function checkRequestRate(workspaceId: string): Promise<boolean> {
  const redis = getRedisConnection();
  const now = Math.floor(Date.now() / 60000);
  const key = `${rateLimiterKey(workspaceId)}:rpm:${now}`;

  const current = await redis.incr(key);
  await redis.expire(key, 120);

  return current <= config.anthropic.rpmLimit;
}

export async function handleRateLimitResponse(workspaceId: string, retryAfterSec: number): Promise<void> {
  const redis = getRedisConnection();
  // Mark rate limit hit — workers check this before dispatch
  await redis.set(`tinyhands:${workspaceId}:rate_limited`, '1', 'EX', retryAfterSec);
  logger.warn('Anthropic 429 recorded', { workspaceId, retryAfter: retryAfterSec });
}

export async function isRateLimited(workspaceId: string): Promise<boolean> {
  const redis = getRedisConnection();
  const limited = await redis.get(`tinyhands:${workspaceId}:rate_limited`);
  return limited === '1';
}

export async function getQueueDepth(): Promise<number> {
  const q = getQueue();
  const counts = await q.getJobCounts();
  return (counts.waiting || 0) + (counts.delayed || 0);
}

// ── Trigger Dedup ──

const DEDUP_WINDOW_SECONDS = 300; // 5 minutes

export async function isDuplicateEvent(workspaceId: string, idempotencyKey: string): Promise<boolean> {
  const redis = getRedisConnection();
  const key = `tinyhands:${workspaceId}:dedup:${idempotencyKey}`;
  const result = await redis.set(key, '1', 'EX', DEDUP_WINDOW_SECONDS, 'NX');
  return result === null; // null means key already existed
}

// ── Approval State ──
// Approval keys are workspace-scoped. Request IDs are globally unique UUIDs so
// the workspace prefix is belt-and-suspenders protection against cross-tenant
// reads via a crafted requestId.

export async function setApprovalState(
  workspaceId: string,
  requestId: string,
  state: 'pending' | 'approved' | 'denied',
  ttlSeconds?: number,
): Promise<void> {
  const redis = getRedisConnection();
  const key = `tinyhands:${workspaceId}:approval:${requestId}`;
  if (ttlSeconds) {
    await redis.set(key, state, 'EX', ttlSeconds);
  } else {
    await redis.set(key, state);
    await redis.expire(key, 3600); // default 1 hour TTL
  }
}

export async function getApprovalState(workspaceId: string, requestId: string): Promise<string | null> {
  const redis = getRedisConnection();
  return redis.get(`tinyhands:${workspaceId}:approval:${requestId}`);
}

/**
 * Workspace-scoped Redis key helper. Every tenant-data Redis key must use this
 * helper so cross-tenant leakage is impossible by construction.
 */
export function rkey(workspaceId: string, ...parts: string[]): string {
  return ['tinyhands', workspaceId, ...parts].join(':');
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
