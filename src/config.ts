export const config = {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    appToken: process.env.SLACK_APP_TOKEN || '',
    signingSecret: process.env.SLACK_SIGNING_SECRET || '',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    tpmLimit: parseInt(process.env.ANTHROPIC_TPM_LIMIT || '80000', 10),
    rpmLimit: parseInt(process.env.ANTHROPIC_RPM_LIMIT || '1000', 10),
  },
  github: {
    token: process.env.GITHUB_TOKEN || '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  },
  google: {
    serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || '',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  observability: {
    logLevel: process.env.LOG_LEVEL || 'info',
    dailyDigestTime: process.env.DAILY_DIGEST_TIME || '09:00',
    dailyBudgetUsd: parseFloat(process.env.DAILY_BUDGET_USD || '50'),
  },
  docker: {
    baseImage: process.env.DOCKER_BASE_IMAGE || 'tinyjobs-runner:latest',
    defaultCpu: parseInt(process.env.DEFAULT_CONTAINER_CPU || '1', 10),
    defaultMemory: parseInt(process.env.DEFAULT_CONTAINER_MEMORY || '2147483648', 10),
    defaultJobTimeoutMs: parseInt(process.env.DEFAULT_JOB_TIMEOUT_MS || '600000', 10),
    maxConcurrentWorkers: parseInt(process.env.MAX_CONCURRENT_WORKERS || '3', 10),
  },
};
