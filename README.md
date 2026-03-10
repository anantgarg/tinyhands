```
 _____ _             _       _
|_   _(_)_ __  _   _| | ___ | |__  ___
  | | | | '_ \| | | | |/ _ \| '_ \/ __|
  | | | | | | | |_| | | (_) | |_) \__ \
  |_| |_|_| |_|\__, |_|\___/|_.__/|___/
               |___/
```

# TinyJobs

**Slack-native AI agent platform powered by Claude.**

Create autonomous AI agents that live in Slack channels, connect to your tools and data, and get work done — all managed through slash commands and interactive modals. No dashboards, no web UIs. Just Slack.

---

## What is TinyJobs?

TinyJobs turns your Slack workspace into an AI operations center. Each agent gets its own channel, its own persona, its own tools, and its own knowledge. You talk to agents like teammates — they run tasks autonomously using Claude, pull context from connected sources, and learn from feedback.

**Core idea:** Every agent is Claude running in a Docker container. Slack is the control plane. You provide the goal, tools, and context — Claude handles the rest.

---

## Features

### Agent Management
- Run `/agents` to open the interactive agent dashboard — create, update, pause, resume, and delete agents all from one place
- Click **+ New Agent** and describe what you want in plain English — TinyJobs picks the right model, tools, and settings
- Use the overflow menu on any agent to update its goal, channels, or config
- Each agent gets a dedicated Slack channel with a custom avatar emoji and persona

### Tool Integrations
Register and manage third-party tool integrations entirely from Slack via `/tools`:

| Integration | Read Tools | Write Tools |
|-------------|-----------|-------------|
| **Zendesk** | Search tickets, get details, list groups/users | Create tickets, add comments, update priority/tags |
| **Linear** | Search issues, list projects/teams/cycles | Create/update issues, add comments, create projects |
| **PostHog** | Query events, get persons, list feature flags & insights | — (read-only) |
| **HubSpot** | Search contacts/deals/companies, list pipelines | Create/update contacts/deals/companies, add notes/tasks |

- Superadmins register tools by entering API credentials in Slack modals
- Any user can create agents with **read-only** tools
- **Write tools** require superadmin approval — a DM is sent to all admins when requested

### Knowledge Base
Manage a shared knowledge base via `/kb`:

| Source Type | Description |
|-------------|-------------|
| **Google Drive** | Import docs, sheets, PDFs from Drive folders. Google Docs/Sheets exported as text. |
| **Zendesk Help Center** | Import published help center articles |
| **Website** | Scrape and import content from any website or documentation site |
| **GitHub** | Import docs, READMEs, source code — with **Mintlify docs** auto-detection |
| **HubSpot KB** | Import knowledge base articles from HubSpot CMS |
| **Linear Docs** | Import project documents and optionally issues from Linear |

- **API Keys** managed per provider from Slack — guided setup instructions for each
- **Auto-sync** with configurable intervals (default 24h)
- **Flush & Re-sync** to start fresh
- Full-text search via PostgreSQL `tsvector` + GIN indexes
- Manual entries with approval workflow for agent-contributed content

### Mintlify Docs Support
The GitHub connector automatically detects Mintlify documentation projects:
- Finds `docs.json` or `mint.json` in the repo
- Parses the navigation structure to discover all pages
- Fetches MDX files, strips JSX components, extracts YAML frontmatter
- Creates properly categorized KB entries with titles and descriptions from frontmatter

### More Features
- **Autonomous Execution** — BullMQ job queue dispatches tasks to Docker-isolated Claude containers with streaming output to Slack threads
- **Self-Improvement** — Critique an agent's output in-thread and it proposes diffs to its own system prompt. Full version history.
- **Agent Memory** — Optional persistent memory across runs
- **Event Triggers** — Fire agents on Slack messages, Linear updates, Zendesk tickets, or any webhook
- **Skills** — Attach MCP server integrations and prompt template skills
- **Multi-Step Workflows** — Stateful workflows with timers, branching, and human-in-the-loop
- **Agent Teams** — Lead agents spawn sub-agents for parallel/delegated work
- **Observability** — Structured logging, cost tracking, alerting
- **Self-Evolution** — Agents can write their own tools, create MCP configs, and update their prompts
- **Access Control** — Superadmin role for tool/KB management, per-agent owner/admin roles

---

## Slack Commands

| Command | Description |
|---------|-------------|
| `/agents` | Interactive agent dashboard — create, update, pause, resume, delete |
| `/tools` | View registered tool integrations, register new ones |
| `/kb` | Knowledge base dashboard — sources, entries, API keys |

---

## Architecture

```
SLACK WORKSPACE
  └── Slash commands + messages → Bolt Socket Mode listener
  └── Webhooks (Linear, Zendesk, GitHub) → Express HTTP :3000

TINYJOBS CORE (Node.js + TypeScript — PM2 managed)
  ├── Slack Listener    — receives messages, resolves agent, enqueues jobs
  ├── Webhook Receiver  — /webhooks/* endpoints for triggers and auto-deploy
  ├── Background Sync   — periodic source re-index + KB auto-sync
  └── Dashboard         — Slack Home Tab via views.publish

BULLMQ + REDIS
  ├── Priority queues: high (interactive) → normal (triggers) → low (background)
  ├── Token bucket rate limiter (Anthropic API)
  └── Delayed jobs for workflow timers

WORKERS (1–3 concurrent, PM2 managed)
  └── Worker pulls job → spawns Docker container → runs Claude Agent SDK
      → streams events to Slack → writes structured logs

DOCKER CONTAINERS (ephemeral, one per run)
  ├── Base image: tinyjobs-runner (Node.js + Claude Agent SDK + tools)
  ├── Mounted: agent working dir (rw), source cache (ro), memory (ro)
  └── Tool configs injected as /tools/{name}.config.json

DATA LAYER
  ├── PostgreSQL: agents, versions, permissions, sources, KB (FTS), workflows, memory
  ├── Redis: BullMQ jobs, rate limiter, trigger dedup cache
  └── Filesystem: agent working dirs, Docker volumes, JSON logs
```

---

## Installation

### Prerequisites

- Ubuntu 22.04+ (or any Linux VPS) with 8+ GB RAM
- Docker CE 24+
- Node.js 20+
- Redis 7+
- PostgreSQL 15+ (managed or self-hosted)

### 1. Install system dependencies

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# PM2
npm install -g pm2

# Redis
apt-get install -y redis-server
systemctl enable redis-server
```

### 2. Clone and install

```bash
git clone https://github.com/anantgarg/tinyjobs.git /opt/tinyjobs
cd /opt/tinyjobs
npm install
```

### 3. Build the Docker base image

```bash
docker build -t tinyjobs-runner:latest ./docker/
```

### 4. Set up PostgreSQL

Create a database and note the connection string:

```bash
# Example for managed Postgres (DigitalOcean, Supabase, etc.)
# Your DATABASE_URL will look like:
# postgresql://user:password@host:25060/tinyjobs?sslmode=require
```

### 5. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Required
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379

# Optional
GITHUB_TOKEN=ghp_...              # For auto-deploy webhook
GITHUB_WEBHOOK_SECRET=...         # For auto-deploy verification
LOG_LEVEL=info
DAILY_BUDGET_USD=50
MAX_CONCURRENT_WORKERS=3
```

### 6. Run migrations

```bash
npm run build
npx tsx src/db/migrate.ts
```

### 7. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** > **From scratch**
2. Enable **Socket Mode** under Settings and generate an App-Level Token (`xapp-...`)
3. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `channels:manage`, `channels:read`, `channels:history`, `channels:join`
   - `chat:write`, `chat:write.customize`
   - `commands`
   - `users:read`
   - `reactions:read`, `reactions:write`
   - `files:read`
4. Under **Slash Commands**, create:
   - `/agents` — Manage AI agents
   - `/tools` — Manage tool integrations
   - `/kb` — Knowledge base dashboard
5. Under **Interactivity & Shortcuts**, enable Interactivity
6. Under **Event Subscriptions**, subscribe to bot events:
   - `message.channels`, `message.im`, `app_mention`
   - `reaction_added`
   - `app_home_opened`
7. Install the app to your workspace and copy the Bot Token (`xoxb-...`)

### 8. Start TinyJobs

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

This starts:
- **tinyjobs-listener** — Slack event handler and slash command processor
- **tinyjobs-worker-1/2/3** — Job workers that execute agent runs in Docker
- **tinyjobs-sync** — Background sync for sources and auto-sync schedules

### 9. Initialize superadmin

The first user to run `/agents` is automatically promoted to superadmin. Superadmins can:
- Register and configure tool integrations
- Manage KB API keys and sources
- Approve write-tool access requests
- Manage all agents regardless of ownership

---

## Usage

### Creating an Agent

1. Run `/agents` and click **+ New Agent**
2. Describe what you want the agent to do in plain English (e.g., "A customer support agent that can look up Zendesk tickets and answer questions from our help docs")
3. TinyJobs analyzes your goal and suggests a name, model, tools, and system prompt
4. Confirm, and a new Slack channel is created for your agent
5. Message the agent in its channel — it responds autonomously

### Connecting Tool Integrations

1. Run `/tools` to see available integrations
2. Click **Register** on an integration (e.g., Zendesk)
3. Enter your API credentials in the modal
4. The tool is now available for agents to use

### Setting Up the Knowledge Base

1. Run `/kb` to open the KB dashboard
2. Click **API Keys** to configure provider credentials (e.g., Firecrawl for website scraping, GitHub token for repo access)
3. Click **Add Source** to connect a data source
4. Use the overflow menu (**...**) on a source to **Sync Now**, **Flush & Re-sync**, or toggle **Auto-sync**
5. Agents automatically search the KB for relevant context during runs

### Managing Agents

Run `/agents` to see all agents. Use the overflow menu on any agent to:
- **View Config** — See the agent's full system prompt, tools, and settings
- **Update** — Change the agent's goal or channels
- **Pause/Resume** — Temporarily disable an agent
- **Delete** — Remove the agent and its channel

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-level token for Socket Mode (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | Yes | Request verification |
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis for BullMQ (default: `redis://localhost:6379`) |
| `GITHUB_TOKEN` | No | For source connections and auto-deploy |
| `GITHUB_WEBHOOK_SECRET` | No | Auto-deploy webhook verification |
| `PORT` | No | HTTP server port (default: `3000`) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |
| `DAILY_BUDGET_USD` | No | Daily spend alert threshold (default: `50`) |
| `MAX_CONCURRENT_WORKERS` | No | Worker concurrency (default: `3`) |
| `DOCKER_BASE_IMAGE` | No | Docker image for agent runs (default: `tinyjobs-runner:latest`) |

---

## VPS Sizing

| Resource | Minimum (5 agents) | Recommended (20+ agents) |
|----------|---------------------|--------------------------|
| CPU | 4 vCPUs | 8 vCPUs |
| RAM | 8 GB | 16 GB |
| Disk | 40 GB SSD | 100 GB SSD |

16 GB handles ~4 concurrent Docker agent runs. Beyond ~8 concurrent runs, upgrade or split workers to a second machine (BullMQ supports remote workers via shared Redis).

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (Node.js, ES2022) |
| Slack SDK | Bolt for Node.js (Socket Mode) |
| AI | Claude Agent SDK + Anthropic API |
| Database | PostgreSQL (FTS via tsvector + GIN) |
| Job Queue | BullMQ + Redis |
| Containers | Docker (ephemeral per run) |
| Process Manager | PM2 |
| HTTP Server | Express |
| Logging | Winston |

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Anant Garg
