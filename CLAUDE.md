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
skills/                                             # Skill definitions (Markdown + YAML frontmatter)
templates/                                          # Agent template definitions (Markdown + YAML frontmatter)
src/
├── index.ts, worker.ts, scheduler.ts, sync.ts    # Process entry points
├── server.ts                                       # Express routes (webhooks, internal APIs)
├── config.ts                                       # Env var config
├── db/
│   ├── index.ts                                    # PostgreSQL pool, query helpers
│   └── migrations/                                 # SQL migrations (001-015)
├── queue/index.ts                                  # BullMQ queue, Redis, rate limiting
├── slack/
│   ├── index.ts                                    # Bolt app setup
│   ├── commands.ts                                 # Slash command handlers
│   ├── events.ts                                   # Message/mention handlers
│   ├── actions.ts                                  # Interactive action handlers
│   └── buffer.ts                                   # Real-time streaming to Slack
├── modules/
│   ├── agents/              # Agent CRUD, goal analyzer (Claude-powered config gen)
│   ├── access-control/      # Platform roles, agent roles, upgrade requests, permissions
│   ├── execution/           # Docker container lifecycle, Claude SDK, token tracking
│   ├── tools/               # Tool registry + integrations (see below)
│   ├── knowledge-base/      # KB entries, full-text search (tsvector + GIN)
│   ├── kb-sources/          # KB source connectors (GitHub, Drive, Zendesk, web)
│   ├── kb-wizard/           # Guided KB source setup flow
│   ├── sources/             # Agent data sources (GitHub, Google Drive, memory)
│   ├── triggers/            # Trigger types: slack, linear, zendesk, intercom, webhook, schedule
│   ├── workflows/           # Multi-step stateful workflows (DAG of steps)
│   ├── teams/               # Multi-agent orchestration
│   ├── skills/              # Skill registry + builtins loader (reads /skills/*.md)
│   ├── self-evolution/      # Agent improvement proposals + approval
│   ├── self-improvement/    # Critique detection, prompt refinement
│   ├── self-authoring/      # Agent-created tools, code artifacts, MCPs
│   ├── model-selection/     # Runtime model override (/opus, /sonnet, /haiku)
│   ├── observability/       # Cost tracking, error rates, alerts, daily digest
│   ├── dashboard/           # Slack Home Tab metrics
│   ├── document-filling/    # Google Docs/Sheets template automation
│   ├── auto-update/         # Pull-based deploy from GitHub
│   ├── permissions/         # Tool access control (read-only vs read-write)
│   ├── connections/         # Encrypted credential storage, OAuth flows, connection modes, credential resolution
│   ├── audit/               # Action audit logging (fire-and-forget)
│   └── workspace-settings/  # Per-workspace configuration settings
├── types/index.ts           # All TypeScript interfaces
└── utils/                   # Logger, costs, chunker, Slack formatting, webhooks
```

## Database

PostgreSQL with migrations in `src/db/migrations/`. Key tables:

- **agents** — Agent config (name, system_prompt, tools[], model, default_access, write_policy, channels)
- **run_history** — Execution records (tokens, cost, duration, status, trace_id)
- **custom_tools** — Tool definitions (schema, code, config, access_level)
- **kb_entries** — Knowledge base articles (full-text search via tsvector)
- **kb_sources** — KB source configs (auto-sync, connectors)
- **triggers** — Agent activation rules (cron, webhook, event-based)
- **sources** / **source_chunks** — Agent data sources and indexed content
- **agent_memories** — Persistent cross-run memory (facts, categories, relevance)
- **workflow_definitions** / **workflow_runs** — Multi-step automation state
- **evolution_proposals** — Agent self-improvement proposals
- **platform_roles** — Workspace-level roles (superadmin, admin, member)
- **agent_roles** — Per-agent access levels (owner, member, viewer)
- **workspace_settings** — Per-workspace configuration
- **upgrade_requests** — Viewer→member upgrade request tracking
- **connections** — Encrypted tool credentials (team + personal)
- **agent_tool_connections** — Per-agent tool connection mode config
- **oauth_states** — OAuth flow state tracking
- **action_audit_log** — Comprehensive action audit trail

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

No other files need editing — the system auto-discovers all integration folders. The manifest includes schema, code, display names, and registration logic. See any existing integration for the full pattern.

Key constraints for tool code (the `code` string in manifests):
- Runs inside Docker with only Node.js built-ins (no npm packages)
- Config loaded from `path.join(__dirname, '<tool-name>.config.json')`
- Inputs available via global `input` variable
- Output via `console.log(JSON.stringify(result))`
- 30-second timeout on all HTTP requests

## Skills

Skills are Markdown files in `skills/` at the repo root. YAML frontmatter has metadata; for prompt template skills, the markdown body IS the template.

### Adding a new skill

1. Create `skills/<name>.md`
2. Add YAML frontmatter with required fields
3. For prompt template skills, write the template as the markdown body

No other files need editing — the system auto-discovers all `.md` files in the skills directory.

**Prompt template example** (`skills/my-analysis.md`):
```markdown
---
id: my-analysis
name: My Analysis
skillType: prompt_template
description: Analyze data and provide insights
---

Analyze the provided {{topic}} data and return: key findings, trends, anomalies, and recommendations.
```

**MCP skill example** (`skills/my-service.md`):
```markdown
---
id: my-service
name: My Service
skillType: mcp
capabilities:
  - Read data
  - Update records
---
```

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

### Tool Connections & Credential Resolution
The connections module (`src/modules/connections/`) manages encrypted credential storage and resolution. Key helpers:
- `listTeamConnections(workspaceId)` — all team-level connections
- `listPersonalConnectionsForUser(workspaceId, userId)` — user's personal connections
- `getToolAgentUsage(toolId)` — which agents use a given tool
- `listAgentToolConnections(agentId)` — connection mode config per tool on an agent
- `getIntegrationIdForTool(toolName)` — resolve integration ID from tool name

Integration manifests declare a `connectionModel` property (`team`, `personal`, or `hybrid`) that controls which connection flows are available.

### Write Policy Approval Gates
Write policies (`confirm`, `admin_confirm`) are enforced at runtime via Redis-backed approval state. Approval routes in `src/server.ts` handle approve/deny actions from Slack DM buttons. Redis helpers in `src/queue/index.ts` manage approval request creation, polling, and expiration.

## Slack App Configuration

### Required Bot Token Scopes (OAuth & Permissions)

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive @mention events |
| `channels:history` | Read messages in public channels |
| `channels:join` | Auto-join public channels |
| `channels:manage` | Create channels for agents |
| `channels:read` | View public channel info (conversations.info) |
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

Optional: `GITHUB_TOKEN`, `PORT` (default 3000), `LOG_LEVEL`, `DOCKER_BASE_IMAGE`, `DAILY_BUDGET_USD`, `AUTO_UPDATE_ENABLED`, `ENCRYPTION_KEY` (32+ chars, for credential encryption), `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE_URL`.

## Development Workflow

- **Use worktrees**: Always use git worktrees (`isolation: "worktree"`) when making code changes, to avoid disrupting the working directory.
- **Test thoroughly**: Run the full test suite (`npm test`) before committing. All tests must pass with 100% code coverage — no skipped or failing tests. Every code change MUST include corresponding test updates: add tests for new functionality, update existing tests for modified behavior, and remove tests for deleted code.
- **Publish releases**: Every push should include a tagged release with a changelog summarizing what changed. Use `gh release create` with clear release notes.
- **Check PRODUCT_GUIDE.md before building**: Before implementing any feature or change, read the "Approval & Request Workflows" section and any other relevant sections in `PRODUCT_GUIDE.md`. If the planned change contradicts any documented workflow or behavior, STOP and flag the contradiction to the user before proceeding. This prevents breaking existing workflows.
- **Update documentation**: Every time you make code changes, you MUST also update the relevant documentation files to reflect those changes:
  - `README.md` — User-facing overview, features list, getting started
  - `PRODUCT_GUIDE.md` — Product capabilities, use cases, workflows (this is the source of truth for how the product works)
  - `ADMIN_GUIDE.md` — Setup, configuration, administration, troubleshooting
  - `CLAUDE.md` — Architecture, code structure, developer reference (only if the change affects project structure, patterns, or dev workflow)

  If a change adds a new feature, update README.md and PRODUCT_GUIDE.md. If it changes configuration or setup, update ADMIN_GUIDE.md. If it changes architecture or adds new modules, update CLAUDE.md. Bug fixes typically don't need doc changes unless they affect documented behavior.
- **Report PRODUCT_GUIDE.md changes**: When updating PRODUCT_GUIDE.md, always tell the user exactly what was changed and why. This ensures they're aware of any workflow or behavior documentation changes.

## Dashboard UI Guidelines

The web dashboard is designed for a **non-technical audience**. Follow these rules strictly:

- **No user IDs** — Never show raw Slack user IDs (e.g., `UH6TP67FB`). Always resolve to display names.
- **No technical identifiers** — No trace IDs, database IDs, internal names, or API slugs.
- **Friendly labels** — Use plain English labels. "Effort" not "maxTurns". "Web Search" not "WebSearch". "Ask Owner/Admins" not "admin_confirm".
- **No jargon** — Avoid terms like "built-in", "integration", "token bucket", "tsvector". Say what it does, not how it works.
- **Model names** — Show "Sonnet", "Opus", "Haiku" — never full model IDs like `claude-sonnet-4-20250514`.
- **Status labels** — "Completed" not "success". "Failed" not "error". "Running" not "in_progress".

### Versioning

Versions follow [semver](https://semver.org/):

- **Patch** (`v1.X.Y` → `v1.X.Y+1`): Bug fixes, minor tweaks, no new features
- **Minor** (`v1.X.0` → `v1.X+1.0`): New features, new integrations, non-breaking changes
- **Major** (`vX.0.0` → `vX+1.0.0`): Breaking changes to APIs, DB schema, or config format

To determine the next version, check the latest release:

```bash
gh release list --limit 1
```

Then increment the appropriate version component based on the change type. For example, if the latest release is `v1.5.0`:
- Bug fix → `v1.5.1`
- New feature → `v1.6.0`
- Breaking change → `v2.0.0`

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
