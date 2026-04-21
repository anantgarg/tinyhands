/**
 * Per-page Redis advisory locks for the wiki ingest pipeline.
 *
 * Acquired in path-sorted order (deadlock prevention) before the LLM call,
 * released after the apply transaction commits or on job failure. The TTL
 * is the safety net — if a worker dies mid-pass, locks expire and other
 * jobs proceed, with the optimistic `expected_prior_revision` check
 * catching any actual conflict.
 */
import { getRedisConnection, rkey } from '../../queue';
import { logger } from '../../utils/logger';
import type { WikiNamespace } from '../../types';

const LOCK_TTL_SECONDS = 90;
const ACQUIRE_DEADLINE_MS = 5_000;

export interface PageLock {
  release(): Promise<void>;
}

/**
 * Acquire locks for all paths atomically. Either all acquired (returns a
 * PageLock that releases everything) or throws — partial acquisition is
 * unwound automatically.
 */
export async function acquirePageLocks(
  workspaceId: string,
  namespace: WikiNamespace,
  paths: string[],
): Promise<PageLock> {
  const sorted = [...new Set(paths)].sort();
  const redis = getRedisConnection();
  const acquired: string[] = [];
  const tokens = new Map<string, string>();
  const deadline = Date.now() + ACQUIRE_DEADLINE_MS;

  try {
    for (const path of sorted) {
      const key = rkey(workspaceId, 'kb-wiki-page', namespace, path);
      const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      let got = false;
      while (Date.now() < deadline) {
        const ok = await redis.set(key, token, 'EX', LOCK_TTL_SECONDS, 'NX');
        if (ok === 'OK') { got = true; break; }
        await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
      }
      if (!got) {
        throw new Error(`Could not acquire lock for ${path} within ${ACQUIRE_DEADLINE_MS}ms`);
      }
      acquired.push(key);
      tokens.set(key, token);
    }
  } catch (err) {
    // Unwind anything we did grab
    for (const key of acquired) {
      const token = tokens.get(key);
      if (token) await releaseIfMatches(key, token);
    }
    throw err;
  }

  return {
    async release() {
      for (const key of acquired) {
        const token = tokens.get(key);
        if (token) await releaseIfMatches(key, token);
      }
    },
  };
}

async function releaseIfMatches(key: string, token: string): Promise<void> {
  const redis = getRedisConnection();
  // Lua: only delete if token matches (avoid releasing a lock another job
  // re-acquired after our TTL expired).
  const lua = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
  try {
    await (redis as any).eval(lua, 1, key, token);
  } catch (err: any) {
    logger.warn('Failed to release wiki page lock', { key, error: err.message });
  }
}
