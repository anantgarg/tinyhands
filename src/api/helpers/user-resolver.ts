import Redis from 'ioredis';
import { config } from '../../config';
import { logger } from '../../utils/logger';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redis.url, { maxRetriesPerRequest: 1, lazyConnect: true });
    redis.connect().catch(() => {
      // Silently handle connection errors — fallback to uncached lookups
    });
  }
  return redis;
}

const CACHE_TTL = 3600; // 1 hour

export async function resolveUserName(userId: string): Promise<string> {
  if (!userId) return userId;

  // Check Redis cache first
  try {
    const cached = await getRedis().get(`user:name:${userId}`);
    if (cached) return cached;
  } catch {
    // Redis unavailable, proceed with Slack lookup
  }

  try {
    const { getSlackApp } = await import('../../slack');
    const client = getSlackApp().client;
    const result = await client.users.info({ user: userId });
    const name = result.user?.real_name || result.user?.name || userId;

    // Cache for 1 hour
    try {
      await getRedis().set(`user:name:${userId}`, name, 'EX', CACHE_TTL);
    } catch {
      // Cache write failure is non-fatal
    }

    return name;
  } catch (err) {
    logger.debug('Failed to resolve user name', { userId, error: String(err) });
    return userId; // Fallback to raw ID
  }
}

export async function resolveUserNames(userIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const result: Record<string, string> = {};

  // Check cache for all
  try {
    const pipeline = getRedis().pipeline();
    for (const id of unique) pipeline.get(`user:name:${id}`);
    const cached = await pipeline.exec();

    const uncached: string[] = [];
    for (let i = 0; i < unique.length; i++) {
      const val = cached?.[i]?.[1] as string | null;
      if (val) {
        result[unique[i]] = val;
      } else {
        uncached.push(unique[i]);
      }
    }

    // Resolve uncached via Slack API
    for (const id of uncached) {
      result[id] = await resolveUserName(id);
    }
  } catch {
    // Redis pipeline failed — resolve all individually
    for (const id of unique) {
      result[id] = await resolveUserName(id);
    }
  }

  return result;
}
