import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TEST_QUEUE_NAME = 'tinyhands-integration-test';

let connection: IORedis;

beforeAll(() => {
  connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
});

afterAll(async () => {
  await connection.quit();
});

describe('Redis connectivity', () => {
  it('should connect to Redis and respond to PING', async () => {
    const result = await connection.ping();
    expect(result).toBe('PONG');
  });

  it('should set and get a key', async () => {
    await connection.set('integration-test-key', 'hello');
    const value = await connection.get('integration-test-key');
    expect(value).toBe('hello');
    await connection.del('integration-test-key');
  });
});

describe('BullMQ queue operations', () => {
  let queue: Queue;
  let worker: Worker;

  beforeAll(() => {
    queue = new Queue(TEST_QUEUE_NAME, { connection: { host: new URL(REDIS_URL).hostname, port: Number(new URL(REDIS_URL).port || 6379) } });
  });

  afterAll(async () => {
    if (worker) await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('should enqueue and process a job', async () => {
    const jobData = { agentId: 'test-agent', input: 'hello world' };

    const processed = new Promise<any>((resolve) => {
      worker = new Worker(
        TEST_QUEUE_NAME,
        async (job) => {
          resolve(job.data);
          return { success: true };
        },
        { connection: { host: new URL(REDIS_URL).hostname, port: Number(new URL(REDIS_URL).port || 6379) } },
      );
    });

    await queue.add('test-job', jobData);
    const result = await processed;
    expect(result).toEqual(jobData);
  });

  it('should report queue depth', async () => {
    // After processing, queue should be empty
    const counts = await queue.getJobCounts('waiting', 'delayed');
    expect(counts.waiting + counts.delayed).toBe(0);
  });

  it('should support job with custom options', async () => {
    // Close previous worker first
    if (worker) await worker.close();

    const processed = new Promise<any>((resolve) => {
      worker = new Worker(
        TEST_QUEUE_NAME,
        async (job) => {
          resolve({ data: job.data, name: job.name, opts: job.opts });
          return { success: true };
        },
        { connection: { host: new URL(REDIS_URL).hostname, port: Number(new URL(REDIS_URL).port || 6379) } },
      );
    });

    await queue.add('custom-job', { key: 'value' }, { priority: 1, attempts: 3 });
    const result = await processed;
    expect(result.data).toEqual({ key: 'value' });
    expect(result.name).toBe('custom-job');
    expect(result.opts.priority).toBe(1);
  });
});

describe('Redis deduplication pattern', () => {
  it('should support SET NX for deduplication', async () => {
    const key = 'dedup:integration-test:abc123';

    // First call should succeed (key doesn't exist)
    const first = await connection.set(key, '1', 'EX', 60, 'NX');
    expect(first).toBe('OK');

    // Second call should fail (key already exists)
    const second = await connection.set(key, '1', 'EX', 60, 'NX');
    expect(second).toBeNull();

    await connection.del(key);
  });
});
