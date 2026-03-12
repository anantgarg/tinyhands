#!/bin/bash
set -e

# Generate .env from container environment so PM2's ecosystem.config.js can read it
# (ecosystem.config.js uses dotenv to load .env — it reads from file, not process.env)
{
  for var in SLACK_BOT_TOKEN SLACK_APP_TOKEN SLACK_SIGNING_SECRET \
             ANTHROPIC_API_KEY ANTHROPIC_TPM_LIMIT ANTHROPIC_RPM_LIMIT \
             DATABASE_URL REDIS_URL PORT NODE_ENV LOG_LEVEL \
             GITHUB_TOKEN GITHUB_WEBHOOK_SECRET \
             DAILY_DIGEST_TIME DAILY_BUDGET_USD \
             DOCKER_BASE_IMAGE DEFAULT_CONTAINER_CPU DEFAULT_CONTAINER_MEMORY \
             DEFAULT_JOB_TIMEOUT_MS MAX_CONCURRENT_WORKERS \
             GOOGLE_SERVICE_ACCOUNT_KEY_PATH TINYJOBS_CHANNEL_ID \
             AUTO_UPDATE_ENABLED AUTO_UPDATE_INTERVAL \
             LINEAR_WEBHOOK_SECRET ZENDESK_WEBHOOK_SECRET INTERCOM_WEBHOOK_SECRET; do
    if [ -n "${!var:-}" ]; then
      echo "$var=${!var}"
    fi
  done
} > /app/.env

# Run database migrations
echo "Running database migrations..."
node dist/db/migrate.js

echo "Starting TinyJobs..."
exec "$@"
