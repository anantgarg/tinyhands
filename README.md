# ✋ Tiny Hands

**Extra hands for your Slack workspace. Open-source, self-hosted, 16-bit.**

While big tech builds "Enterprise Agentic Operating Systems," we build extra hands. Create autonomous AI agents that live in your Slack channels, connect to your tools and data, and get work done through conversation. Your VPS, your keys, your hands.

---

## Deploy

**Docker Compose** (any server with Docker):

```bash
git clone https://github.com/anantgarg/tinyhands.git && cd tinyhands
cp .env.example .env   # fill in SLACK_* and ANTHROPIC_API_KEY
docker compose up -d
```

**Install script** (Ubuntu/Debian — installs Docker, configures everything interactively):

```bash
curl -sSL https://raw.githubusercontent.com/anantgarg/tinyhands/main/scripts/install.sh | sudo bash
```

---

## What is Tiny Hands?

Tiny Hands turns your Slack workspace into a crew of nimble AI teammates. Each hand gets its own channel, its own persona, its own tools, and its own knowledge. You talk to them like teammates — they juggle tasks autonomously using Claude, grab context from connected sources, and learn from feedback.

**Core idea:** Every agent is Claude running in a Docker container. Slack is the control plane. You describe the job, give it the right equipment — Claude does the rest.

---

## Who's in the Crew?

### Customer Support
- **Ticket triage hand** — Automatically categorize and route incoming Zendesk tickets by priority and topic
- **Help desk buddy** — Answer customer questions by searching your help center, internal docs, and past tickets
- **Escalation watcher** — Watch for tickets approaching SLA deadlines and alert the right team

### Sales
- **Lead enrichment hand** — When a contact form submission arrives, research the company and enrich the lead with firmographic data
- **Deal intel hand** — Summarize HubSpot deal activity, flag stalled deals, and prep account briefs before meetings
- **Competitive scout** — Monitor competitor websites and docs for changes, summarize weekly

### Engineering
- **PR reviewer** — Analyze pull requests on GitHub, flag potential issues, suggest improvements
- **Incident responder** — When an alert fires, gather context from logs, recent deploys, and related issues
- **Docs keeper** — Monitor code changes and flag when documentation is out of date

### Product
- **Feature request tracker** — Aggregate and categorize feature requests from Zendesk, Intercom, and Slack into themes
- **Release notes writer** — Pull merged PRs and Linear issues to draft release notes each sprint
- **User research hand** — Search across customer conversations and tickets to find patterns

### Operations & HR
- **Onboarding buddy** — Answer new hire questions from your internal wiki, HR docs, and company policies
- **Procurement hand** — Look up vendor information, compare quotes, and prep approval requests
- **Reporting hand** — Generate weekly metrics reports from PostHog, Zendesk, or HubSpot data

### Marketing
- **Content researcher** — Research topics by pulling from your knowledge base, competitor sites, and industry data
- **SEO monitor** — Track SERP rankings, monitor your docs and blog content, suggest optimization opportunities
- **Social listener** — Summarize brand mentions and competitor activity

---

## What Can They Do?

### Agent Management
- Run `/agents` to open the interactive dashboard — create, update, pause, resume, and delete agents all from one place
- Click **+ New Agent** — a guided 2-step flow asks _what_ the hand should do and _when_ it should run
- Use the overflow menu on any agent to update its goal, channels, or config
- Each hand gets a dedicated Slack channel with a custom avatar emoji and persona

### Tool Integrations
Register and manage third-party tool integrations entirely from Slack via `/tools`:

| Integration | Read Tools | Write Tools |
|-------------|-----------|-------------|
| **Zendesk** | Search tickets, get details, list groups/users | Create tickets, add comments, update priority/tags |
| **Linear** | Search issues, list projects/teams/cycles | Create/update issues, add comments, create projects |
| **PostHog** | Query events, get persons, list feature flags & insights | — (read-only) |
| **HubSpot** | Search contacts/deals/companies, list pipelines | Create/update contacts/deals/companies, add notes/tasks |
| **SerpAPI** | SERP rankings across Google, Bing, Yahoo | — (read-only) |

- Superadmins register tools by entering API credentials in Slack
- Any user can create agents with **read-only** tools
- **Write tools** require superadmin approval — a DM is sent to all admins when requested
- **Unconfigured tool detection** — if a tool exists but has no API key, the system blocks agent creation and prompts the admin to configure it

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

- **Step-by-step setup** — Adding a source walks you through API key configuration and source settings in a guided thread
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

### More Tricks
- **Autonomous Execution** — BullMQ job queue dispatches tasks to Docker-isolated Claude containers with real-time streaming status to Slack threads
- **Self-Improvement** — Critique an agent's output in-thread and it proposes diffs to its own system prompt. Full version history.
- **Agent Memory** — Optional persistent memory across runs
- **Schedule Triggers** — Run agents hourly, daily, or weekly with cron expressions. Timezone auto-detected from your Slack profile.
- **Event Triggers** — Fire agents on Slack messages, Linear updates, Zendesk tickets, or any webhook
- **Skills** — Attach MCP server integrations and prompt template skills
- **Multi-Step Workflows** — Stateful workflows with timers, branching, and human-in-the-loop
- **Agent Teams** — Lead agents spawn sub-agents for parallel/delegated work
- **Observability** — Structured logging, cost tracking, alerting
- **Self-Evolution** — Agents can write their own tools, create MCP configs, and update their prompts
- **Access Control** — Superadmin role for tool/KB management, per-agent owner/admin roles
- **Pull-Based Deploy** — Multiple deployments poll for updates automatically. No webhook needed.

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

TINY HANDS CORE (Node.js + TypeScript — PM2 managed)
  ├── Slack Listener    — receives messages, resolves agent, enqueues jobs
  ├── Webhook Receiver  — /webhooks/* endpoints for triggers and auto-deploy
  ├── Background Sync   — periodic source re-index + KB auto-sync
  ├── Scheduler         — cron-based schedule trigger evaluation (60s loop)
  └── Dashboard         — Slack Home Tab via views.publish

BULLMQ + REDIS
  ├── Priority queues: high (interactive) → normal (triggers) → low (background)
  ├── Token bucket rate limiter (Anthropic API)
  └── Delayed jobs for workflow timers

WORKERS (1–3 concurrent, PM2 managed)
  └── Worker pulls job → spawns Docker container → runs Claude Agent SDK
      → streams events to Slack → writes structured logs

DOCKER CONTAINERS (ephemeral, one per run)
  ├── Base image: tinyhands-runner (Node.js + Claude Agent SDK + tools)
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

- A server with 8+ GB RAM (Ubuntu 22.04+ recommended)
- A Slack workspace where you can install apps
- An Anthropic API key

### Option A: Docker Compose (any server)

Requires Docker with Compose plugin. Includes PostgreSQL and Redis — no external databases needed.

```bash
git clone https://github.com/anantgarg/tinyhands.git /opt/tinyhands
cd /opt/tinyhands
cp .env.example .env
```

Edit `.env` with your Slack and Anthropic credentials (see [Slack App Setup](#slack-app-setup) below), then:

```bash
docker compose up -d
```

This builds and starts everything: Tiny Hands, PostgreSQL, Redis, and the agent runner image.

### Option B: Install Script (Ubuntu/Debian)

Installs Docker, clones the repo, and walks you through configuration:

```bash
curl -sSL https://raw.githubusercontent.com/anantgarg/tinyhands/main/scripts/install.sh | sudo bash
```

### Option C: Manual Installation

<details>
<summary>Click to expand manual setup steps</summary>

#### 1. Install system dependencies

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

#### 2. Clone and install

```bash
git clone https://github.com/anantgarg/tinyhands.git /opt/tinyhands
cd /opt/tinyhands
npm install
```

#### 3. Build the Docker base image

```bash
docker build -t tinyhands-runner:latest ./docker/
```

#### 4. Set up PostgreSQL

Create a database and note the connection string:

```bash
# Example for managed Postgres (DigitalOcean, Supabase, etc.)
# Your DATABASE_URL will look like:
# postgresql://user:password@host:25060/tinyhands?sslmode=require
```

#### 5. Configure environment

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
AUTO_UPDATE_ENABLED=true          # Pull-based auto-deploy
AUTO_UPDATE_INTERVAL=300000       # Check every 5 minutes
LOG_LEVEL=info
DAILY_BUDGET_USD=50
MAX_CONCURRENT_WORKERS=3
```

#### 6. Run migrations and start

```bash
npm run build
npx tsx src/db/migrate.ts
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

This starts:
- **tinyhands-listener** — Slack event handler and slash command processor
- **tinyhands-worker-1/2/3** — Job workers that execute agent runs in Docker
- **tinyhands-sync** — Background sync for sources and auto-sync schedules
- **tinyhands-scheduler** — Cron-based schedule trigger evaluation

</details>

### Slack App Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** > **From scratch**
2. Enable **Socket Mode** under Settings and generate an App-Level Token (`xapp-...`)
3. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `channels:manage`, `channels:read`, `channels:history`, `channels:join`
   - `chat:write`, `chat:write.customize` (enables per-agent bot name and avatar)
   - `commands`
   - `users:read`
   - `reactions:read`, `reactions:write`
   - `files:read`
   - `groups:history`, `groups:write` (for private channel support)
   - `im:history`, `im:write` (for superadmin DM commands)
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

### Initialize Superadmin

The first user to run `/agents` is automatically promoted to superadmin. Superadmins can:
- Register and configure tool integrations
- Manage KB API keys and sources
- Approve write-tool access requests
- Manage all agents regardless of ownership

---

## Usage

### Creating an Agent

1. Run `/agents` and click **+ New Agent**
2. **Step 1:** Describe what you want the hand to do (e.g., "Enrich incoming leads with company data from their email domain")
3. **Step 2:** Choose when it should run — every message, when @mentioned, when relevant, on a schedule, or a combination
4. Pick a channel for the hand to live in (or create a new one)
5. Confirm — Tiny Hands auto-configures the name, model, tools, and system prompt
6. Message the agent in its channel — it responds autonomously

### Connecting Tool Integrations

1. Run `/tools` to see available integrations
2. Click **Register** on an integration (e.g., Zendesk)
3. Enter your API credentials
4. The tool is now available for agents to use

### Setting Up the Knowledge Base

1. Run `/kb` to open the KB dashboard
2. Click **Add Source** — a guided thread walks you through:
   - Selecting the source type (Google Drive, GitHub, Website, etc.)
   - Entering API keys (if not already configured — with step-by-step instructions)
   - Configuring source-specific settings (folder ID, repo name, URL, etc.)
3. The source syncs automatically — use the overflow menu to re-sync or toggle auto-sync
4. Agents automatically search the KB for relevant context during runs

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
| `AUTO_UPDATE_ENABLED` | No | Enable pull-based auto-deploy (default: `false`) |
| `AUTO_UPDATE_INTERVAL` | No | Auto-update check interval in ms (default: `300000`) |
| `PORT` | No | HTTP server port (default: `3000`) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |
| `DAILY_BUDGET_USD` | No | Daily spend alert threshold (default: `50`) |
| `MAX_CONCURRENT_WORKERS` | No | Worker concurrency (default: `3`) |
| `DOCKER_BASE_IMAGE` | No | Docker image for agent runs (default: `tinyhands-runner:latest`) |

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

## FAQ

**Q: Why "Tiny" Hands?**
**A:** Big hands are clumsy. They break CSS, they accidentally delete production databases, and they cost $200k in consulting fees. Tiny hands are for precision. They are nimble enough to slide into your Slack threads and get work done without making a mess.

**Q: Are the hands "autonomous"?**
**A:** Yes, but they aren't anarchists. They'll do the work, but if they need to "write" something (like a merge or a payment), they'll ask you for a high-five first. ✋

---

## Guides

- **[Product Guide](./PRODUCT_GUIDE.md)** — For all users: how to create agents, talk to them, use DMs, manage settings, and more.
- **[Admin Guide](./ADMIN_GUIDE.md)** — For superadmins: setup, integrations, knowledge base, access control, and ongoing management.

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Anant Garg

✋ *High five to the open-source community. Our hands are tiny, but together they're mighty.*
