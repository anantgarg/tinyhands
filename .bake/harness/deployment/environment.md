# Environment & Configuration

## Required Environment Variables

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Slack app-level token for Socket Mode (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | Webhook signature verification |
| `ANTHROPIC_API_KEY` | Claude API access |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |

## Optional Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | Express server port |
| `LOG_LEVEL` | info | Winston log level (debug/info/warn/error) |
| `DOCKER_BASE_IMAGE` | — | Custom base image for agent containers |
| `DAILY_BUDGET_USD` | — | Daily spending cap for Claude API |
| `AUTO_UPDATE_ENABLED` | false | Enable pull-based auto-update |
| `ENCRYPTION_KEY` | — | 32+ char key for credential encryption (AES-256-GCM) |
| `GITHUB_TOKEN` | — | GitHub API access for KB sources |

## OAuth Providers (Optional)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth for Drive/Docs connections |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth secret |
| `NOTION_OAUTH_CLIENT_ID` | Notion OAuth for page connections |
| `NOTION_OAUTH_CLIENT_SECRET` | Notion OAuth secret |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth for repo connections |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth secret |
| `OAUTH_REDIRECT_BASE_URL` | Base URL for OAuth callback redirects |

## Setup

```bash
cp .env.example .env     # Copy template
# Edit .env with your credentials
docker compose up -d     # Start all services
```

Database migrations run automatically on startup via `deploy/docker-entrypoint.sh`.

## SSL Setup (First Time)

```bash
./deploy/init-letsencrypt.sh
```

Configures Let's Encrypt certificates and nginx SSL termination. Requires a domain name pointed at the server.
