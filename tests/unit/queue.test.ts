import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisIncrby = vi.fn();
const mockRedisDecrby = vi.fn();
const mockRedisExpire = vi.fn();
const mockRedisIncr = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisQuit = vi.fn();

vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      get: mockRedisGet,
      set: mockRedisSet,
      incrby: mockRedisIncrby,
      decrby: mockRedisDecrby,
      expire: mockRedisExpire,
      incr: mockRedisIncr,
      del: mockRedisDel,
      quit: mockRedisQuit,
    })),
  };
});

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
const mockQueueGetJobCounts = vi.fn().mockResolvedValue({ waiting: 5, active: 2, delayed: 1 });
const mockQueueGetJobs = vi.fn().mockResolvedValue([]);
const mockQueueClose = vi.fn();

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    getJobCounts: mockQueueGetJobCounts,
    getJobs: mockQueueGetJobs,
    close: mockQueueClose,
  })),
  QueueEvents: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
  })),
  Worker: vi.fn(),
}));

vi.mock('../../src/config', () => ({
  config: {
    redis: { url: 'redis://localhost:6379' },
    anthropic: { tpmLimit: 80000, rpmLimit: 1000 },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getRedisConnection,
  getQueue,
  enqueueRun,
  checkRateLimit,
  recordTokenUsage,
  estimateInflightUsage,
  checkRequestRate,
  handleRateLimitResponse,
  isRateLimited,
  getQueueDepth,
  isDuplicateEvent,
  createQueueEvents,
  closeQueue,
  setApprovalState,
  getApprovalState,
} from '../../src/queue';

import type { JobData } from '../../src/types';

// ── Helpers ──

const TEST_WORKSPACE_ID = 'W_TEST_123';

function makeJobData(overrides: Partial<JobData> = {}): JobData {
  return {
    workspaceId: TEST_WORKSPACE_ID,
    agentId: 'agent-1',
    channelId: 'C123',
    threadTs: '1234567890.123456',
    input: 'Hello world',
    userId: 'U123',
    traceId: 'trace-abc',
    ...overrides,
  };
}

// ── Tests ──

describe('Queue Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // getRedisConnection
  // ────────────────────────────────────────────────
  describe('getRedisConnection', () => {
    it('returns an IORedis instance', () => {
      const conn = getRedisConnection();
      expect(conn).toBeDefined();
      expect(conn.get).toBeDefined();
      expect(conn.set).toBeDefined();
    });

    it('returns the same instance on subsequent calls (singleton)', () => {
      const conn1 = getRedisConnection();
      const conn2 = getRedisConnection();
      expect(conn1).toBe(conn2);
    });
  });

  // ────────────────────────────────────────────────
  // getQueue
  // ────────────────────────────────────────────────
  describe('getQueue', () => {
    it('returns a Queue instance', () => {
      const q = getQueue();
      expect(q).toBeDefined();
      expect(q.add).toBeDefined();
    });

    it('returns the same instance on subsequent calls (singleton)', () => {
      const q1 = getQueue();
      const q2 = getQueue();
      expect(q1).toBe(q2);
    });
  });

  // ────────────────────────────────────────────────
  // enqueueRun
  // ────────────────────────────────────────────────
  describe('enqueueRun', () => {
    it('enqueues a job with normal priority by default', async () => {
      const data = makeJobData();
      const job = await enqueueRun(data);

      expect(job.id).toBe('job-1');
      expect(mockQueueAdd).toHaveBeenCalledWith('agent-run', data, {
        // normal band base; offset depends on queue depth for this workspace
        priority: expect.any(Number),
        delay: undefined,
        jobId: 'trace-abc',
        attempts: 1,
      });
      const arg = mockQueueAdd.mock.calls[0][2];
      expect(arg.priority).toBeGreaterThanOrEqual(10_000);
      expect(arg.priority).toBeLessThan(100_000);
    });

    it('high priority band is lower-numbered than normal', async () => {
      const data = makeJobData();
      await enqueueRun(data, 'high');

      const arg = mockQueueAdd.mock.calls[0][2];
      expect(arg.priority).toBeGreaterThanOrEqual(100);
      expect(arg.priority).toBeLessThan(10_000);
    });

    it('low priority band is higher-numbered than normal', async () => {
      const data = makeJobData();
      await enqueueRun(data, 'low');

      const arg = mockQueueAdd.mock.calls[0][2];
      expect(arg.priority).toBeGreaterThanOrEqual(100_000);
    });

    it('passes delay when provided', async () => {
      const data = makeJobData();
      await enqueueRun(data, 'normal', 5000);

      expect(mockQueueAdd).toHaveBeenCalledWith('agent-run', data, expect.objectContaining({
        delay: 5000,
      }));
    });

    it('uses traceId as jobId', async () => {
      const data = makeJobData({ traceId: 'my-trace-id' });
      await enqueueRun(data);

      expect(mockQueueAdd).toHaveBeenCalledWith('agent-run', data, expect.objectContaining({
        jobId: 'my-trace-id',
      }));
    });

    it('sets attempts to 1', async () => {
      const data = makeJobData();
      await enqueueRun(data);

      expect(mockQueueAdd).toHaveBeenCalledWith('agent-run', data, expect.objectContaining({
        attempts: 1,
      }));
    });
  });

  // ────────────────────────────────────────────────
  // checkRateLimit
  // ────────────────────────────────────────────────
  describe('checkRateLimit', () => {
    it('returns allowed:true when usage is below 90% threshold', async () => {
      mockRedisGet.mockResolvedValueOnce('10000');  // actual usage
      mockRedisGet.mockResolvedValueOnce('5000');   // inflight estimate

      const result = await checkRateLimit(TEST_WORKSPACE_ID);

      // totalUsage = 15000, limit = 80000, ratio = 0.1875
      expect(result.allowed).toBe(true);
      expect(result.usage).toBeCloseTo(0.1875, 4);
    });

    it('returns allowed:false when usage is at or above 90% threshold', async () => {
      mockRedisGet.mockResolvedValueOnce('70000');  // actual usage
      mockRedisGet.mockResolvedValueOnce('5000');   // inflight estimate

      const result = await checkRateLimit(TEST_WORKSPACE_ID);

      // totalUsage = 75000, limit = 80000, ratio = 0.9375
      expect(result.allowed).toBe(false);
      expect(result.usage).toBeGreaterThanOrEqual(0.9);
    });

    it('returns allowed:true with zero usage when no keys exist', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockRedisGet.mockResolvedValueOnce(null);

      const result = await checkRateLimit(TEST_WORKSPACE_ID);

      expect(result.allowed).toBe(true);
      expect(result.usage).toBe(0);
    });

    it('counts inflight tokens toward total usage', async () => {
      mockRedisGet.mockResolvedValueOnce('0');      // actual usage
      mockRedisGet.mockResolvedValueOnce('72001');  // inflight estimate >90% of 80000

      const result = await checkRateLimit(TEST_WORKSPACE_ID);

      expect(result.allowed).toBe(false);
    });

    it('returns allowed:true when exactly at 89% usage', async () => {
      // 89% of 80000 = 71200
      mockRedisGet.mockResolvedValueOnce('71200');
      mockRedisGet.mockResolvedValueOnce('0');

      const result = await checkRateLimit(TEST_WORKSPACE_ID);

      expect(result.allowed).toBe(true);
      expect(result.usage).toBeCloseTo(0.89, 2);
    });

    it('returns allowed:false when exactly at 90% usage', async () => {
      // 90% of 80000 = 72000
      mockRedisGet.mockResolvedValueOnce('72000');
      mockRedisGet.mockResolvedValueOnce('0');

      const result = await checkRateLimit(TEST_WORKSPACE_ID);

      expect(result.allowed).toBe(false);
      expect(result.usage).toBeCloseTo(0.9, 2);
    });
  });

  // ────────────────────────────────────────────────
  // recordTokenUsage
  // ────────────────────────────────────────────────
  describe('recordTokenUsage', () => {
    it('increments TPM key and sets TTL', async () => {
      mockRedisGet.mockResolvedValueOnce('100'); // remaining inflight > 0

      await recordTokenUsage(TEST_WORKSPACE_ID, 500);

      expect(mockRedisIncrby).toHaveBeenCalledWith(
        expect.stringContaining(`tinyhands:${TEST_WORKSPACE_ID}:rate_limiter:tpm:`),
        500,
      );
      expect(mockRedisExpire).toHaveBeenCalledWith(
        expect.stringContaining(`tinyhands:${TEST_WORKSPACE_ID}:rate_limiter:tpm:`),
        120,
      );
    });

    it('decreases inflight estimate by the recorded tokens', async () => {
      mockRedisGet.mockResolvedValueOnce('1000'); // remaining inflight

      await recordTokenUsage(TEST_WORKSPACE_ID, 300);

      expect(mockRedisDecrby).toHaveBeenCalledWith(`tinyhands:${TEST_WORKSPACE_ID}:inflight_tokens`, 300);
    });

    it('resets inflight to 0 when remaining goes negative', async () => {
      mockRedisGet.mockResolvedValueOnce('-50'); // negative remaining

      await recordTokenUsage(TEST_WORKSPACE_ID, 100);

      expect(mockRedisSet).toHaveBeenCalledWith(`tinyhands:${TEST_WORKSPACE_ID}:inflight_tokens`, '0');
    });

    it('does not reset inflight when remaining is positive', async () => {
      mockRedisGet.mockResolvedValueOnce('200'); // positive remaining

      await recordTokenUsage(TEST_WORKSPACE_ID, 100);

      expect(mockRedisSet).not.toHaveBeenCalledWith(`tinyhands:${TEST_WORKSPACE_ID}:inflight_tokens`, '0');
    });

    it('does not reset inflight when remaining is null', async () => {
      mockRedisGet.mockResolvedValueOnce(null);

      await recordTokenUsage(TEST_WORKSPACE_ID, 100);

      expect(mockRedisSet).not.toHaveBeenCalledWith(`tinyhands:${TEST_WORKSPACE_ID}:inflight_tokens`, '0');
    });
  });

  // ────────────────────────────────────────────────
  // estimateInflightUsage
  // ────────────────────────────────────────────────
  describe('estimateInflightUsage', () => {
    it('increments inflight key and sets TTL', async () => {
      await estimateInflightUsage(TEST_WORKSPACE_ID, 2000);

      expect(mockRedisIncrby).toHaveBeenCalledWith(`tinyhands:${TEST_WORKSPACE_ID}:inflight_tokens`, 2000);
      expect(mockRedisExpire).toHaveBeenCalledWith(`tinyhands:${TEST_WORKSPACE_ID}:inflight_tokens`, 300);
    });
  });

  // ────────────────────────────────────────────────
  // checkRequestRate
  // ────────────────────────────────────────────────
  describe('checkRequestRate', () => {
    it('returns true when under RPM limit', async () => {
      mockRedisIncr.mockResolvedValueOnce(50);

      const result = await checkRequestRate(TEST_WORKSPACE_ID);

      expect(result).toBe(true);
      expect(mockRedisIncr).toHaveBeenCalledWith(
        expect.stringContaining(`tinyhands:${TEST_WORKSPACE_ID}:rate_limiter:rpm:`),
      );
      expect(mockRedisExpire).toHaveBeenCalledWith(
        expect.stringContaining(`tinyhands:${TEST_WORKSPACE_ID}:rate_limiter:rpm:`),
        120,
      );
    });

    it('returns true when exactly at RPM limit', async () => {
      mockRedisIncr.mockResolvedValueOnce(1000); // exactly at rpmLimit

      const result = await checkRequestRate(TEST_WORKSPACE_ID);

      expect(result).toBe(true);
    });

    it('returns false when over RPM limit', async () => {
      mockRedisIncr.mockResolvedValueOnce(1001); // over rpmLimit of 1000

      const result = await checkRequestRate(TEST_WORKSPACE_ID);

      expect(result).toBe(false);
    });
  });

  // ────────────────────────────────────────────────
  // handleRateLimitResponse
  // ────────────────────────────────────────────────
  describe('handleRateLimitResponse', () => {
    it('sets rate_limited flag with EX TTL', async () => {
      await handleRateLimitResponse(TEST_WORKSPACE_ID, 30);

      expect(mockRedisSet).toHaveBeenCalledWith(
        `tinyhands:${TEST_WORKSPACE_ID}:rate_limited`,
        '1',
        'EX',
        30,
      );
    });

    it('sets correct TTL from retryAfterSec param', async () => {
      await handleRateLimitResponse(TEST_WORKSPACE_ID, 120);

      expect(mockRedisSet).toHaveBeenCalledWith(
        `tinyhands:${TEST_WORKSPACE_ID}:rate_limited`,
        '1',
        'EX',
        120,
      );
    });
  });

  // ────────────────────────────────────────────────
  // isRateLimited
  // ────────────────────────────────────────────────
  describe('isRateLimited', () => {
    it('returns true when rate_limited key is set to "1"', async () => {
      mockRedisGet.mockResolvedValueOnce('1');

      const result = await isRateLimited(TEST_WORKSPACE_ID);

      expect(result).toBe(true);
    });

    it('returns false when rate_limited key does not exist', async () => {
      mockRedisGet.mockResolvedValueOnce(null);

      const result = await isRateLimited(TEST_WORKSPACE_ID);

      expect(result).toBe(false);
    });

    it('returns false when rate_limited key has unexpected value', async () => {
      mockRedisGet.mockResolvedValueOnce('0');

      const result = await isRateLimited(TEST_WORKSPACE_ID);

      expect(result).toBe(false);
    });
  });

  // ────────────────────────────────────────────────
  // getQueueDepth
  // ────────────────────────────────────────────────
  describe('getQueueDepth', () => {
    it('returns sum of waiting and delayed job counts', async () => {
      mockQueueGetJobCounts.mockResolvedValueOnce({ waiting: 5, active: 2, delayed: 3 });

      const depth = await getQueueDepth();

      expect(depth).toBe(8); // 5 + 3
    });

    it('returns 0 when no jobs exist', async () => {
      mockQueueGetJobCounts.mockResolvedValueOnce({ waiting: 0, active: 0, delayed: 0 });

      const depth = await getQueueDepth();

      expect(depth).toBe(0);
    });

    it('handles missing fields by defaulting to 0', async () => {
      mockQueueGetJobCounts.mockResolvedValueOnce({});

      const depth = await getQueueDepth();

      expect(depth).toBe(0);
    });

    it('excludes active jobs from depth count', async () => {
      mockQueueGetJobCounts.mockResolvedValueOnce({ waiting: 10, active: 50, delayed: 5 });

      const depth = await getQueueDepth();

      expect(depth).toBe(15); // only waiting + delayed, not active
    });
  });

  // ────────────────────────────────────────────────
  // isDuplicateEvent
  // ────────────────────────────────────────────────
  describe('isDuplicateEvent', () => {
    it('returns false (not a duplicate) when SET NX succeeds', async () => {
      mockRedisSet.mockResolvedValueOnce('OK'); // key was newly set

      const result = await isDuplicateEvent(TEST_WORKSPACE_ID, 'event-123');

      expect(result).toBe(false);
      expect(mockRedisSet).toHaveBeenCalledWith(
        `tinyhands:${TEST_WORKSPACE_ID}:dedup:event-123`,
        '1',
        'EX',
        300,
        'NX',
      );
    });

    it('returns true (is a duplicate) when SET NX fails (key already exists)', async () => {
      mockRedisSet.mockResolvedValueOnce(null); // key already existed

      const result = await isDuplicateEvent(TEST_WORKSPACE_ID, 'event-123');

      expect(result).toBe(true);
    });

    it('uses the provided idempotency key in the Redis key', async () => {
      mockRedisSet.mockResolvedValueOnce('OK');

      await isDuplicateEvent(TEST_WORKSPACE_ID, 'webhook:my-agent:req-456');

      expect(mockRedisSet).toHaveBeenCalledWith(
        `tinyhands:${TEST_WORKSPACE_ID}:dedup:webhook:my-agent:req-456`,
        '1',
        'EX',
        300,
        'NX',
      );
    });

    it('uses 5-minute (300s) TTL for dedup window', async () => {
      mockRedisSet.mockResolvedValueOnce('OK');

      await isDuplicateEvent(TEST_WORKSPACE_ID, 'any-key');

      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.any(String),
        '1',
        'EX',
        300,
        'NX',
      );
    });
  });

  // ────────────────────────────────────────────────
  // createQueueEvents
  // ────────────────────────────────────────────────
  describe('createQueueEvents', () => {
    it('returns a QueueEvents instance', () => {
      const events = createQueueEvents();
      expect(events).toBeDefined();
      expect(events.close).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────
  // closeQueue
  // ────────────────────────────────────────────────
  describe('closeQueue', () => {
    it('closes the queue and redis connection', async () => {
      // Ensure the queue singleton is initialized
      getQueue();

      await closeQueue();

      expect(mockQueueClose).toHaveBeenCalled();
      expect(mockRedisQuit).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // setApprovalState / getApprovalState
  // ────────────────────────────────────────────────
  describe('setApprovalState', () => {
    it('sets approval state with custom TTL', async () => {
      await setApprovalState('T1', 'req-1', 'pending', 300);

      expect(mockRedisSet).toHaveBeenCalledWith(
        'tinyhands:T1:approval:req-1',
        'pending',
        'EX',
        300,
      );
    });

    it('sets approval state with default 1 hour TTL when no TTL provided', async () => {
      await setApprovalState('T1', 'req-2', 'approved');

      expect(mockRedisSet).toHaveBeenCalledWith(
        'tinyhands:T1:approval:req-2',
        'approved',
      );
      expect(mockRedisExpire).toHaveBeenCalledWith(
        'tinyhands:T1:approval:req-2',
        3600,
      );
    });

    it('sets denied state', async () => {
      await setApprovalState('T1', 'req-3', 'denied', 600);

      expect(mockRedisSet).toHaveBeenCalledWith(
        'tinyhands:T1:approval:req-3',
        'denied',
        'EX',
        600,
      );
    });
  });

  describe('getApprovalState', () => {
    it('returns the current approval state', async () => {
      mockRedisGet.mockResolvedValueOnce('approved');

      const result = await getApprovalState('T1', 'req-1');

      expect(result).toBe('approved');
      expect(mockRedisGet).toHaveBeenCalledWith('tinyhands:T1:approval:req-1');
    });

    it('returns null when request ID does not exist (expired)', async () => {
      mockRedisGet.mockResolvedValueOnce(null);

      const result = await getApprovalState('T1', 'req-expired');

      expect(result).toBeNull();
    });

    it('returns pending for a newly created request', async () => {
      mockRedisGet.mockResolvedValueOnce('pending');

      const result = await getApprovalState('T1', 'req-new');

      expect(result).toBe('pending');
    });
  });
});
