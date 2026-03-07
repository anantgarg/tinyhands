# TinyJobs

**Slack-based command center for Claude Code agents.**

Create autonomous AI agents that live in Slack channels, connect to your data, trigger on events, and improve themselves over time — all powered by Claude Code CLI running in Docker-isolated containers.

---

## What is TinyJobs?

TinyJobs gives you a fleet of AI agents managed entirely through Slack. Each agent gets its own channel, its own persona, and its own tools. You talk to them like teammates. They run tasks autonomously using Claude Code, retrieve context from your connected sources, and learn from your feedback.

**Core mental model:** Every agent is Claude Code running in a Docker container. Slack is the interface. You provide the goal, tools, and context — Claude handles the rest.

### Key Features

- **Agent Management** — Create agents via `/new-agent` wizard. Each gets a dedicated Slack channel with custom identity.
- **Autonomous Task Execution** — BullMQ job queue dispatches tasks to Docker-isolated Claude Code containers with streaming output to Slack.
- **Self-Improvement** — Critique an agent's output in-thread and it proposes diffs to its own system prompt. Full version history, always reversible.
- **Source Connections** — Connect GitHub repos, Google Drive, local files. Retrieval-based context injection via FTS5 at run time.
- **Agent Memory** — Optional persistent memory across runs. Agents recall prior context without re-searching.
- **Event Triggers** — Fire agents on Slack messages, Linear updates, Zendesk tickets, or any webhook.
- **Skill Marketplace** — Attach MCP server integrations (Linear, Notion, GitHub) and prompt template skills.
- **Shared Knowledge Base** — Team-wide KB with FTS5 search, agent contributions with approval flow.
- **Multi-Step Workflows** — Stateful workflows with timers, branching, and human-in-the-loop via BullMQ.
- **Agent Teams** — Lead agents spawn sub-agents for parallel/delegated work.
- **Dashboard & Observability** — Slack Home Tab dashboard, structured logging, cost tracking, alerting.
- **Self-Evolution** — Agents write their own tools, create integrations, and commit code.
- **Per-Agent Permissions** — Three-axis model: tool access, integration access, Docker isolation.
- **Auto-Deploy** — GitHub webhook triggers `git pull` → rebuild → `pm2 reload` with zero-downtime.

## Architecture

```
SLACK WORKSPACE
  └── User messages → Bolt Socket Mode listener
  └── Webhooks (Linear, Zendesk, GitHub) → Express HTTP :3000

TINYJOBS CORE (Node.js — PM2 managed)
  ├── Slack Listener: receives messages, resolves agent, enqueues BullMQ jobs
  ├── Webhook Receiver: /webhooks/* endpoints for triggers and deploy
  ├── Background Sync: 15-min source re-index cycle
  └── Dashboard Publisher: views.publish on events

BULLMQ + REDIS
  ├── High priority (interactive) → Normal (triggers) → Low (background)
  ├── Token bucket rate limiter (Anthropic API)
  └── Delayed jobs for workflow timers

WORKERS (1–4 concurrent, PM2 managed)
  └── Worker pulls job → spawns Docker container → runs Claude Agent SDK
      → streams events to Slack → writes structured logs

DOCKER CONTAINERS (ephemeral, one per run)
  ├── Base image: tinyjobs-runner (Node.js + Claude Agent SDK + CLI tools)
  ├── Mounted: agent working dir (rw), source cache (ro), memory (ro)
  ├── Network: restricted allowlist per agent
  └── Destroyed after every run

DATA LAYER
  ├── SQLite: agents, versions, permissions, sources, chunks (FTS5), KB, workflows, memory
  ├── Redis: BullMQ jobs, rate limiter, trigger dedup cache
  └── Filesystem: agent working dirs, Docker volumes, JSON logs
```

## Quick Start

**Requirements:** Ubuntu 24.04 VPS with SSH access, 8+ GB RAM, Docker CE 24+.

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Install Node.js 20 + PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs && npm install -g pm2

# 3. Install Redis
apt-get install -y redis-server
systemctl enable redis-server

# 4. Clone TinyJobs
git clone https://github.com/anantgarg/tinyjobs.git /opt/tinyjobs
cd /opt/tinyjobs && npm install

# 5. Build Docker base image
docker build -t tinyjobs-runner:latest ./docker/

# 6. Configure environment
cp .env.example .env  # Edit with your credentials

# 7. Start
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

## Required Credentials

| Credential | Purpose |
|------------|---------|
| `SLACK_BOT_TOKEN` | Bot identity, posting messages as agent personas |
| `SLACK_APP_TOKEN` | Socket Mode connection |
| `SLACK_SIGNING_SECRET` | Webhook request verification |
| `ANTHROPIC_API_KEY` | Claude API access for all agent runs |
| `GITHUB_TOKEN` | Repo access for source connections & self-evolution |
| `GITHUB_WEBHOOK_SECRET` | Auto-deploy webhook verification |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Drive access (optional) |
| `REDIS_URL` | BullMQ + rate limiter (default: `redis://localhost:6379`) |

## VPS Sizing

| Resource | Minimum (5 agents) | Recommended (20+ agents) |
|----------|---------------------|--------------------------|
| CPU | 4 vCPUs | 8 vCPUs |
| RAM | 8 GB | 16 GB |
| Disk | 40 GB SSD | 100 GB SSD |

**Scaling ceiling:** 16 GB VPS handles 4 concurrent Docker agent runs. Beyond ~8 concurrent runs, either upgrade or split workers to a second machine (BullMQ supports remote workers via Redis URL).

## Tech Stack

| Component | Technology |
|-----------|------------|
| Slack interface | Bolt for Node.js (Socket Mode) |
| Webhook receiver | Express HTTP (port 3000) |
| Agent runner | Claude Agent SDK in Docker containers |
| Job queue | BullMQ + Redis |
| Rate limiter | Token bucket in Redis |
| Data store | SQLite (FTS5 for search) |
| Process management | PM2 |
| Container runtime | Docker (ephemeral per run) |
| Testing | Vitest + Testcontainers |

## Implementation Plan

See [PLAN.md](./PLAN.md) for the full multi-step implementation plan covering all 19 modules across 8 phases.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Anant Garg
