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

// Cache key takes an optional workspaceId so cross-tenant user lookups never
// share cache entries. Slack user IDs (e.g. "U01ABC") are per-team-unique, so
// without the workspace prefix two different people in different workspaces
// could collide on the same ID.
function cacheKey(userId: string, workspaceId?: string): string {
  return workspaceId ? `user:name:${workspaceId}:${userId}` : `user:name:${userId}`;
}

export async function resolveUserName(userId: string, workspaceId?: string): Promise<string> {
  if (!userId) return userId;

  // Check Redis cache first
  try {
    const cached = await getRedis().get(cacheKey(userId, workspaceId));
    if (cached) return cached;
  } catch {
    // Redis unavailable, proceed with Slack lookup
  }

  try {
    const { getBotClient, getSystemSlackClient } = await import('../../slack');
    const client = workspaceId ? await getBotClient(workspaceId) : getSystemSlackClient();

    let name: string = userId;

    // Bot IDs start with B, regular users start with U/W
    if (userId.startsWith('B')) {
      try {
        const botResult = await client.bots.info({ bot: userId });
        name = botResult.bot?.name ? `${botResult.bot.name} (bot)` : `Bot ${userId.slice(0, 6)}`;
      } catch {
        name = `Bot ${userId.slice(0, 6)}`;
      }
    } else {
      const result = await client.users.info({ user: userId });
      if (result.user?.is_bot) {
        name = result.user?.real_name || result.user?.name || `Bot ${userId.slice(0, 6)}`;
      } else {
        name = result.user?.real_name || result.user?.name || userId;
      }
    }

    // Cache for 1 hour
    try {
      await getRedis().set(cacheKey(userId, workspaceId), name, 'EX', CACHE_TTL);
    } catch {
      // Cache write failure is non-fatal
    }

    return name;
  } catch (err) {
    logger.debug('Failed to resolve user name', { userId, error: String(err) });
    if (userId.startsWith('B')) return `Bot ${userId.slice(0, 6)}`;
    return userId;
  }
}

export async function resolveUserNames(userIds: string[], workspaceId?: string): Promise<Record<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const result: Record<string, string> = {};

  try {
    const pipeline = getRedis().pipeline();
    for (const id of unique) pipeline.get(cacheKey(id, workspaceId));
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

    for (const id of uncached) {
      result[id] = await resolveUserName(id, workspaceId);
    }
  } catch {
    for (const id of unique) {
      result[id] = await resolveUserName(id, workspaceId);
    }
  }

  return result;
}
