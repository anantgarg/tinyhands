# Features Index

## Multi-Tenancy

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Multi-tenant workspaces | `src/modules/users/`, `src/db/migrations/024_multitenant.sql` | `users`, `workspace_memberships`, `platform_admins` tables |
| Sign in with Slack | `src/api/routes/auth.ts` | `GET /auth/slack`, `/auth/slack/callback`, `/auth/me` |
| Workspace switcher | `web/src/components/layout/WorkspaceSwitcher.tsx` | `GET /auth/workspaces`, `POST /auth/switch-workspace` |
| Slack OAuth install | `src/api/routes/auth.ts` | `/auth/slack/install`, `/auth/slack/install/callback` |
| Per-workspace Anthropic key | `src/modules/anthropic/` | `/settings/anthropic-key/{status,test}`, `PUT /settings/anthropic-key` |
| Per-workspace Google OAuth app (BYO) | `src/modules/workspace-oauth-apps/`, `web/src/pages/settings/integrations/google-oauth-app.tsx` | `GET/PUT/DELETE /workspace-oauth-apps/:provider`, `POST /workspace-oauth-apps/:provider/test` |
| Multi-tenant bootstrap | `src/modules/multitenant-migration/` | Runs on every startup; idempotent |
| Platform admin health | `src/api/routes/platform.ts`, `web/src/pages/Platform.tsx` | `/platform/workspaces` |
| Per-run container isolation | `src/docker/index.ts` | Per-workspace+run temp dir, RO mount, `finally` cleanup |
| Log secret redaction | `src/utils/logger.ts` | `redactSecrets()` applied at logger boundary |
| OAuth state signing | `src/utils/oauth-state.ts` | `encodeOAuthState` / `decodeOAuthState` |
| Workspace-scoped webhooks | `src/server.ts` | `/webhooks/w/{slug}/agent/{slug}` (+ legacy 301) |
| Queue fairness | `src/queue/index.ts` | Priority offsets per workspace; `WORKER_CONCURRENCY` env |

## Agent Management

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Create agents | `src/modules/agents/` | `/new-agent` command, `POST /api/agents` |
| Configure agents | `src/modules/agents/` | `/update-agent` command, `PUT /api/agents/:id` |
| Agent templates | `src/modules/templates/` | `/templates` command, `GET /api/templates` |
| Agent versioning | `src/modules/agents/` | Automatic on config changes |
| Agent visibility | `src/modules/agents/` | Public/private modes |
| DM conversations | `src/modules/agents/` | Direct message handling |

## Execution

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Message processing | `src/slack/events.ts` | Slack message events |
| Job queue | `src/queue/` | BullMQ priority queue |
| Docker isolation | `src/modules/execution/` | One container per agent run |
| Rate limiting | `src/queue/` | Token bucket (TPM/RPM) via Redis |
| Streaming responses | `src/slack/buffer.ts` | Real-time Slack message updates |
| Model selection | `src/modules/model-selection/` | `/opus`, `/sonnet`, `/haiku` overrides |

## Tools & Integrations

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Tool registry | `src/modules/tools/` | `/tools` command, `GET /api/tools` |
| Chargebee | `src/modules/tools/integrations/chargebee/` | Billing & subscription management |
| HubSpot | `src/modules/tools/integrations/hubspot/` | CRM operations |
| Linear | `src/modules/tools/integrations/linear/` | Issue tracking |
| Zendesk | `src/modules/tools/integrations/zendesk/` | Ticket management |
| PostHog | `src/modules/tools/integrations/posthog/` | Product analytics |
| SerpAPI | `src/modules/tools/integrations/serpapi/` | Web search |
| Knowledge Base tool | `src/modules/tools/integrations/kb/` | KB search (auto-configured) |
| Documents tool | `src/modules/tools/integrations/docs/` | Doc operations (auto-configured) |
| Auto-configured tool bypass | `ToolManifest.autoConfigured` | Dashboard renders "Built-in"; `listAgentToolConnections` filters stale rows; `setAgentToolConnection` rejects them; worker provisions them into the container directly from the manifest — no `agent_tool_connections` row required |
| Custom tools | `src/modules/tools/` | User-defined tools with code |

## Knowledge Base

| Feature | Module | Entry Points |
|---------|--------|-------------|
| KB entries | `src/modules/knowledge-base/` | `/kb` command, `GET /api/kb` |
| Full-text search | `src/modules/knowledge-base/` | tsvector + GIN indexes |
| KB sources | `src/modules/kb-sources/` | Google Drive shipped; GitHub/Zendesk/Web Crawl/Notion gated "Coming soon" in the wizard |
| KB setup wizard | `src/modules/kb-wizard/` | Interactive guided setup |
| Auto-sync | `src/modules/kb-sources/` | Periodic source refresh |
| Idempotent source sync | `src/modules/knowledge-base/` (`upsertKBEntryByExternalId`, `deleteStaleKBEntries`) | `source_external_id` partial unique index; tombstones entries missing from the latest crawl |
| Locked synced entries | `src/api/routes/kb.ts`, `web/src/pages/KnowledgeBase.tsx` | PATCH/DELETE `/kb/entries/:id` return 409 when `kb_source_id` is set |

## Documents

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Document CRUD | `src/modules/docs/` | `GET/POST/PUT/DELETE /api/docs` |
| Rich text docs | `src/modules/docs/` | JSONB content, TipTap editor |
| Spreadsheets | `src/modules/docs/` | Sheet tabs with sparse cell storage |
| File storage | `src/modules/docs/` | Binary files (BYTEA), StorageProvider |
| Version history | `src/modules/docs/` | Automatic versioning on changes |
| Document search | `src/modules/docs/` | Full-text search index |
| Template filling | `src/modules/document-filling/` | Google Docs/Sheets automation |

## Access Control

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Workspace memberships | `src/modules/users/` | admin / member per workspace (via `workspace_memberships`) |
| Platform admins | `src/modules/users/` | Operators of the deployment (via `platform_admins`), `/platform` view |
| Legacy platform roles | `src/modules/access-control/` | superadmin / admin / member (retained read-only; being phased out) |
| Agent roles | `src/modules/access-control/` | owner / member / viewer per agent |
| Write policy gates | `src/modules/permissions/` | auto / confirm / admin_confirm / deny |
| Upgrade requests | `src/modules/access-control/` | Viewer→member escalation |
| Tool permissions | `src/modules/permissions/` | read-only vs read-write |

## Connections & Credentials

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Team connections | `src/modules/connections/` | Workspace-wide credentials |
| Personal connections | `src/modules/connections/` | Per-user OAuth connections |
| OAuth flows | `src/modules/connections/` | GitHub, Google, Notion OAuth |
| Credential encryption | `src/modules/connections/` | AES-256-GCM |
| Connection modes | `src/modules/connections/` | team / delegated / runtime |

## Triggers & Automation

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Slack channel triggers | `src/modules/triggers/` | Message-based activation |
| Linear triggers | `src/modules/triggers/` | Issue events |
| Zendesk triggers | `src/modules/triggers/` | Ticket events |
| Intercom triggers | `src/modules/triggers/` | Conversation events |
| Webhook triggers | `src/modules/triggers/` | Generic HTTP webhooks |
| Schedule triggers | `src/modules/triggers/` | Cron expressions with timezone |
| Workflows | `src/modules/workflows/` | Multi-step DAGs with waiting states |

## Self-Improvement

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Evolution proposals | `src/modules/self-evolution/` | Agent-proposed config changes |
| Self-improvement | `src/modules/self-improvement/` | Critique detection, prompt refinement |
| Self-authoring | `src/modules/self-authoring/` | Agent-created tools and skills |
| Agent memory | `src/modules/agents/` | Persistent cross-run fact storage |

## Multi-Agent

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Team orchestration | `src/modules/teams/` | Coordinate multiple agents |
| Sub-agent runs | `src/modules/teams/` | Delegated task execution |

## Observability

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Cost tracking | `src/modules/observability/` | Per-run token/cost accounting |
| Error rates | `src/modules/observability/` | Error monitoring and alerting |
| Daily digest | `src/modules/observability/` | Summary reports |
| Diagnostic traces | `src/modules/observability/` | Structured trace logging |
| Audit logging | `src/modules/audit/` | All privileged actions tracked |
| Dashboard metrics | `src/modules/dashboard/` | Slack Home Tab analytics |

## Web Dashboard

| Feature | Page | Purpose |
|---------|------|---------|
| Agent list | `web/src/pages/Agents.tsx` | Browse and manage agents |
| Agent detail | `web/src/pages/AgentDetail.tsx` | Full agent configuration UI |
| Agent creation | `web/src/pages/AgentCreate.tsx` | Create new agents |
| Templates | `web/src/pages/AgentTemplates.tsx` | Browse agent templates |
| Dashboard | `web/src/pages/Dashboard.tsx` | Metrics and analytics |
| Knowledge base | `web/src/pages/KnowledgeBase.tsx` | KB entry management |
| KB sources | `web/src/pages/KBSources.tsx` | Source connectors |
| Connections | `web/src/pages/Connections.tsx` | OAuth/credential management |
| Documents | `web/src/pages/Documents.tsx` | Native doc/sheet/file browser |
| Doc editor | `web/src/pages/DocEditor.tsx` | Rich text document editing |
| Workflows | `web/src/pages/Workflows.tsx` | Workflow builder |
| Triggers | `web/src/pages/Triggers.tsx` | Event trigger management |
| Evolution | `web/src/pages/Evolution.tsx` | Self-improvement proposals |
| Audit log | `web/src/pages/AuditLog.tsx` | Action audit trail |
| Error logs | `web/src/pages/ErrorLogs.tsx` | Error tracking |
| Access roles | `web/src/pages/AccessRoles.tsx` | Role management |
| Settings | `web/src/pages/Settings.tsx` | Workspace configuration |

## Skills System

| Feature | Module | Entry Points |
|---------|--------|-------------|
| Skill registry | `src/modules/skills/` | Auto-discovered from `skills/` dir |
| Prompt templates | `skills/*.md` | YAML frontmatter + markdown body |
| MCP skills | `skills/*.md` | External service integration |
| Skill attachment | `src/modules/skills/` | Per-agent skill configuration |

## Deployment & Operations

| Feature | Location | Purpose |
|---------|----------|---------|
| Docker Compose | `docker-compose.yml` | Full stack orchestration |
| PM2 process management | `ecosystem.config.js` | Multi-process production runtime |
| Auto-update | `src/modules/auto-update/` | Pull-based deploy from GitHub |
| Database migrations | `src/db/migrations/` | Schema versioning |
| DigitalOcean images | `packer/` | Marketplace-ready snapshots |
| SSL automation | `deploy/init-letsencrypt.sh` | Let's Encrypt setup |

## Slack Commands

| Command | Purpose |
|---------|---------|
| `/agents` | List and manage agents |
| `/new-agent` | Create a new agent |
| `/update-agent` | Update agent configuration |
| `/tools` | Manage tool integrations |
| `/kb` | Manage knowledge base |
| `/audit` | View audit log |
| `/templates` | Browse agent templates |

## API Routes

| Route Group | Base Path | Key Endpoints |
|-------------|-----------|---------------|
| Agents | `/api/agents` | CRUD, versions |
| Auth | `/api/auth` | OAuth, session |
| Chat | `/api/chat` | Web dashboard chat |
| Dashboard | `/api/dashboard` | Metrics, activity |
| Documents | `/api/docs` | CRUD, search, versions |
| Knowledge Base | `/api/kb` | Entries, search, categories |
| Tools | `/api/tools` | Available, custom, integrations |
| Connections | `/api/connections` | Personal, team, OAuth |
| Triggers | `/api/triggers` | Definitions, webhooks |
| Workflows | `/api/workflows` | Definitions, runs |
| Observability | `/api/observability` | Errors, runs, stats |
| Audit | `/api/audit` | Entries |
| Evolution | `/api/evolution` | Proposals, approve/deny |
| Access Control | `/api/access-control` | Platform roles |
| Settings | `/api/settings` | Workspace settings |
| Skills | `/api/skills` | Attach/detach |
