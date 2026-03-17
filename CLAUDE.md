# TinyHands

Self-hosted AI agent platform for Slack, powered by Claude. Agents live in Slack channels, connect to external tools and data sources, and execute tasks through conversation.

## Quick Reference

```bash
npm run dev              # Start listener (development)
npm run build            # Compile TypeScript
npm test                 # Unit tests (Vitest)
npm run test:integration # Integration tests (testcontainers)
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
```

Production runs via PM2 with 6 processes: listener, 3 workers, sync, scheduler.

## Architecture

```
Slack (Socket Mode) → Listener (src/index.ts)
                        ├── Slash commands (/agents, /tools, /kb)
                        ├── Message events → relevance check → enqueue job
                        └── Express server (webhooks, internal KB API)
                                ↓
                        BullMQ + Redis (priority queue, rate limiting)
                                ↓
                        Workers (src/worker.ts, 3 instances)
                        └── Docker container per run → Claude Agent SDK
```

### Processes

| Process | Entry | Purpose |
|---------|-------|---------|
| Listener | `src/index.ts` | Slack events, commands, webhooks, Express server |
| Worker (x3) | `src/worker.ts` | Dequeue jobs, run agents in Docker containers |
| Scheduler | `src/scheduler.ts` | Evaluate cron triggers every 60s |
| Sync | `src/sync.ts` | KB source sync, alerts, daily digest, auto-update |

## Project Structure

```
src/
├── index.ts, worker.ts, scheduler.ts, sync.ts    # Process entry points
├── server.ts                                       # Express routes (webhooks, internal APIs)
├── config.ts                                       # Env var config
├── db/
│   ├── index.ts                                    # PostgreSQL pool, query helpers
│   └── migrations/                                 # SQL migrations (001-009)
├── queue/index.ts                                  # BullMQ queue, Redis, rate limiting
├── slack/
│   ├── index.ts                                    # Bolt app setup
│   ├── commands.ts                                 # Slash command handlers
│   ├── events.ts                                   # Message/mention handlers
│   ├── actions.ts                                  # Interactive action handlers
│   └── buffer.ts                                   # Real-time streaming to Slack
├── modules/
│   ├── agents/              # Agent CRUD, goal analyzer (Claude-powered config gen)
│   ├── access-control/      # Superadmins, per-agent roles, permissions
│   ├── execution/           # Docker container lifecycle, Claude SDK, token tracking
│   ├── tools/               # Tool registry + integrations (see below)
│   ├── knowledge-base/      # KB entries, full-text search (tsvector + GIN)
│   ├── kb-sources/          # KB source connectors (GitHub, Drive, Zendesk, web)
│   ├── kb-wizard/           # Guided KB source setup flow
│   ├── sources/             # Agent data sources (GitHub, Google Drive, memory)
│   ├── triggers/            # Trigger types: slack, linear, zendesk, intercom, webhook, schedule
│   ├── workflows/           # Multi-step stateful workflows (DAG of steps)
│   ├── teams/               # Multi-agent orchestration
│   ├── skills/              # MCP integrations + prompt template skills
│   ├── self-evolution/      # Agent improvement proposals + approval
│   ├── self-improvement/    # Critique detection, prompt refinement
│   ├── self-authoring/      # Agent-created tools, code artifacts, MCPs
│   ├── model-selection/     # Runtime model override (/opus, /sonnet, /haiku)
│   ├── observability/       # Cost tracking, error rates, alerts, daily digest
│   ├── dashboard/           # Slack Home Tab metrics
│   ├── document-filling/    # Google Docs/Sheets template automation
│   ├── auto-update/         # Pull-based deploy from GitHub
│   └── permissions/         # Tool access control (read-only vs read-write)
├── types/index.ts           # All TypeScript interfaces
└── utils/                   # Logger, costs, chunker, Slack formatting, webhooks
```

## Database

PostgreSQL with migrations in `src/db/migrations/`. Key tables:

- **agents** — Agent config (name, system_prompt, tools[], model, visibility, channels)
- **run_history** — Execution records (tokens, cost, duration, status, trace_id)
- **custom_tools** — Tool definitions (schema, code, config, access_level)
- **kb_entries** — Knowledge base articles (full-text search via tsvector)
- **kb_sources** — KB source configs (auto-sync, connectors)
- **triggers** — Agent activation rules (cron, webhook, event-based)
- **sources** / **source_chunks** — Agent data sources and indexed content
- **agent_memories** — Persistent cross-run memory (facts, categories, relevance)
- **workflow_definitions** / **workflow_runs** — Multi-step automation state
- **evolution_proposals** — Agent self-improvement proposals
- **superadmins**, **agent_admins**, **agent_members** — Access control

Query helpers: `query()`, `queryOne()`, `execute()` from `src/db/index.ts`.

## Tool Integration System

Tools live in `src/modules/tools/integrations/`. Each tool is a self-contained folder.

### Existing integrations

| Tool | Folder | Access | Config Keys |
|------|--------|--------|-------------|
| Chargebee | `integrations/chargebee/` | read + write | `api_key`, `site` |
| HubSpot | `integrations/hubspot/` | read + write | `access_token` |
| Linear | `integrations/linear/` | read + write | `api_key` |
| Zendesk | `integrations/zendesk/` | read + write | `subdomain`, `email`, `api_token` |
| PostHog | `integrations/posthog/` | read-only | `api_key`, `project_id` |
| SerpAPI | `integrations/serpapi/` | read-only | `api_key` |
| Knowledge Base | `integrations/kb/` | read-only | (auto-configured) |

### Adding a new tool

Use `/add-tool <service name>` to get guided instructions, or follow this pattern:

1. Create `src/modules/tools/integrations/<name>/index.ts`
2. Export a `manifest` satisfying the `ToolManifest` interface from `../manifest.ts`
3. Add one import + array entry in `src/modules/tools/integrations/index.ts`

No other files need editing. The manifest includes schema, code, display names, and registration logic. See any existing integration for the full pattern.

Key constraints for tool code (the `code` string in manifests):
- Runs inside Docker with only Node.js built-ins (no npm packages)
- Config loaded from `path.join(__dirname, '<tool-name>.config.json')`
- Inputs available via global `input` variable
- Output via `console.log(JSON.stringify(result))`
- 30-second timeout on all HTTP requests

## Agent Execution Flow

1. Slack message received → relevance check → job enqueued (BullMQ)
2. Worker dequeues → rate limit check (TPM/RPM via Redis token bucket)
3. Context retrieval (KB search, source chunks, agent memory, thread history)
4. Docker container created with mounted tools, sources, config
5. Claude Agent SDK runs inside container → streams events to stdout
6. Worker reads stream → buffers → posts to Slack thread in real-time
7. Run record updated (tokens, cost, duration) → container cleaned up

## Key Patterns

### Slack Commands
Defined in `src/slack/commands.ts`. Each command opens modals or sends DM blocks. Interactive flows use `pending_confirmations` table for multi-step wizard state.

### Webhooks
Express routes in `src/server.ts`. Signature verification for GitHub, Linear, Zendesk, Intercom. Generic agent webhooks at `/webhooks/agent-{name}`.

### Rate Limiting
Redis-backed token bucket in `src/queue/index.ts`. Pre-flight check at 90% TPM capacity. Per-minute tracking for both TPM and RPM.

### Triggers
Types: `slack_channel`, `linear`, `zendesk`, `intercom`, `webhook`, `schedule`. Deduplication via Redis NX keys with 5-minute window. Schedule triggers use cron expressions with timezone support.

### Agent Memory
Optional per-agent. Categories: customer_preference, decision, context, technical, general, preference, procedure, correction, entity. Stored in `agent_memories` table with relevance scores.

## Slack App Configuration

### Required Bot Token Scopes (OAuth & Permissions)

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive @mention events |
| `channels:history` | Read messages in public channels |
| `channels:join` | Auto-join public channels |
| `channels:manage` | Create channels for agents |
| `chat:write` | Send messages |
| `chat:write.customize` | Send messages with custom username/emoji |
| `commands` | Slash commands (/agents, /new-agent, etc.) |
| `files:read` | Read uploaded files for KB |
| `groups:history` | Read messages in private channels |
| `groups:read` | View private channels the bot is in |
| `groups:write` | Auto-invite bot to private channels |
| `im:history` | Read DM messages |
| `im:read` | View DMs |
| `im:write` | Send DMs |
| `users:read` | Look up user info |

### Required Event Subscriptions (Socket Mode)

Subscribe to these bot events under **Event Subscriptions**:

- `message.channels` — messages in public channels
- `message.groups` — messages in private channels
- `message.im` — direct messages
- `message.mpim` — group DMs
- `app_mention` — @mentions of the bot
- `app_home_opened` — Home tab opened
- `file_shared` — file uploads for KB

### App-Level Token

Socket Mode requires an App-Level Token (`xapp-...`) with the `connections:write` scope. Generate this under **Basic Information → App-Level Tokens**.

## Environment Variables

Core required vars (see `.env.example` for full list):

```
SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET
ANTHROPIC_API_KEY
DATABASE_URL (PostgreSQL)
REDIS_URL
```

Optional: `GITHUB_TOKEN`, `PORT` (default 3000), `LOG_LEVEL`, `DOCKER_BASE_IMAGE`, `DAILY_BUDGET_USD`, `AUTO_UPDATE_ENABLED`.

## Development Workflow

- **Use worktrees**: Always use git worktrees (`isolation: "worktree"`) when making code changes, to avoid disrupting the working directory.
- **Test thoroughly**: Run the full test suite (`npm test`) before committing. All 1912+ tests must pass with 100% code coverage — no skipped or failing tests.
- **Publish releases**: Every push should include a tagged release with a changelog summarizing what changed. Use `gh release create` with clear release notes.

### Versioning

Versions follow sequential semver: `v1.X.0` where X increments by 1 for each release.

To determine the next version, check the latest release:

```bash
gh release list --limit 1
```

Then increment the minor version by 1. For example, if the latest release is `v1.5.0`, the next release should be `v1.6.0`.

Always update `package.json` version to match the new release version before committing.

## Testing

- **Unit tests**: `tests/unit/` — Vitest, run with `npm test`
- **Integration tests**: `tests/integration/` — testcontainers (PostgreSQL + Redis), run with `npm run test:integration`

## Deployment

Docker Compose orchestrates PostgreSQL, Redis, and the app. The app container runs PM2 with all 6 processes. Agent execution happens in separate Docker containers (tinyhands-runner image built at startup).

```bash
cp .env.example .env     # Configure credentials
docker compose up -d     # Start everything
```
