import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  pipeline: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
};

vi.mock('ioredis', () => {
  return { default: vi.fn(() => mockRedis) };
});

vi.mock('../../src/config', () => ({
  config: {
    redis: { url: 'redis://localhost:6379' },
    slack: { botToken: 'xoxb-test' },
  },
}));

const mockUsersInfo = vi.fn();

vi.mock('../../src/slack', () => ({
  getSlackApp: () => ({
    client: {
      users: {
        info: (...args: any[]) => mockUsersInfo(...args),
      },
    },
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveUserName, resolveUserNames } from '../../src/api/helpers/user-resolver';

// ── Tests ──

describe('resolveUserName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached name from Redis', async () => {
    mockRedis.get.mockResolvedValueOnce('Alice');

    const name = await resolveUserName('U123');

    expect(name).toBe('Alice');
    expect(mockUsersInfo).not.toHaveBeenCalled();
  });

  it('calls Slack API when not cached', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockUsersInfo.mockResolvedValueOnce({
      user: { real_name: 'Bob Smith', name: 'bob' },
    });
    mockRedis.set.mockResolvedValueOnce('OK');

    const name = await resolveUserName('U456');

    expect(name).toBe('Bob Smith');
    expect(mockUsersInfo).toHaveBeenCalledWith({ user: 'U456' });
    expect(mockRedis.set).toHaveBeenCalledWith('user:name:U456', 'Bob Smith', 'EX', 3600);
  });

  it('falls back to name when real_name is missing', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockUsersInfo.mockResolvedValueOnce({
      user: { name: 'charlie' },
    });
    mockRedis.set.mockResolvedValueOnce('OK');

    const name = await resolveUserName('U789');

    expect(name).toBe('charlie');
  });

  it('returns userId as fallback when Slack API fails', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockUsersInfo.mockRejectedValueOnce(new Error('user_not_found'));

    const name = await resolveUserName('UBAD');

    expect(name).toBe('UBAD');
  });

  it('returns empty string as-is', async () => {
    const name = await resolveUserName('');
    expect(name).toBe('');
  });

  it('handles Redis cache read failure gracefully', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Redis down'));
    mockUsersInfo.mockResolvedValueOnce({
      user: { real_name: 'Dave' },
    });
    mockRedis.set.mockRejectedValueOnce(new Error('Redis down'));

    const name = await resolveUserName('U111');

    expect(name).toBe('Dave');
  });
});

describe('resolveUserNames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty object for empty array', async () => {
    const result = await resolveUserNames([]);

    expect(result).toEqual({});
  });

  it('deduplicates user IDs', async () => {
    mockRedis.pipeline.mockReturnValueOnce({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValueOnce([
        [null, 'Alice'],
        [null, 'Bob'],
      ]),
    });

    const result = await resolveUserNames(['U1', 'U1', 'U2', 'U2']);

    expect(result).toEqual({ U1: 'Alice', U2: 'Bob' });
  });

  it('resolves uncached users via Slack API', async () => {
    mockRedis.pipeline.mockReturnValueOnce({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValueOnce([
        [null, 'Alice'], // U1 cached
        [null, null],    // U2 not cached
      ]),
    });
    // For the uncached U2, resolveUserName will be called
    mockRedis.get.mockResolvedValueOnce(null);
    mockUsersInfo.mockResolvedValueOnce({
      user: { real_name: 'Bob' },
    });
    mockRedis.set.mockResolvedValueOnce('OK');

    const result = await resolveUserNames(['U1', 'U2']);

    expect(result).toEqual({ U1: 'Alice', U2: 'Bob' });
  });

  it('filters out falsy values', async () => {
    mockRedis.pipeline.mockReturnValueOnce({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValueOnce([
        [null, 'Alice'],
      ]),
    });

    const result = await resolveUserNames(['U1', '', null as any, undefined as any]);

    expect(result).toEqual({ U1: 'Alice' });
  });

  it('handles Redis pipeline failure gracefully', async () => {
    mockRedis.pipeline.mockReturnValueOnce({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValueOnce(new Error('Redis down')),
    });
    // Falls back to individual resolution
    mockRedis.get.mockResolvedValueOnce(null);
    mockUsersInfo.mockResolvedValueOnce({
      user: { real_name: 'Alice' },
    });
    mockRedis.set.mockResolvedValueOnce('OK');

    const result = await resolveUserNames(['U1']);

    expect(result).toEqual({ U1: 'Alice' });
  });
});
