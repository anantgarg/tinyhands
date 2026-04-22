# Data Model

PostgreSQL 16 with 24 SQL migrations. Multi-tenant via `workspace_id` on all major tables.

## Core Entities

### Workspaces

| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT | Primary key — Slack team ID |
| team_name | TEXT | Slack workspace display name |
| workspace_slug | TEXT | URL-safe slug (used in webhook routes) |
| domain | TEXT | Slack workspace domain |
| bot_token | TEXT | Per-install Slack bot token |
| bot_user_id | TEXT | Bot's Slack user ID |
| status | TEXT | active / suspended |
| installed_at | TIMESTAMPTZ | When the Slack OAuth install completed |

Foundation for multi-tenancy. All other tables reference `workspace_id`.

### Users, Memberships, Platform Admins (plan-010)

Cross-workspace user identity. A user who signs into two Slack workspaces has two `users` rows (one per `home_workspace_id`), each with their own set of memberships.

`users` — (id, slack_user_id, home_workspace_id, display_name, email, avatar_url, active_workspace_id, created_at, updated_at). `id` is deterministic as `${home_workspace_id}:${slack_user_id}`.

`workspace_memberships` — (workspace_id, user_id, role, created_at, updated_at). `role` is `admin | member`. Composite PK `(workspace_id, user_id)`. Supersedes legacy `platform_roles` table (retained read-only for one release).

`platform_admins` — (user_id, email, created_at). Operators of the TinyHands deployment. Grants access to `/platform` health view; no per-workspace data access.

### Workspace Settings (extended)

Per-workspace key/value. After plan-010, stores the workspace's encrypted Anthropic API key under keys `anthropic_api_key` (ciphertext) and `anthropic_api_key_iv` (IV). Encrypted via AES-256-GCM with the platform-owned `ENCRYPTION_KEY`.

### Workspace OAuth Apps (plan-015)

Per-workspace third-party OAuth client credentials. Today only `provider = 'google'` is wired up; the column is provider-agnostic so Notion and GitHub can be added without a schema change.

| Column | Type | Purpose |
|--------|------|---------|
| workspace_id | TEXT | FK → workspaces, composite PK |
| provider | TEXT | `'google'` \| reserved: `'notion'`, `'github'`. Composite PK |
| client_id | TEXT | OAuth client id, plaintext (not secret on its own) |
| client_secret_encrypted | TEXT | Client secret encrypted with the same `ENCRYPTION_KEY` helper used by connections |
| publishing_status | TEXT | `'internal'` / `'external_testing'` / `'external_production'` / NULL |
| configured_by_user_id | TEXT | Which admin set it up (nullable for bootstrap-migrated rows) |
| configured_at | TIMESTAMPTZ | Initial configuration time |
| updated_at | TIMESTAMPTZ | Last change |

### Agents

The central entity — an AI agent that lives in Slack.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| workspace_id | UUID | Owning workspace |
| name | TEXT | Display name |
| channel_ids | TEXT[] | Slack channels the agent monitors |
| system_prompt | TEXT | Agent personality and instructions |
| tools | TEXT[] | Enabled tool names |
| avatar_emoji | TEXT | Slack display emoji |
| status | TEXT | active / paused |
| model | TEXT | claude model (opus/sonnet/haiku) |
| visibility | TEXT | public / private |
| default_access | TEXT | owner / member / viewer / none |
| write_policy | TEXT | auto / confirm / admin_confirm / deny |
| mentions_only | BOOLEAN | Only respond to @mentions |
| memory_enabled | BOOLEAN | Persist facts across runs |
| self_evolution_mode | TEXT | Self-improvement setting |
| max_turns | INTEGER | Max conversation turns per run |
| created_by | TEXT | Slack user ID of creator |

### Run History

Execution records for every agent invocation.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| agent_id | UUID | FK → agents |
| workspace_id | UUID | FK → workspaces |
| channel_id | TEXT | Slack channel where run occurred |
| thread_ts | TEXT | Slack thread timestamp |
| input | TEXT | User message that triggered the run |
| output | TEXT | Agent's final response |
| status | TEXT | success / error / timeout / cancelled |
| input_tokens | INTEGER | Tokens consumed (input) |
| output_tokens | INTEGER | Tokens consumed (output) |
| cache_read_tokens | INTEGER | Cached tokens read |
| cost | DECIMAL | USD cost of the run |
| duration_ms | INTEGER | Wall clock time |
| queue_wait_ms | INTEGER | Time spent in queue |
| tool_calls_count | INTEGER | Number of tool invocations |
| trace_id | TEXT | Observability trace ID |
| job_id | TEXT | BullMQ job identifier |

### Knowledge Base

#### KB Entries

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| workspace_id | UUID | FK → workspaces |
| title | TEXT | Article title |
| summary | TEXT | Short description |
| content | TEXT | Full article content |
| category | TEXT | Categorization |
| tags | TEXT[] | Search tags |
| source_type | TEXT | manual / agent / google_drive / zendesk / website / github / hubspot / linear |
| kb_source_id | UUID | FK → kb_sources when the entry was created by a connector (NULL for manual entries) |
| source_external_id | TEXT | Stable per-source identifier (e.g. Drive file id). Partial unique index `(workspace_id, kb_source_id, source_external_id)` WHERE both are NOT NULL. Enables upsert-by-external-id and tombstoning missing entries on each sync. |
| search_vector | TSVECTOR | Full-text search index (GIN) |

#### KB Sources

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| workspace_id | UUID | FK → workspaces |
| name | TEXT | Source display name |
| source_type | TEXT | Connector type (github, google_drive, zendesk, website, etc.) |
| config | JSONB | Connector-specific configuration |
| auto_sync | BOOLEAN | Auto-sync enabled |
| last_synced_at | TIMESTAMP | Last successful sync |

#### KB Source Skip Log (plan-020)

Structured per-file failure log. Upsert by `(kb_source_id, file_path)` — repeated skips of the same file update `last_seen_at` + `reason` + `message` rather than piling up duplicates. Rows are deleted when the file later ingests successfully, so the log reflects current state not history. ON DELETE CASCADE with `kb_sources`.

| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT | Primary key (UUID) |
| workspace_id | TEXT | FK → workspaces, ON DELETE CASCADE |
| kb_source_id | TEXT | FK → kb_sources, ON DELETE CASCADE |
| file_path | TEXT | Per-source file identifier (e.g. Drive file id). UNIQUE with kb_source_id. |
| filename | TEXT | Human-readable name for UI |
| mime_type | TEXT | NULL when the source didn't declare one |
| size_bytes | BIGINT | NULL when the source didn't report a size |
| reason | TEXT | enum-in-code: `too_large`, `unsupported_format`, `parser_failed`, `reducto_failed`, `corrupted`, `download_failed`, `empty_extraction` |
| message | TEXT | Plain-English admin-facing message (truncated at 500 chars) |
| first_seen_at | TIMESTAMPTZ | When this file first failed |
| last_seen_at | TIMESTAMPTZ | Most recent failure attempt |

Plain-English reason labels live in `SKIP_REASON_LABELS` in `src/modules/kb-sources/skip-log.ts` — the single source of truth for dashboard wording.

#### Workspace Settings: Reducto (plan-020)

Reducto document parsing is optional and per-workspace. Keys stored in the existing `workspace_settings` key/value table (AES-256-GCM under the workspace `ENCRYPTION_KEY`):

| Key | Purpose |
|-----|---------|
| `reducto_api_key` | AES-GCM ciphertext of the Reducto API key |
| `reducto_api_key_iv` | 12-byte hex IV for the above |
| `reducto_enabled` | `'true'` or `'false'` — only `'true'` actually sends bytes to Reducto, even if a key is present |

### Tools & Connections

#### Custom Tools

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| workspace_id | UUID | FK → workspaces |
| name | TEXT | Tool identifier |
| display_name | TEXT | Human-readable name |
| description | TEXT | What the tool does |
| schema | JSONB | Input parameter schema |
| code | TEXT | Tool implementation (runs in Docker) |
| config_keys | TEXT[] | Required configuration keys |
| access_level | TEXT | read / read_write |

#### Connections

Encrypted credential storage for tool integrations.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| workspace_id | UUID | FK → workspaces |
| integration_id | TEXT | Integration identifier |
| mode | TEXT | team / delegated / runtime |
| credentials | TEXT | Encrypted JSON (AES-256-GCM) |
| user_id | TEXT | Owner (for personal connections) |
| display_name | TEXT | Human-readable label |

#### Agent Tool Connections

| Column | Type | Purpose |
|--------|------|---------|
| agent_id | UUID | FK → agents |
| tool_name | TEXT | Tool identifier |
| connection_mode | TEXT | team / delegated / runtime |

### Documents

Native document system (docs, sheets, files).

#### Documents

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| workspace_id | UUID | FK → workspaces |
| agent_id | UUID | FK → agents (owning agent) |
| title | TEXT | Document title |
| type | TEXT | doc / sheet / file |
| content | JSONB | Document content (structure varies by type) |
| version | INTEGER | Current version counter |
| tags | TEXT[] | Categorization tags |
| agent_editable | BOOLEAN | Whether agents can modify |
| created_by | TEXT | Creator user/agent ID |

#### Document Versions

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| document_id | UUID | FK → documents |
| version | INTEGER | Version number |
| content | JSONB | Snapshot of content at this version |
| change_summary | TEXT | What changed |
| created_by | TEXT | Who made the change |

#### Sheet Tabs

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| document_id | UUID | FK → documents |
| name | TEXT | Tab name |
| columns | JSONB | Column definitions |
| cells | JSONB | Sparse cell data |
| row_count | INTEGER | Number of rows |
| col_count | INTEGER | Number of columns |

### Access Control

#### Workspace Memberships (current, plan-010)

| Column | Type | Purpose |
|--------|------|---------|
| workspace_id | TEXT | FK → workspaces |
| user_id | TEXT | FK → users.id |
| role | TEXT | admin / member |

#### Platform Roles (legacy, read-only)

Superseded by `workspace_memberships` + `platform_admins`. Retained read-only for one release, then dropped in a follow-up migration.

| Column | Type | Purpose |
|--------|------|---------|
| workspace_id | UUID | FK → workspaces |
| user_id | TEXT | Slack user ID |
| role | TEXT | superadmin / admin / member |

#### Agent Roles

| Column | Type | Purpose |
|--------|------|---------|
| agent_id | UUID | FK → agents |
| user_id | TEXT | Slack user ID |
| role | TEXT | owner / member / viewer |

### Triggers

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| agent_id | UUID | FK → agents |
| workspace_id | UUID | FK → workspaces |
| type | TEXT | slack_channel / linear / zendesk / intercom / webhook / schedule |
| config | JSONB | Trigger-specific configuration |
| enabled | BOOLEAN | Active status |

### Workflows

#### Workflow Definitions

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| agent_id | UUID | FK → agents |
| workspace_id | UUID | FK → workspaces |
| name | TEXT | Workflow name |
| steps | JSONB | DAG of workflow steps |

#### Workflow Runs

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| definition_id | UUID | FK → workflow_definitions |
| status | TEXT | running / completed / failed / waiting |
| current_step | TEXT | Active step identifier |
| state | JSONB | Accumulated workflow state |

### Other Tables

| Table | Purpose |
|-------|---------|
| agent_versions | Version history for agent configuration |
| agent_memories | Persistent cross-run memory (facts, categories, relevance scores) |
| sources / source_chunks | External data sources and their indexed content |
| skills / agent_skills | Skill definitions and agent-skill attachments |
| evolution_proposals | Agent self-improvement proposals (pending/approved/denied) |
| pending_confirmations | Write-policy approval state |
| upgrade_requests | Viewer→member upgrade request tracking |
| oauth_states | OAuth flow state tracking |
| audit_logs | Action audit trail |
| diagnostic_traces | Structured observability traces |
| document_files | Binary file storage (BYTEA) |
| document_search | Full-text search index for documents |
| tool_versions | Tool definition version history |
| tool_runs | Individual tool execution records |
| tool_requests | Tool access request tracking |
| team_runs / sub_agent_runs | Multi-agent orchestration records |
| side_effects_log | Workflow side effect tracking |
| code_artifacts | Agent-authored code artifacts |
| mcp_configs | MCP server configurations |
| authored_skills | Agent-created skill definitions |

## Relationships

```
workspaces
  ├── agents
  │     ├── run_history
  │     ├── agent_roles
  │     ├── agent_versions
  │     ├── agent_memories
  │     ├── agent_tool_connections
  │     ├── triggers
  │     ├── documents
  │     │     ├── document_versions
  │     │     ├── sheet_tabs
  │     │     ├── document_files
  │     │     └── document_search
  │     ├── workflow_definitions
  │     │     └── workflow_runs
  │     ├── evolution_proposals
  │     └── sources → source_chunks
  ├── users
  │     ├── workspace_memberships
  │     └── (platform_admins, via user_id)
  ├── platform_roles (legacy, read-only)
  ├── connections
  ├── custom_tools → tool_versions, tool_runs
  ├── kb_entries
  ├── kb_sources
  └── audit_logs
```
