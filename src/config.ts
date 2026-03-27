export const config = {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    appToken: process.env.SLACK_APP_TOKEN || '',
    signingSecret: process.env.SLACK_SIGNING_SECRET || '',
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
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
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/tinyhands',
    poolUrl: process.env.DATABASE_POOL_URL || '',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    internalSecret: process.env.INTERNAL_API_SECRET || '',
    sessionSecret: process.env.SESSION_SECRET || 'tinyhands-default-session-secret',
    webDashboardUrl: process.env.WEB_DASHBOARD_URL || '',
  },
  observability: {
    logLevel: process.env.LOG_LEVEL || 'info',
    dailyDigestTime: process.env.DAILY_DIGEST_TIME || '09:00',
    dailyBudgetUsd: parseFloat(process.env.DAILY_BUDGET_USD || '50'),
  },
  autoUpdate: {
    enabled: process.env.AUTO_UPDATE_ENABLED === 'true',
    intervalMs: parseInt(process.env.AUTO_UPDATE_INTERVAL || '300000', 10),
    branch: process.env.AUTO_UPDATE_BRANCH || 'main',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || '',
  },
  oauth: {
    googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    notionClientId: process.env.NOTION_OAUTH_CLIENT_ID || '',
    notionClientSecret: process.env.NOTION_OAUTH_CLIENT_SECRET || '',
    githubClientId: process.env.GITHUB_OAUTH_CLIENT_ID || '',
    githubClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || '',
    redirectBaseUrl: process.env.OAUTH_REDIRECT_BASE_URL || 'http://localhost:3000',
  },
  docker: {
    baseImage: process.env.DOCKER_BASE_IMAGE || 'tinyhands-runner:latest',
    defaultCpu: parseInt(process.env.DEFAULT_CONTAINER_CPU || '1', 10),
    defaultMemory: parseInt(process.env.DEFAULT_CONTAINER_MEMORY || '2147483648', 10),
    defaultJobTimeoutMs: parseInt(process.env.DEFAULT_JOB_TIMEOUT_MS || '1800000', 10),
    maxConcurrentWorkers: parseInt(process.env.MAX_CONCURRENT_WORKERS || '3', 10),
  },
};
