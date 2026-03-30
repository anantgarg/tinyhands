import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should use default values when env vars are not set', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_TPM_LIMIT;
    delete process.env.ANTHROPIC_RPM_LIMIT;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.PORT;
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    delete process.env.DAILY_DIGEST_TIME;
    delete process.env.DAILY_BUDGET_USD;
    delete process.env.DOCKER_BASE_IMAGE;
    delete process.env.DEFAULT_CONTAINER_CPU;
    delete process.env.DEFAULT_CONTAINER_MEMORY;
    delete process.env.DEFAULT_JOB_TIMEOUT_MS;
    delete process.env.MAX_CONCURRENT_WORKERS;

    const { config } = await import('../../src/config');

    expect(config.slack.botToken).toBe('');
    expect(config.anthropic.tpmLimit).toBe(80000);
    expect(config.anthropic.rpmLimit).toBe(1000);
    expect(config.database.url).toBe('postgresql://localhost:5432/tinyhands');
    expect(config.redis.url).toBe('redis://localhost:6379');
    expect(config.server.port).toBe(3000);
    expect(config.server.nodeEnv).toBe('development');
    expect(config.observability.logLevel).toBe('info');
    expect(config.observability.dailyDigestTime).toBe('09:00');
    expect(config.observability.dailyBudgetUsd).toBe(50);
    expect(config.docker.baseImage).toBe('tinyhands-runner:latest');
    expect(config.docker.defaultCpu).toBe(1);
    expect(config.docker.defaultMemory).toBe(2147483648);
    expect(config.docker.defaultJobTimeoutMs).toBe(3600000);
    expect(config.docker.maxConcurrentWorkers).toBe(3);
    // Encryption and OAuth defaults
    expect(config.encryption.key).toBe('');
    expect(config.oauth.googleClientId).toBe('');
    expect(config.oauth.googleClientSecret).toBe('');
    expect(config.oauth.notionClientId).toBe('');
    expect(config.oauth.notionClientSecret).toBe('');
    expect(config.oauth.githubClientId).toBe('');
    expect(config.oauth.githubClientSecret).toBe('');
    expect(config.oauth.redirectBaseUrl).toBe('http://localhost:3000');
  });

  it('should read env vars when set', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.ANTHROPIC_TPM_LIMIT = '50000';
    process.env.PORT = '8080';
    process.env.NODE_ENV = 'production';
    process.env.DAILY_BUDGET_USD = '100';
    process.env.MAX_CONCURRENT_WORKERS = '5';

    const { config } = await import('../../src/config');

    expect(config.slack.botToken).toBe('xoxb-test');
    expect(config.slack.appToken).toBe('xapp-test');
    expect(config.anthropic.apiKey).toBe('sk-ant-test');
    expect(config.anthropic.tpmLimit).toBe(50000);
    expect(config.server.port).toBe(8080);
    expect(config.server.nodeEnv).toBe('production');
    expect(config.observability.dailyBudgetUsd).toBe(100);
    expect(config.docker.maxConcurrentWorkers).toBe(5);
  });
});
