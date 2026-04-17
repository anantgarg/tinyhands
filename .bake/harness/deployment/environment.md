# Environment & Configuration

## Required Environment Variables

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) — bootstraps the first workspace on startup; after installs go through `/auth/slack/install`, each workspace has its own bot token in the DB |
| `SLACK_APP_TOKEN` | Slack app-level token for Socket Mode (`xapp-...`) — platform-owned, single token for all workspaces |
| `SLACK_SIGNING_SECRET` | Webhook signature verification — platform-owned |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | OAuth credentials for Sign in with Slack + the `/auth/slack/install` flow |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ENCRYPTION_KEY` | 32+ char key — encrypts per-workspace secrets (Anthropic key, tool credentials) via AES-256-GCM |
| `SESSION_SECRET` | Signs session cookies **and** OAuth `state` parameters. Must be a strong random value in production |

## Bootstrap-only Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | **Bootstrap only.** On first startup after upgrading to multi-tenant, this value is copied into workspace 1's encrypted `workspace_settings` and the env var is then ignored. After that, each workspace admin sets their own key in the dashboard. Safe to remove from `.env` once migration has run. |

## Optional Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | Express server port |
| `LOG_LEVEL` | info | Winston log level (debug/info/warn/error) |
| `DOCKER_BASE_IMAGE` | — | Custom base image for agent containers |
| `WORKER_CONCURRENCY` | 1 | Jobs processed in parallel per worker process |
| `DAILY_BUDGET_USD` | — | Daily spending cap for Claude API |
| `AUTO_UPDATE_ENABLED` | false | Enable pull-based auto-update |
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
