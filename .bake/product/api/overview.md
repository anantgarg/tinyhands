# API Overview

All API routes are served from `/api/v1` via Express. Authentication is session-based (Slack OAuth → Redis sessions).

## Authentication

- **Session auth**: Slack OAuth flow creates a session stored in Redis
- **Admin-only**: Requires platform admin or superadmin role
- **Agent roles**: owner / member / viewer — checked per-agent for modifications
- **Internal APIs**: Require `X-Internal-Secret` header (used by Docker runner containers)

## Route Files

Routes are defined in `src/api/routes/` and mounted in `src/server.ts`.

| Route File | Base Path | Purpose |
|-----------|-----------|---------|
| [auth.ts](auth.md) | `/api/v1/auth` | Slack OAuth, session, user info |
| [agents.ts](agents.md) | `/api/v1/agents` | Agent CRUD, roles, tools, skills, runs, memories |
| [kb.ts](kb.md) | `/api/v1/kb` | Knowledge base entries, sources, search |
| [docs.ts](docs.md) | `/api/v1/docs` | Documents, sheets, files, versions |
| [tools.ts](tools.md) | `/api/v1/tools` | Built-in tools, custom tools, integrations |
| [connections.ts](connections.md) | `/api/v1/connections` | OAuth connections, credentials |
| [triggers.ts](triggers.md) | `/api/v1/triggers` | Event triggers (Slack, Linear, webhook, cron) |
| [workflows.ts](workflows.md) | `/api/v1/workflows` | Multi-step workflow definitions and runs |
| [dashboard.ts](dashboard.md) | `/api/v1/dashboard` | Metrics, analytics, recent activity |
| [evolution.ts](evolution.md) | `/api/v1/evolution` | Self-improvement proposals |
| [observability.ts](observability.md) | `/api/v1/observability` | Error rates, alerts, logs |
| [access-control.ts](access-control.md) | `/api/v1/access` | Platform roles |
| [audit.ts](audit.md) | `/api/v1/audit` | Action audit log |
| [settings.ts](settings.md) | `/api/v1/settings` | Workspace settings |
| [skills.ts](skills.md) | `/api/v1/skills` | Skill management |
| [templates.ts](templates.md) | `/api/v1/templates` | Agent templates |
| [chat.ts](chat.md) | `/api/v1/chat` | Web dashboard AI chat |
| [runs.ts](runs.md) | `/api/v1/runs` | Execution history |
| [slack-helpers.ts](slack-helpers.md) | `/api/v1/slack` | Channel and user listings |

## Webhooks (No Auth)

Defined directly in `src/server.ts` with signature verification:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webhooks/github-deploy` | GitHub deploy webhook (signature verified) |
| POST | `/webhooks/agent-:agentName` | Generic agent webhook trigger |
| POST | `/webhooks/linear` | Linear issue events (signature verified) |
| POST | `/webhooks/zendesk` | Zendesk ticket events (signature verified) |
| POST | `/webhooks/intercom` | Intercom events (signature verified) |
| GET | `/auth/callback/:integration` | OAuth provider callbacks |
| GET | `/health` | Health check |

## Internal APIs (Runner Container Access)

Used by Docker containers during agent execution. Require `X-Internal-Secret` header.

| Path Prefix | Purpose |
|-------------|---------|
| `/internal/approval/*` | Write-policy approval request/poll |
| `/internal/kb/*` | Knowledge base search/list (in-container) |
| `/internal/docs/*` | Document CRUD (in-container) |
