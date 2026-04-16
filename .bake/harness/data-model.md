# Data Model

PostgreSQL 16 with 23 SQL migrations. All IDs are UUIDs. Multi-tenant via `workspace_id` on all major tables.

## Core Entities

### Workspaces

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| slack_team_id | TEXT | Slack workspace identifier |
| name | TEXT | Workspace display name |
| created_at | TIMESTAMP | Creation time |

Foundation for multi-tenancy. All other tables reference `workspace_id`.

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

#### Platform Roles

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
  ├── platform_roles
  ├── connections
  ├── custom_tools → tool_versions, tool_runs
  ├── kb_entries
  ├── kb_sources
  └── audit_logs
```
