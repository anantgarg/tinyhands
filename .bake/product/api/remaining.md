# Remaining API Routes

## Auth (`/api/v1/auth`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/slack` | None | Redirect to Slack OAuth |
| GET | `/slack/callback` | Code | Slack OAuth callback, creates session |
| GET | `/me` | Required | Get current user info |
| POST | `/logout` | Required | Destroy session |

## Dashboard (`/api/v1/dashboard`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/metrics` | Required | Dashboard metrics (query: `days`) |
| GET | `/power-users` | Required | Top users by run count |
| GET | `/agent-creators` | Required | Top agent creators |
| GET | `/popular-agents` | Required | Popular agents by usage |
| GET | `/fleet` | Required | All agents |
| GET | `/recent-runs` | Required | Recent runs with agent info |
| GET | `/recent-activity` | Required | Recent audit activity |

## Runs (`/api/v1/runs`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | Required | List recent runs (query: `limit`) |
| GET | `/trace/:traceId` | Required | Get run by trace ID |
| GET | `/:id` | Required | Get run detail |

## Triggers (`/api/v1/triggers`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | Required | List triggers (query: `type?`) |
| GET | `/:id` | Required | Get trigger |
| POST | `/` | Required | Create trigger |
| PATCH | `/:id` | Required | Update trigger (enable/disable) |
| POST | `/:id/pause` | Required | Pause trigger |
| POST | `/:id/resume` | Required | Resume trigger |
| DELETE | `/:id` | Required | Delete trigger |

## Workflows (`/api/v1/workflows`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/definitions` | Required | List workflow definitions |
| GET | `/definitions/:id` | Required | Get workflow definition |
| POST | `/definitions` | Required | Create definition |
| GET | `/runs` | Required | List runs (query: `limit`) |
| GET | `/runs/:id` | Required | Get run |
| POST | `/definitions/:id/start` | Required | Start workflow |
| POST | `/runs/:id/resolve` | Required | Resolve human action |

## Evolution (`/api/v1/evolution`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/proposals` | Required | List proposals (query: `agentId?`, `status?`, `page`, `limit`) |
| GET | `/proposals/history/:agentId` | Required | Proposal history for agent |
| POST | `/proposals/:id/approve` | Required | Approve proposal |
| POST | `/proposals/:id/reject` | Required | Reject proposal |

## Observability (`/api/v1/observability`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/alert-rules` | Optional | List alert rules |
| GET | `/alerts` | Admin | Check current alerts |
| GET | `/error-rates` | Admin | Per-agent error rates |
| GET | `/error-log` | Admin | Error log (query: `days`, `agentId?`, `limit`) |

## Access Control (`/api/v1/access`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/platform-roles` | Admin | List platform admins |
| GET | `/platform-roles/:userId` | Admin | Get user's role |
| PUT | `/platform-roles/:userId` | Admin | Set platform role |
| DELETE | `/platform-roles/:userId` | Admin | Remove platform role |

## Audit (`/api/v1/audit`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | Admin | Get audit log (query: `agentId?`, `userId?`, `actionType?`, `page`, `limit`) |

## Skills (`/api/v1/skills`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/builtin` | Optional | List builtin skills |
| GET | `/` | Required | List workspace skills |
| POST | `/` | Admin | Create skill |
| PUT | `/:id` | Admin | Update skill |
| DELETE | `/:id` | Admin | Delete skill |
| POST | `/generate` | Admin | AI-generate skill |

## Settings (`/api/v1/settings`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | Admin | Get all workspace settings |
| PUT | `/:key` | Admin | Set workspace setting |

## Templates (`/api/v1/templates`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | Optional | List agent templates |
| GET | `/:id` | Optional | Get specific template |

## Chat (`/api/v1/chat`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/stream` | Required | SSE streaming AI chat |
| POST | `/` | Required | Non-streaming chat |

## Slack Helpers (`/api/v1/slack`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/channels` | Required | List all Slack channels |
| GET | `/users` | Required | List all Slack users |
