# TinyHands Multi-Tenant SaaS Conversion Plan

## Overview

Convert TinyHands into a SaaS platform using a **two-repository architecture**:

1. **Core repo** (`tinyhands`) — Open-source, self-hosted. Gets workspace-aware plumbing internally but remains single-tenant in behavior. Socket Mode, no billing, no OAuth. Works exactly as today for self-hosted users.

2. **SaaS repo** (`tinyhands-cloud`) — Proprietary. Imports core as a git submodule. Adds OAuth, HTTP Events API, credit-based billing, Stripe, platform admin, encryption, and multi-tenant entry points.

**Billing model**: Credit-based pay-as-you-go. Customers buy credits, usage deducts from balance. Only platform-provided services (Anthropic, SerpAPI) are charged with markup. BYOK tool calls are free by default (orchestration fee configurable but off).

---

## Table of Contents

**Core Repo Changes:**
1. [Phase 1: Database Multi-Tenancy Foundation](#phase-1-database-multi-tenancy-foundation)
2. [Phase 2: Workspace-Aware Module Plumbing](#phase-2-workspace-aware-module-plumbing)
3. [Phase 3: Workspace-Scoped Redis & Queue](#phase-3-workspace-scoped-redis--queue)

**SaaS Repo (New):**
4. [Phase 4: SaaS Repo Setup & Slack OAuth](#phase-4-saas-repo-setup--slack-oauth)
5. [Phase 5: Tenant Isolation & Credentials](#phase-5-tenant-isolation--credentials)
6. [Phase 6: Credit System & Usage Metering](#phase-6-credit-system--usage-metering)
7. [Phase 7: Onboarding, Admin & UX](#phase-7-onboarding-admin--ux)
8. [Phase 8: Infrastructure & Deployment](#phase-8-infrastructure--deployment)

---

## Two-Repo Architecture

```
tinyhands/  (core, open-source)
├── src/
│   ├── index.ts                    ← Socket Mode listener (unchanged behavior)
│   ├── worker.ts                   ← Worker (unchanged behavior)
│   ├── scheduler.ts                ← Cron scheduler
│   ├── sync.ts                     ← KB sync, alerts, digest
│   ├── server.ts                   ← Webhook routes
│   ├── config.ts                   ← Env var config
│   ├── db/
│   │   ├── index.ts                ← Pool + TenantDB class (NEW)
│   │   └── migrations/
│   │       ├── 001-009              ← Existing
│   │       ├── 010_workspaces.sql   ← workspaces table + workspace_id columns (NEW)
│   │       └── 011_backfill.sql     ← Backfill + NOT NULL (NEW)
│   ├── queue/index.ts              ← Workspace-scoped Redis keys (MODIFIED)
│   ├── slack/                      ← Socket Mode (unchanged)
│   ├── modules/                    ← All modules get workspaceId param (MODIFIED)
│   ├── types/index.ts              ← workspaceId added to interfaces (MODIFIED)
│   └── utils/
└── package.json


tinyhands-cloud/  (SaaS, proprietary)
├── core/                            ← git submodule → tinyhands repo
├── src/
│   ├── index.ts                     ← SaaS listener (HTTP Events API + OAuth)
│   ├── worker.ts                    ← SaaS worker (wraps core, adds metering)
│   ├── scheduler.ts                 ← Wraps core scheduler (multi-workspace)
│   ├── sync.ts                      ← Wraps core sync (multi-workspace)
│   ├── server.ts                    ← SaaS routes (OAuth, Stripe, landing page)
│   ├── config.ts                    ← SaaS config (extends core config)
│   ├── db/migrations/
│   │   ├── 012_rls.sql              ← Row-Level Security policies
│   │   ├── 013_credentials.sql      ← workspace_credentials table
│   │   └── 014_credit_system.sql    ← pricing_catalog, credits, transactions
│   ├── modules/
│   │   ├── workspaces/index.ts      ← Workspace CRUD, caching
│   │   ├── billing/index.ts         ← meter(), checkCredits(), addCredits()
│   │   ├── billing/stripe.ts        ← Stripe checkout, webhooks, auto-recharge
│   │   └── platform-admin/index.ts  ← Cross-workspace admin
│   ├── slack/
│   │   └── oauth.ts                 ← OAuth v2 install/callback
│   ├── middleware/
│   │   └── tenant.ts                ← Workspace validation
│   └── utils/
│       └── encryption.ts            ← AES-256-GCM encrypt/decrypt
├── landing/                         ← Landing page + "Add to Slack" button
└── package.json                     ← Depends on ./core
```

### How Self-Hosted Still Works (Core Repo)

On startup, core auto-creates a single workspace from env vars:

```typescript
// In core src/index.ts startup:
const authResult = await app.client.auth.test();
await upsertWorkspace({
  id: authResult.team_id,
  team_name: authResult.team,
  bot_token: config.slack.botToken,  // stored as plaintext in self-hosted
  bot_user_id: authResult.user_id,
  status: 'active',
});
```

All module functions receive this single `workspaceId`. Behavior is identical to today. No billing, no OAuth, no credits. Users never see a difference.

### How SaaS Consumes Core

The SaaS repo imports core modules and wraps them:

```typescript
// tinyhands-cloud/src/worker.ts
import { executeAgentRun } from '../core/src/modules/execution';
import { meter, checkCredits } from './modules/billing';

export async function executeAgentRunWithBilling(job) {
  const { workspaceId } = job.data;

  // Pre-run: credit check
  const check = await checkCredits(workspaceId);
  if (!check.allowed) { /* block run, notify in Slack */ }

  // Core execution (unchanged)
  const result = await executeAgentRun(job);

  // Post-run: meter token usage
  await meter(workspaceId, 'ai_tokens', `${result.model}_input`, {
    quantity: Math.ceil(result.inputTokens / 1000),
    runId: result.runId, agentId: result.agentId,
  });
  await meter(workspaceId, 'ai_tokens', `${result.model}_output`, {
    quantity: Math.ceil(result.outputTokens / 1000),
    runId: result.runId, agentId: result.agentId,
  });

  return result;
}
```

---

# CORE REPO CHANGES

These phases modify the existing `tinyhands` repo. All changes are backward-compatible — self-hosted behavior is unchanged.

---

## Phase 1: Database Multi-Tenancy Foundation

**Goal**: Add `workspaces` table, `workspace_id` to all existing tables, create tenant-scoped query layer. Self-hosted auto-bootstraps one workspace.

**Repo**: `tinyhands` (core)

### 1.1 New `workspaces` Table

**Migration**: `src/db/migrations/010_workspaces_and_multi_tenancy.sql`

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,                         -- Slack team_id (T01234ABC)
  team_name TEXT NOT NULL,
  domain TEXT,                                 -- workspace.slack.com subdomain
  bot_token TEXT NOT NULL,                     -- Plaintext in self-hosted, encrypted in SaaS
  bot_user_id TEXT NOT NULL,                   -- U... bot user
  bot_id TEXT,                                 -- B... bot
  app_id TEXT,                                 -- Slack app ID
  authed_user_id TEXT,                         -- User who installed
  scope TEXT,                                  -- Granted bot scopes
  status TEXT NOT NULL DEFAULT 'active',       -- active | suspended | cancelled
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Note: SaaS-specific columns (refresh_token, anthropic_api_key, stripe fields, credit fields) are **not** in the core schema. The SaaS repo adds them via its own migrations.

### 1.2 Add `workspace_id` to All Existing Tables

Every table gets `ALTER TABLE ... ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)`.

**All 29 tables requiring `workspace_id`:**

| Table | Current Unique Constraint | New Unique Constraint |
|-------|--------------------------|----------------------|
| `agents` | name UNIQUE | UNIQUE(workspace_id, name) |
| `agent_versions` | — | — |
| `run_history` | — | — |
| `sources` | — | — |
| `source_chunks` | — | — |
| `agent_memory` | — | — |
| `triggers` | — | — |
| `skills` | name UNIQUE | UNIQUE(workspace_id, name) |
| `agent_skills` | (agent_id, skill_id) PK | — |
| `kb_entries` | — | — |
| `kb_chunks` | — | — |
| `custom_tools` | name UNIQUE | UNIQUE(workspace_id, name) |
| `evolution_proposals` | — | — |
| `authored_skills` | — | — |
| `mcp_configs` | (agent_id, name) UNIQUE | — |
| `code_artifacts` | (agent_id, file_path) UNIQUE | — |
| `tool_versions` | — | — |
| `tool_runs` | — | — |
| `workflow_definitions` | — | — |
| `workflow_runs` | — | — |
| `side_effects_log` | — | — |
| `superadmins` | user_id PK | PK becomes (workspace_id, user_id) |
| `agent_admins` | (agent_id, user_id) PK | — |
| `agent_members` | (agent_id, user_id) PK | — |
| `pending_confirmations` | — | — |
| `dm_conversations` | — | — |
| `kb_sources` | — | — |
| `kb_api_keys` | provider UNIQUE | UNIQUE(workspace_id, provider) |
| `team_runs` | — | — |
| `sub_agent_runs` | — | — |

**Indexes** (compound on workspace_id + lookup columns):

```sql
CREATE INDEX idx_agents_ws ON agents(workspace_id);
CREATE INDEX idx_agents_ws_channel ON agents(workspace_id, channel_id);
CREATE INDEX idx_agents_ws_name ON agents(workspace_id, name);
CREATE INDEX idx_run_history_ws ON run_history(workspace_id);
CREATE INDEX idx_run_history_ws_agent ON run_history(workspace_id, agent_id);
CREATE INDEX idx_run_history_ws_created ON run_history(workspace_id, created_at);
CREATE INDEX idx_custom_tools_ws ON custom_tools(workspace_id);
CREATE INDEX idx_custom_tools_ws_name ON custom_tools(workspace_id, name);
CREATE INDEX idx_kb_entries_ws ON kb_entries(workspace_id);
CREATE INDEX idx_kb_sources_ws ON kb_sources(workspace_id);
CREATE INDEX idx_triggers_ws ON triggers(workspace_id);
CREATE INDEX idx_triggers_ws_agent ON triggers(workspace_id, agent_id);
CREATE INDEX idx_sources_ws ON sources(workspace_id);
CREATE INDEX idx_skills_ws ON skills(workspace_id);
CREATE INDEX idx_dm_conversations_ws ON dm_conversations(workspace_id);
CREATE INDEX idx_superadmins_ws ON superadmins(workspace_id);
```

### 1.3 Data Backfill Migration

**Migration**: `src/db/migrations/011_backfill_workspace_id.sql`

```sql
-- Step 1: App code creates workspace record on startup (from SLACK_BOT_TOKEN via auth.test)
-- Step 2: Backfill all rows with that workspace_id
UPDATE agents SET workspace_id = (SELECT id FROM workspaces LIMIT 1) WHERE workspace_id IS NULL;
UPDATE run_history SET workspace_id = (SELECT id FROM workspaces LIMIT 1) WHERE workspace_id IS NULL;
-- ... repeat for all 29 tables ...
-- Step 3: Set NOT NULL
ALTER TABLE agents ALTER COLUMN workspace_id SET NOT NULL;
-- ... repeat for all 29 tables ...
```

### 1.4 Tenant-Scoped Query Layer

**File**: `src/db/index.ts`

Add a `TenantDB` class alongside existing helpers. Existing `query()`/`queryOne()`/`execute()` continue to work for cross-workspace queries (scheduler, sync).

```typescript
export class TenantDB {
  constructor(private workspaceId: string) {}

  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    // Validates workspaceId is non-empty
    // Delegates to pool.query with workspaceId context
  }

  async queryOne<T>(sql: string, params: any[] = []): Promise<T | undefined> { ... }
  async execute(sql: string, params: any[] = []): Promise<{ rowCount: number }> { ... }
}
```

### 1.5 Self-Hosted Workspace Bootstrap

**File**: `src/index.ts`

On startup, auto-create workspace from env vars:

```typescript
// After Slack app initializes:
const authResult = await app.client.auth.test();
const workspaceId = authResult.team_id;
await upsertWorkspace({
  id: workspaceId,
  team_name: authResult.team,
  bot_token: config.slack.botToken,
  bot_user_id: authResult.user_id,
  status: 'active',
});
// Store globally for single-tenant mode
setDefaultWorkspaceId(workspaceId);
```

Add to `src/db/index.ts`:

```typescript
let defaultWorkspaceId: string | null = null;
export function setDefaultWorkspaceId(id: string): void { defaultWorkspaceId = id; }
export function getDefaultWorkspaceId(): string {
  if (!defaultWorkspaceId) throw new Error('Workspace not initialized');
  return defaultWorkspaceId;
}
```

### 1.6 Testing

- Migration test: Run 010-011 on existing data, verify backfill.
- Isolation test: Create two workspaces, insert data in A, query from B, assert empty.
- Bootstrap test: Start app with SLACK_BOT_TOKEN, verify workspace auto-created.

---

## Phase 2: Workspace-Aware Module Plumbing

**Goal**: Add `workspaceId` parameter to all module functions. Self-hosted callers pass `getDefaultWorkspaceId()`.

**Repo**: `tinyhands` (core)

### 2.1 Update `JobData` Interface

**File**: `src/types/index.ts`

```typescript
export interface JobData {
  workspaceId: string;     // NEW — required
  agentId: string;
  channelId: string;
  threadTs: string;
  input: string;
  userId: string | null;
  traceId: string;
  modelOverride?: ModelAlias;
  triggerId?: string;
  workflowRunId?: string;
  workflowStepIndex?: number;
  statusMessageTs?: string;
}
```

### 2.2 Update Slack Event Handlers

**File**: `src/slack/events.ts`

Every handler extracts `workspaceId` and passes it downstream:

```typescript
app.event('message', async ({ event, context }) => {
  const workspaceId = context.teamId || getDefaultWorkspaceId();
  const agents = await getAgentsByChannel(workspaceId, channelId);
  // ...
});
```

**File**: `src/slack/commands.ts`

```typescript
app.command('/agents', async ({ command, ack, client }) => {
  const workspaceId = command.team_id || getDefaultWorkspaceId();
  const agents = await getAccessibleAgents(workspaceId, command.user_id);
  // ...
});
```

**File**: `src/slack/actions.ts`

```typescript
app.action('agent_overflow', async ({ body, ack, client }) => {
  const workspaceId = body.team?.id || getDefaultWorkspaceId();
  // ...
});
```

### 2.3 Update Buffer

**File**: `src/slack/buffer.ts`

```typescript
export function bufferEvent(
  workspaceId: string,    // NEW
  channelId: string,
  threadTs: string,
  // ... existing params
): void {
  // Use getSlackClient(workspaceId) instead of getSlackApp().client
  // (In core self-hosted, getSlackClient returns the single app client)
}
```

### 2.4 Module-by-Module Function Signature Changes

Every exported function in every module gains `workspaceId` as its first parameter. All database queries include `WHERE workspace_id = $N`.

**`src/modules/agents/index.ts`** (19 functions):

| Before | After |
|--------|-------|
| `createAgent(params)` | `createAgent(workspaceId, params)` |
| `getAgent(id)` | `getAgent(workspaceId, id)` |
| `getAgentByName(name)` | `getAgentByName(workspaceId, name)` |
| `getAgentByChannel(channelId)` | `getAgentByChannel(workspaceId, channelId)` |
| `getAgentsByChannel(channelId)` | `getAgentsByChannel(workspaceId, channelId)` |
| `listAgents()` | `listAgents(workspaceId)` |
| `updateAgent(id, updates, changedBy)` | `updateAgent(workspaceId, id, updates, changedBy)` |
| `deleteAgent(id)` | `deleteAgent(workspaceId, id)` |
| `getAgentVersions(agentId)` | `getAgentVersions(workspaceId, agentId)` |
| `getAgentVersion(agentId, version)` | `getAgentVersion(workspaceId, agentId, version)` |
| `revertAgent(agentId, version, changedBy)` | `revertAgent(workspaceId, agentId, version, changedBy)` |
| `addAgentMember(agentId, userId, addedBy)` | `addAgentMember(workspaceId, agentId, userId, addedBy)` |
| `removeAgentMember(agentId, userId)` | `removeAgentMember(workspaceId, agentId, userId)` |
| `getAgentMembers(agentId)` | `getAgentMembers(workspaceId, agentId)` |
| `isAgentMember(agentId, userId)` | `isAgentMember(workspaceId, agentId, userId)` |
| `canAccessAgent(agentId, userId)` | `canAccessAgent(workspaceId, agentId, userId)` |
| `createDmConversation(userId, agentId, ...)` | `createDmConversation(workspaceId, userId, agentId, ...)` |
| `getDmConversation(dmChannelId, threadTs)` | `getDmConversation(workspaceId, dmChannelId, threadTs)` |
| `getAccessibleAgents(userId)` | `getAccessibleAgents(workspaceId, userId)` |

**`src/modules/access-control/index.ts`** (10 functions):

| Before | After |
|--------|-------|
| `initSuperadmin(userId)` | `initSuperadmin(workspaceId, userId)` |
| `addSuperadmin(userId, grantedBy)` | `addSuperadmin(workspaceId, userId, grantedBy)` |
| `removeSuperadmin(userId, removedBy)` | `removeSuperadmin(workspaceId, userId, removedBy)` |
| `isSuperadmin(userId)` | `isSuperadmin(workspaceId, userId)` |
| `listSuperadmins()` | `listSuperadmins(workspaceId)` |
| `addAgentAdmin(agentId, userId, role, grantedBy)` | `addAgentAdmin(workspaceId, agentId, userId, role, grantedBy)` |
| `removeAgentAdmin(agentId, userId, removedBy)` | `removeAgentAdmin(workspaceId, agentId, userId, removedBy)` |
| `getAgentAdmins(agentId)` | `getAgentAdmins(workspaceId, agentId)` |
| `getUserRole(agentId, userId)` | `getUserRole(workspaceId, agentId, userId)` |
| `canModifyAgent(agentId, userId)` | `canModifyAgent(workspaceId, agentId, userId)` |

**`src/modules/execution/index.ts`** (6 functions):

| Before | After |
|--------|-------|
| `createRunRecord(data, jobId)` | `createRunRecord(workspaceId, data, jobId)` |
| `updateRunRecord(id, updates)` | `updateRunRecord(workspaceId, id, updates)` |
| `getRunRecord(id)` | `getRunRecord(workspaceId, id)` |
| `getRunsByAgent(agentId, limit)` | `getRunsByAgent(workspaceId, agentId, limit)` |
| `getRecentRuns(limit)` | `getRecentRuns(workspaceId, limit)` |
| `executeAgentRun(job)` | Extracts `workspaceId` from `job.data.workspaceId` |

**`src/modules/tools/index.ts`** (16 functions):

| Before | After |
|--------|-------|
| `registerCustomTool(name, ...)` | `registerCustomTool(workspaceId, name, ...)` |
| `approveCustomTool(name, userId)` | `approveCustomTool(workspaceId, name, userId)` |
| `getToolCode(name)` | `getToolCode(workspaceId, name)` |
| `getCustomTool(name)` | `getCustomTool(workspaceId, name)` |
| `listCustomTools()` | `listCustomTools(workspaceId)` |
| `listUserAvailableTools()` | `listUserAvailableTools(workspaceId)` |
| `listWriteTools()` | `listWriteTools(workspaceId)` |
| `deleteCustomTool(name, userId)` | `deleteCustomTool(workspaceId, name, userId)` |
| `updateToolConfig(name, configJson, userId)` | `updateToolConfig(workspaceId, name, configJson, userId)` |
| `setToolConfigKey(name, key, value, userId)` | `setToolConfigKey(workspaceId, name, key, value, userId)` |
| `removeToolConfigKey(name, key, userId)` | `removeToolConfigKey(workspaceId, name, key, userId)` |
| `getToolConfig(name, userId)` | `getToolConfig(workspaceId, name, userId)` |
| `updateToolAccessLevel(name, level, userId)` | `updateToolAccessLevel(workspaceId, name, level, userId)` |
| `getAgentToolSummary(agentId)` | `getAgentToolSummary(workspaceId, agentId)` |
| `addToolToAgent(agentId, toolName, userId)` | `addToolToAgent(workspaceId, agentId, toolName, userId)` |
| `removeToolFromAgent(agentId, toolName, userId)` | `removeToolFromAgent(workspaceId, agentId, toolName, userId)` |

**`src/modules/knowledge-base/index.ts`** (8 functions):

| Before | After |
|--------|-------|
| `createKBEntry(params)` | `createKBEntry(workspaceId, params)` |
| `approveKBEntry(entryId)` | `approveKBEntry(workspaceId, entryId)` |
| `getKBEntry(id)` | `getKBEntry(workspaceId, id)` |
| `listKBEntries(limit)` | `listKBEntries(workspaceId, limit)` |
| `listPendingEntries()` | `listPendingEntries(workspaceId)` |
| `deleteKBEntry(id)` | `deleteKBEntry(workspaceId, id)` |
| `searchKB(queryText, agentId?, tokenBudget)` | `searchKB(workspaceId, queryText, agentId?, tokenBudget)` |
| `getCategories()` | `getCategories(workspaceId)` |

**`src/modules/kb-sources/index.ts`** (15 functions):

| Before | After |
|--------|-------|
| `getApiKey(provider)` | `getApiKey(workspaceId, provider)` |
| `setApiKey(provider, configJson, userId)` | `setApiKey(workspaceId, provider, configJson, userId)` |
| `setApiKeyField(provider, key, value, userId)` | `setApiKeyField(workspaceId, provider, key, value, userId)` |
| `removeApiKeyField(provider, key, userId)` | `removeApiKeyField(workspaceId, provider, key, userId)` |
| `isProviderConfigured(provider)` | `isProviderConfigured(workspaceId, provider)` |
| `listApiKeys()` | `listApiKeys(workspaceId)` |
| `deleteApiKey(provider, userId)` | `deleteApiKey(workspaceId, provider, userId)` |
| `createSource(params)` | `createSource(workspaceId, params)` |
| `getSource(id)` | `getSource(workspaceId, id)` |
| `listSources()` | `listSources(workspaceId)` |
| `updateSource(id, updates)` | `updateSource(workspaceId, id, updates)` |
| `deleteSource(id, userId)` | `deleteSource(workspaceId, id, userId)` |
| `startSync(sourceId)` | `startSync(workspaceId, sourceId)` |
| `flushAndResync(sourceId, userId)` | `flushAndResync(workspaceId, sourceId, userId)` |
| `getSourcesDueForSync()` | `getSourcesDueForSync()` — returns all workspaces (cross-workspace) |

**`src/modules/triggers/index.ts`** (10 functions):

| Before | After |
|--------|-------|
| `createTrigger(params)` | `createTrigger(workspaceId, params)` |
| `getTrigger(id)` | `getTrigger(workspaceId, id)` |
| `getAgentTriggers(agentId)` | `getAgentTriggers(workspaceId, agentId)` |
| `getActiveTriggersByType(type)` | `getActiveTriggersByType(workspaceId, type)` |
| `pauseTrigger(triggerId, userId)` | `pauseTrigger(workspaceId, triggerId, userId)` |
| `resumeTrigger(triggerId, userId)` | `resumeTrigger(workspaceId, triggerId, userId)` |
| `deleteTrigger(triggerId, userId)` | `deleteTrigger(workspaceId, triggerId, userId)` |
| `fireTrigger(event)` | `fireTrigger(workspaceId, event)` |
| `getScheduledTriggersDue()` | `getScheduledTriggersDue()` — cross-workspace |
| `findSlackChannelTriggers(channelId)` | `findSlackChannelTriggers(workspaceId, channelId)` |

**`src/modules/sources/index.ts`** (7 functions):

| Before | After |
|--------|-------|
| `connectSource(params)` | `connectSource(workspaceId, params)` |
| `disconnectSource(sourceId)` | `disconnectSource(workspaceId, sourceId)` |
| `getAgentSources(agentId)` | `getAgentSources(workspaceId, agentId)` |
| `getSource(id)` | `getSource(workspaceId, id)` |
| `ingestContent(sourceId, agentId, files)` | `ingestContent(workspaceId, sourceId, agentId, files)` |
| `retrieveContext(agentId, queryText, tokenBudget)` | `retrieveContext(workspaceId, agentId, queryText, tokenBudget)` |
| `getSourcesDueForSync()` | `getSourcesDueForSync()` — cross-workspace |

**`src/modules/sources/memory.ts`** (6 functions):

| Before | After |
|--------|-------|
| `storeMemory(params)` | `storeMemory(workspaceId, params)` |
| `storeMemories(agentId, runId, facts)` | `storeMemories(workspaceId, agentId, runId, facts)` |
| `retrieveMemories(agentId, queryText, tokenBudget)` | `retrieveMemories(workspaceId, agentId, queryText, tokenBudget)` |
| `getAgentMemories(agentId)` | `getAgentMemories(workspaceId, agentId)` |
| `forgetMemory(agentId, searchTerm)` | `forgetMemory(workspaceId, agentId, searchTerm)` |
| `clearAgentMemory(agentId)` | `clearAgentMemory(workspaceId, agentId)` |

**`src/modules/workflows/index.ts`** (10 functions):

| Before | After |
|--------|-------|
| `createWorkflowDefinition(name, agentId, steps, createdBy)` | `createWorkflowDefinition(workspaceId, name, agentId, steps, createdBy)` |
| `getWorkflowDefinition(id)` | `getWorkflowDefinition(workspaceId, id)` |
| `startWorkflow(workflowId)` | `startWorkflow(workspaceId, workflowId)` |
| `getWorkflowRun(id)` | `getWorkflowRun(workspaceId, id)` |
| `advanceWorkflow(workflowRunId)` | `advanceWorkflow(workspaceId, workflowRunId)` |
| `resolveHumanAction(workflowRunId, actionData)` | `resolveHumanAction(workspaceId, workflowRunId, actionData)` |
| `completeWorkflow(workflowRunId)` | `completeWorkflow(workspaceId, workflowRunId)` |
| `failWorkflow(workflowRunId, reason)` | `failWorkflow(workspaceId, workflowRunId, reason)` |
| `getActiveWorkflowRuns()` | `getActiveWorkflowRuns()` — cross-workspace |
| `getExpiredTimers()` | `getExpiredTimers()` — cross-workspace |

**`src/modules/teams/index.ts`** (5 functions):

| Before | After |
|--------|-------|
| `createTeamRun(leadAgentId, leadRunId, ...)` | `createTeamRun(workspaceId, leadAgentId, leadRunId, ...)` |
| `getTeamRun(id)` | `getTeamRun(workspaceId, id)` |
| `spawnSubAgent(teamRunId, agentId, task, depth)` | `spawnSubAgent(workspaceId, teamRunId, agentId, task, depth)` |
| `completeSubAgent(subAgentRunId, status, result)` | `completeSubAgent(workspaceId, subAgentRunId, status, result)` |
| `getTeamCost(teamRunId)` | `getTeamCost(workspaceId, teamRunId)` |

**`src/modules/skills/index.ts`** (7 functions):

| Before | After |
|--------|-------|
| `registerSkill(name, skillType, config)` | `registerSkill(workspaceId, name, skillType, config)` |
| `getSkill(id)` | `getSkill(workspaceId, id)` |
| `getSkillByName(name)` | `getSkillByName(workspaceId, name)` |
| `listSkills(skillType?)` | `listSkills(workspaceId, skillType?)` |
| `attachSkillToAgent(agentId, skillName, ...)` | `attachSkillToAgent(workspaceId, agentId, skillName, ...)` |
| `detachSkillFromAgent(agentId, skillId, userId)` | `detachSkillFromAgent(workspaceId, agentId, skillId, userId)` |
| `getAgentSkills(agentId)` | `getAgentSkills(workspaceId, agentId)` |

**`src/modules/self-evolution/index.ts`** (5 functions):

| Before | After |
|--------|-------|
| `createProposal(agentId, action, description, diff)` | `createProposal(workspaceId, agentId, action, description, diff)` |
| `approveProposal(proposalId, userId)` | `approveProposal(workspaceId, proposalId, userId)` |
| `rejectProposal(proposalId, userId)` | `rejectProposal(workspaceId, proposalId, userId)` |
| `getPendingProposals(agentId?)` | `getPendingProposals(workspaceId, agentId?)` |
| `getProposalHistory(agentId)` | `getProposalHistory(workspaceId, agentId)` |

**`src/modules/self-improvement/index.ts`** (3 functions):

| Before | After |
|--------|-------|
| `generatePromptDiff(currentPrompt, critique, runOutput)` | `generatePromptDiff(workspaceId, currentPrompt, critique, runOutput)` |
| `applyPromptDiff(agentId, newPrompt, changeNote, changedBy)` | `applyPromptDiff(workspaceId, agentId, newPrompt, changeNote, changedBy)` |
| `revertToVersion(agentId, version, changedBy)` | `revertToVersion(workspaceId, agentId, version, changedBy)` |

**`src/modules/self-authoring/index.ts`** (14 functions):

| Before | After |
|--------|-------|
| `authorTool(agentId, taskDescription)` | `authorTool(workspaceId, agentId, taskDescription)` |
| `updateToolCode(toolName, newCode, language, userId)` | `updateToolCode(workspaceId, toolName, newCode, language, userId)` |
| `rollbackTool(toolName, version, userId)` | `rollbackTool(workspaceId, toolName, version, userId)` |
| `getToolVersions(toolName)` | `getToolVersions(workspaceId, toolName)` |
| `recordToolRun(toolName, agentId, success, ...)` | `recordToolRun(workspaceId, toolName, agentId, success, ...)` |
| `getToolAnalytics(toolName)` | `getToolAnalytics(workspaceId, toolName)` |
| `getAllToolAnalytics(agentId?)` | `getAllToolAnalytics(workspaceId, agentId?)` |
| `shareToolWithAgent(toolName, fromAgentId, toAgentId)` | `shareToolWithAgent(workspaceId, toolName, fromAgentId, toAgentId)` |
| `discoverTools(queryText, agentId?)` | `discoverTools(workspaceId, queryText, agentId?)` |
| `createToolPipeline(agentId, pipeline)` | `createToolPipeline(workspaceId, agentId, pipeline)` |
| `authorSkill(agentId, taskDescription)` | `authorSkill(workspaceId, agentId, taskDescription)` |
| `getMcpConfigs(agentId)` | `getMcpConfigs(workspaceId, agentId)` |
| `getCodeArtifacts(agentId)` | `getCodeArtifacts(workspaceId, agentId)` |
| `getAuthoredSkills(agentId)` | `getAuthoredSkills(workspaceId, agentId)` |

**`src/modules/observability/index.ts`** (3 functions):

| Before | After |
|--------|-------|
| `checkAlerts()` | `checkAlerts(workspaceId)` |
| `generateDailyDigest()` | `generateDailyDigest(workspaceId)` |
| `getRunByTraceId(traceId)` | `getRunByTraceId(workspaceId, traceId)` |

**`src/modules/dashboard/index.ts`** (2 functions):

| Before | After |
|--------|-------|
| `buildDashboardBlocks()` | `buildDashboardBlocks(workspaceId)` |
| `getMetrics(days)` | `getMetrics(workspaceId, days)` |

**`src/modules/document-filling/index.ts`** (2 functions):

| Before | After |
|--------|-------|
| `fillFields(fields, options)` | `fillFields(workspaceId, fields, options)` |
| `processTemplate(template, options)` | `processTemplate(workspaceId, template, options)` |

**`src/modules/model-selection/index.ts`** (2 functions):

| Before | After |
|--------|-------|
| `setAgentModel(agentId, model, userId)` | `setAgentModel(workspaceId, agentId, model, userId)` |
| `getAgentModel(agentId)` | `getAgentModel(workspaceId, agentId)` |

**`src/modules/kb-wizard/index.ts`** (2 functions):

| Before | After |
|--------|-------|
| `completeWizard(state)` | `completeWizard(workspaceId, state)` |
| `createAgentContribution(agentId, content, suggestions)` | `createAgentContribution(workspaceId, agentId, content, suggestions)` |

**`src/modules/permissions/index.ts`**: No change (stateless utility, no DB queries).

**Total**: ~150 function signatures gain `workspaceId` parameter.

### 2.5 Workspace-Aware Slack Client

**File**: `src/slack/index.ts`

Add a client factory that works in both modes:

```typescript
const clientCache = new Map<string, { client: WebClient; expiresAt: number }>();

export async function getSlackClient(workspaceId: string): Promise<WebClient> {
  // In self-hosted: always return the single app.client
  // In SaaS: look up workspace tokens, cache with TTL
  const cached = clientCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;

  const workspace = await getWorkspace(workspaceId);
  const client = new WebClient(workspace.bot_token);
  clientCache.set(workspaceId, { client, expiresAt: Date.now() + 300_000 });
  return client;
}
```

### 2.6 Update Worker, Scheduler, Sync

**File**: `src/worker.ts`
```typescript
// Extract workspaceId from job data, pass to executeAgentRun
// executeAgentRun already gets it from job.data.workspaceId
```

**File**: `src/scheduler.ts`
```typescript
const dueTriggers = await getScheduledTriggersDue(); // cross-workspace
for (const trigger of dueTriggers) {
  await fireTrigger(trigger.workspace_id, { /* ... */ });
}
```

**File**: `src/sync.ts`
```typescript
// Source sync — cross-workspace query, then process per-workspace
const sourcesDue = await getSourcesDueForSync();
for (const source of sourcesDue) {
  await startSync(source.workspace_id, source.id);
}

// Alerts & digest — iterate all workspaces
const workspaces = await listActiveWorkspaces();
for (const ws of workspaces) {
  const alerts = await checkAlerts(ws.id);
  const client = await getSlackClient(ws.id);
  // ...
}
```

### 2.7 Docker Container Workspace Scoping

**File**: `src/modules/execution/index.ts`

```typescript
// Working directory — isolated per workspace
const workingDir = `/tmp/tinyhands-workspaces/${workspaceId}/${agent.id}`;
const sourceCacheDir = `/tmp/tinyhands-sources-cache/${workspaceId}/${agent.id}`;
const memoryDir = `/tmp/tinyhands-memory/${workspaceId}/${agent.id}`;

// Container labels
Labels: {
  'tinyhands.workspace_id': workspaceId,
  'tinyhands.agent_id': agent.id,
  'tinyhands.trace_id': traceId,
},
```

### 2.8 Testing

- All 1912+ existing tests updated with workspaceId parameter.
- Every module function tested with workspace scoping.
- Integration test: two workspaces, full agent lifecycle in each, zero cross-talk.

---

## Phase 3: Workspace-Scoped Redis & Queue

**Goal**: Namespace all Redis keys by workspace. Update queue to carry workspace context.

**Repo**: `tinyhands` (core)

### 3.1 Scoped Redis Keys

**File**: `src/queue/index.ts`

| Current Key Pattern | New Key Pattern |
|-------------------|-----------------|
| `tinyhands:rate_limiter:tpm:{minute}` | `tinyhands:{wsId}:rate_limiter:tpm:{minute}` |
| `tinyhands:rate_limiter:rpm:{minute}` | `tinyhands:{wsId}:rate_limiter:rpm:{minute}` |
| `tinyhands:inflight_tokens` | `tinyhands:{wsId}:inflight_tokens` |
| `tinyhands:rate_limited` | `tinyhands:{wsId}:rate_limited` |
| `tinyhands:dedup:{key}` | `tinyhands:{wsId}:dedup:{key}` |

Functions updated:
- `checkRateLimit(workspaceId)` — scope TPM/RPM per workspace
- `recordTokenUsage(workspaceId, tokens)` — scope token tracking
- `estimateInflightUsage(workspaceId, tokens)` — scope inflight
- `checkRequestRate(workspaceId)` — scope RPM
- `handleRateLimitResponse(workspaceId, retryAfterSec)` — scope rate limit flag
- `isRateLimited(workspaceId)` — scope check
- `isDuplicateEvent(workspaceId, key)` — scope dedup

### 3.2 Queue Job Data

`JobData` already includes `workspaceId` (Phase 2.1). Single `tinyhands-runs` queue, workspace in each job. Workers extract and propagate.

### 3.3 Buffer Redis Keys

**File**: `src/slack/buffer.ts`

Buffer keys already use `channelId:threadTs:agentId`. No workspace prefix needed since channel IDs are globally unique in Slack. But the buffer's Slack API calls must use `getSlackClient(workspaceId)`.

### 3.4 Testing

- Rate limit keys from workspace A are invisible to workspace B.
- Dedup keys scoped per workspace.
- Existing queue tests updated with workspaceId.

---

# SAAS REPO (NEW)

These phases create the `tinyhands-cloud` repo, which imports core as a submodule and adds SaaS-specific functionality.

---

## Phase 4: SaaS Repo Setup & Slack OAuth

**Goal**: Set up the SaaS repo, replace Socket Mode with HTTP Events API, build OAuth v2 install flow.

**Repo**: `tinyhands-cloud` (new)

### 4.1 Repository Setup

```bash
mkdir tinyhands-cloud && cd tinyhands-cloud
git init
git submodule add git@github.com:you/tinyhands.git core
npm init
```

**`package.json`** dependencies:
```json
{
  "dependencies": {
    "@slack/bolt": "...",
    "@slack/web-api": "...",
    "stripe": "...",
    "express": "..."
  }
}
```

TypeScript path aliases so SaaS code can import from core:
```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@core/*": ["./core/src/*"]
    }
  }
}
```

### 4.2 SaaS Config

**New file**: `src/config.ts`

Extends core config with SaaS-specific variables:

```typescript
import { config as coreConfig } from '@core/config';

export const config = {
  ...coreConfig,
  slack: {
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    clientId: process.env.SLACK_CLIENT_ID!,
    clientSecret: process.env.SLACK_CLIENT_SECRET!,
    // No botToken or appToken — tokens come from DB per workspace
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY!,  // 32-byte base64
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  },
  platform: {
    adminIds: (process.env.PLATFORM_ADMIN_IDS || '').split(',').filter(Boolean),
    freeTrialCredits: parseInt(process.env.FREE_TRIAL_CREDITS || '50000'), // $5.00
  },
};
```

### 4.3 SaaS Listener (HTTP Events API)

**New file**: `src/index.ts`

Replaces core's Socket Mode listener with HTTP Events API + `authorize` callback:

```typescript
import { App, ExpressReceiver } from '@slack/bolt';
import { getCachedWorkspace } from './modules/workspaces';
import { decrypt } from './utils/encryption';
import { registerEvents } from '@core/slack/events';
import { registerCommands } from '@core/slack/commands';
import { mountRoutes } from './server';

const receiver = new ExpressReceiver({
  signingSecret: config.slack.signingSecret,
  endpoints: '/slack/events',
  processBeforeResponse: true,
});

const app = new App({
  receiver,
  authorize: async ({ teamId }) => {
    const workspace = await getCachedWorkspace(teamId);
    if (!workspace || workspace.status !== 'active')
      throw new Error(`Workspace ${teamId} not installed or suspended`);
    return {
      botToken: decrypt(workspace.bot_token),
      botId: workspace.bot_id,
      botUserId: workspace.bot_user_id,
      teamId: workspace.id,
    };
  },
});

// Register core event/command handlers (they work unchanged)
registerEvents(app);
registerCommands(app);
registerSaasCommands(app);  // /credits, /platform

// Mount SaaS routes (OAuth, Stripe, landing page)
mountRoutes(receiver.app);

await app.start(config.server.port);
```

### 4.4 OAuth Module

**New file**: `src/slack/oauth.ts`

```typescript
export function getInstallUrl(state: string): string {
  const scopes = [
    'commands', 'chat:write', 'chat:write.customize',
    'channels:read', 'channels:join', 'channels:history',
    'groups:history', 'im:history', 'mpim:history',
    'users:read', 'app_mentions:read', 'files:read',
    'reactions:read',
  ].join(',');
  return `https://slack.com/oauth/v2/authorize?client_id=${config.slack.clientId}&scope=${scopes}&state=${state}`;
}

export async function handleOAuthCallback(code: string, state: string): Promise<Workspace> {
  // 1. Verify state from Redis (CSRF protection)
  // 2. POST https://slack.com/api/oauth.v2.access
  // 3. Encrypt tokens with AES-256-GCM
  // 4. Create workspace record (core's workspaces table + SaaS columns)
  // 5. Initialize first superadmin
  // 6. Grant free trial credits
  // 7. Send onboarding DM
  // 8. Return workspace
}
```

### 4.5 Workspace CRUD Module

**New file**: `src/modules/workspaces/index.ts`

```typescript
export async function createWorkspace(data: SlackOAuthV2Response): Promise<Workspace> { ... }
export async function getWorkspace(teamId: string): Promise<Workspace | null> { ... }
export async function getCachedWorkspace(teamId: string): Promise<Workspace | null> {
  // In-memory cache with 5-minute TTL
}
export async function updateWorkspaceTokens(teamId: string, tokens: TokenData): Promise<void> { ... }
export async function deactivateWorkspace(teamId: string): Promise<void> { ... }
export async function listActiveWorkspaces(): Promise<Workspace[]> { ... }
export async function suspendWorkspace(teamId: string, reason: string): Promise<void> { ... }
```

### 4.6 SaaS Server Routes

**New file**: `src/server.ts`

```typescript
import { mountRoutes as mountCoreRoutes } from '@core/server';

export function mountRoutes(expressApp: express.Application): void {
  // Core webhook routes
  mountCoreRoutes(expressApp);

  // OAuth
  expressApp.get('/slack/oauth/install', handleInstallPage);
  expressApp.get('/slack/oauth/callback', handleOAuthCallback);

  // Stripe
  expressApp.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

  // Landing page
  expressApp.get('/', serveLandingPage);

  // Workspace-scoped webhooks (multi-tenant)
  expressApp.post('/webhooks/:workspaceId/agent-:agentName', handleAgentWebhook);
  expressApp.post('/webhooks/:workspaceId/linear', handleLinearWebhook);
  expressApp.post('/webhooks/:workspaceId/zendesk', handleZendeskWebhook);
  expressApp.post('/webhooks/:workspaceId/intercom', handleIntercomWebhook);
}
```

### 4.7 Token Rotation & Uninstall Events

```typescript
app.event('tokens_revoked', async ({ context }) => {
  await deactivateWorkspace(context.teamId);
});

app.event('app_uninstalled', async ({ context }) => {
  await deactivateWorkspace(context.teamId);
});
```

### 4.8 Testing

- Mock `authorize` callback, verify correct tokens for different team_ids.
- Simulate full OAuth callback with mock Slack API.
- Test event routing: two workspaces, correct bot tokens used.

---

## Phase 5: Tenant Isolation & Credentials

**Goal**: Row-Level Security, encrypted credentials, per-workspace tool API keys.

**Repo**: `tinyhands-cloud`

### 5.1 Row-Level Security

**Migration**: `src/db/migrations/012_row_level_security.sql`

```sql
-- Enable RLS on all tables as defense-in-depth
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_history ENABLE ROW LEVEL SECURITY;
-- ... all 29 tables ...

CREATE POLICY agents_ws_policy ON agents
  USING (workspace_id = current_setting('app.workspace_id', true));
-- ... all 29 tables ...
```

### 5.2 Encryption Utility

**New file**: `src/utils/encryption.ts`

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(config.encryption.key, 'base64'); // 32 bytes

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const [ivB64, tagB64, encrypted] = ciphertext.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY,
    Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### 5.3 Per-Workspace Credentials Table

**Migration**: `src/db/migrations/013_workspace_credentials.sql`

```sql
-- SaaS-specific columns on workspaces table
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS refresh_token TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;  -- Optional BYOK, encrypted

-- Per-workspace tool credentials
CREATE TABLE IF NOT EXISTS workspace_credentials (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_id TEXT NOT NULL,        -- 'hubspot', 'linear', 'zendesk', etc.
  credential_mode TEXT NOT NULL DEFAULT 'byok',  -- 'platform' | 'byok' | 'oauth'
  config_encrypted TEXT NOT NULL,       -- AES-256-GCM encrypted JSON
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, integration_id)
);
```

### 5.4 Credential Mode by Integration

| Integration | Default Mode | Who Pays Upstream |
|------------|-------------|-------------------|
| Anthropic | `platform` | Platform owner (you) |
| SerpAPI | `platform` | Platform owner (you) |
| HubSpot | `byok` | Customer (their own key) |
| Linear | `byok` | Customer (their own key) |
| Zendesk | `byok` | Customer (their own key) |
| Chargebee | `byok` | Customer (their own key) |
| PostHog | `byok` | Customer (their own key) |
| Google Drive | `oauth` | Customer (their own account) |
| GitHub | `byok` | Customer (their own token) |

### 5.5 SaaS Worker — Credential Injection

**New file**: `src/worker.ts`

Wraps core's `executeAgentRun` to inject per-workspace credentials:

```typescript
import { executeAgentRun } from '@core/modules/execution';
import { getWorkspaceCredential } from './modules/workspaces';
import { decrypt } from './utils/encryption';

// Before container creation, override tool configs:
// For each tool the agent uses:
const cred = await getWorkspaceCredential(workspaceId, toolName);
if (cred) {
  const config = JSON.parse(decrypt(cred.config_encrypted));
  // Inject into container as /tools/{toolName}.config.json
}

// Anthropic key: workspace BYOK or platform key
const anthropicKey = workspace.anthropic_api_key
  ? decrypt(workspace.anthropic_api_key)
  : coreConfig.anthropic.apiKey;
```

### 5.6 Testing

- RLS test: Remove workspace_id from a query, verify RLS blocks it.
- Encrypt/decrypt round-trip.
- Workspace A's credentials invisible to workspace B.
- BYOK vs platform credential routing.

---

## Phase 6: Credit System & Usage Metering

**Goal**: Credit-based pay-as-you-go billing. Customers buy credits. Platform owner sets prices with upstream cost tracking.

**Repo**: `tinyhands-cloud`

### 6.1 New Tables

**Migration**: `src/db/migrations/014_credit_system.sql`

```sql
-- Pricing catalog (platform owner sets prices)
CREATE TABLE IF NOT EXISTS pricing_catalog (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  action_type TEXT NOT NULL,            -- 'ai_tokens' | 'tool_call' | 'kb_operation' | etc.
  action_name TEXT NOT NULL,            -- 'sonnet_input' | 'serpapi_search' | etc.
  unit TEXT NOT NULL,                   -- 'per_1k_tokens' | 'per_call' | etc.
  cost_per_unit INTEGER NOT NULL,       -- YOUR upstream cost (hundredths of a cent)
  price_per_unit INTEGER NOT NULL,      -- What you CHARGE customer (hundredths of a cent)
  enabled BOOLEAN NOT NULL DEFAULT true,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_pricing_action ON pricing_catalog(action_type, action_name, effective_from);

-- Per-workspace credit balance
CREATE TABLE IF NOT EXISTS workspace_credits (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,              -- Hundredths of a cent
  lifetime_purchased INTEGER NOT NULL DEFAULT 0,
  lifetime_used INTEGER NOT NULL DEFAULT 0,
  low_balance_threshold INTEGER NOT NULL DEFAULT 50000,  -- $5.00
  auto_recharge_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_recharge_amount INTEGER,
  auto_recharge_below INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every billable event
CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  type TEXT NOT NULL,                   -- 'purchase' | 'usage' | 'refund' | 'adjustment'
  amount INTEGER NOT NULL,              -- Positive=purchase, negative=usage (hundredths of cent)
  balance_after INTEGER NOT NULL,
  description TEXT NOT NULL,            -- "Sonnet: 8.2K in, 2.1K out"
  stripe_payment_id TEXT,
  run_id TEXT,
  agent_id TEXT,
  action_type TEXT,
  action_name TEXT,
  upstream_cost INTEGER,                -- What it cost YOU (hundredths of cent)
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_credit_tx_ws ON credit_transactions(workspace_id, created_at);
CREATE INDEX idx_credit_tx_type ON credit_transactions(workspace_id, type);
CREATE INDEX idx_credit_tx_run ON credit_transactions(run_id);
```

### 6.2 Default Pricing Catalog (Seed Data)

```sql
INSERT INTO pricing_catalog (action_type, action_name, unit, cost_per_unit, price_per_unit, enabled) VALUES
  -- AI Tokens (always enabled — primary revenue)
  -- Values in hundredths of a cent per 1K tokens
  ('ai_tokens', 'opus_input',       'per_1k_tokens', 1500,  2000,  true),   -- cost $0.015, charge $0.020
  ('ai_tokens', 'opus_output',      'per_1k_tokens', 7500,  10000, true),   -- cost $0.075, charge $0.100
  ('ai_tokens', 'sonnet_input',     'per_1k_tokens', 300,   400,   true),   -- cost $0.003, charge $0.004
  ('ai_tokens', 'sonnet_output',    'per_1k_tokens', 1500,  2000,  true),   -- cost $0.015, charge $0.020
  ('ai_tokens', 'haiku_input',      'per_1k_tokens', 25,    40,    true),   -- cost $0.00025, charge $0.0004
  ('ai_tokens', 'haiku_output',     'per_1k_tokens', 125,   200,   true),   -- cost $0.00125, charge $0.002

  -- Platform-provided tools (you pay upstream, enabled)
  ('tool_call', 'serpapi_search',    'per_call',      500,   1000,  true),   -- cost $0.005, charge $0.01

  -- BYOK tool calls (customer pays upstream, OFF by default = free)
  ('tool_call', 'hubspot_call',     'per_call',      0,     0,     false),
  ('tool_call', 'linear_call',      'per_call',      0,     0,     false),
  ('tool_call', 'zendesk_call',     'per_call',      0,     0,     false),
  ('tool_call', 'chargebee_call',   'per_call',      0,     0,     false),
  ('tool_call', 'posthog_call',     'per_call',      0,     0,     false),
  ('tool_call', 'custom_tool_call', 'per_call',      0,     0,     false),
  ('tool_call', 'mcp_call',         'per_call',      0,     0,     false),

  -- KB operations (internal compute, OFF = free)
  ('kb_operation', 'kb_search',      'per_call',     0,     0,     false),
  ('kb_operation', 'kb_create',      'per_entry',    0,     0,     false),
  ('kb_operation', 'kb_source_sync', 'per_sync',     0,     0,     false),

  -- Source operations (OFF = free)
  ('source_operation', 'source_ingest',    'per_file',  0,  0,     false),
  ('source_operation', 'context_retrieve', 'per_call',  0,  0,     false),
  ('source_operation', 'memory_op',        'per_call',  0,  0,     false),

  -- Orchestration fees (OFF = free)
  ('execution', 'agent_run',        'per_run',       0,     0,     false),
  ('execution', 'sub_agent_run',    'per_run',       0,     0,     false),

  -- Triggers (OFF = free)
  ('trigger', 'trigger_fire',       'per_fire',      0,     0,     false),

  -- Self-authoring (OFF = free, AI tokens already charged)
  ('authoring', 'tool_generation',   'per_generation', 0,   0,     false),
  ('authoring', 'code_artifact',     'per_artifact',   0,   0,     false),
  ('authoring', 'doc_fill',          'per_document',   0,   0,     false);
```

**Key**: `enabled = false` means the action is free. Toggle `enabled = true` and set `price_per_unit` to start charging. AI tokens and SerpAPI are on by default.

### 6.3 Billing Module

**New file**: `src/modules/billing/index.ts`

```typescript
// Core metering function — called at every billable point
export async function meter(
  workspaceId: string,
  actionType: string,
  actionName: string,
  opts: {
    quantity: number;
    runId?: string;
    agentId?: string;
    detail?: string;
    credentialMode?: 'platform' | 'byok' | 'oauth';
  }
): Promise<{ charged: boolean; amount: number }> {
  // 1. Look up current price from pricing_catalog
  //    WHERE action_type = $1 AND action_name = $2 AND enabled = true
  //    AND effective_from <= NOW() ORDER BY effective_from DESC LIMIT 1
  //
  // 2. If not found or not enabled → { charged: false, amount: 0 }
  //
  // 3. Calculate: totalPrice = price_per_unit * quantity
  //              upstreamCost = cost_per_unit * quantity
  //
  // 4. Atomic: UPDATE workspace_credits SET balance = balance - totalPrice
  //            WHERE workspace_id = $1 RETURNING balance
  //
  // 5. INSERT credit_transactions (type='usage', amount=-totalPrice, ...)
  //
  // 6. If balance < low_balance_threshold → queue low-balance notification
  //
  // 7. Return { charged: true, amount: totalPrice }
}

// Pre-run credit check
export async function checkCredits(workspaceId: string): Promise<{
  allowed: boolean;
  balance: number;
  reason?: string;
}> { ... }

// Credit balance + usage summary
export async function getCreditSummary(workspaceId: string, periodDays?: number): Promise<CreditSummary> { ... }

// Add credits (purchase or adjustment)
export async function addCredits(
  workspaceId: string,
  amountHundredths: number,
  stripePaymentId?: string,
  description?: string,
): Promise<{ newBalance: number }> { ... }

// Platform admin: all workspace balances
export async function getAllBalances(): Promise<WorkspaceBalance[]> { ... }

// Platform admin: revenue/cost/margin report
export async function getRevenueReport(periodDays: number): Promise<RevenueReport> { ... }
```

### 6.4 Metering Integration Points (SaaS Worker)

The SaaS worker wraps core's `executeAgentRun` and adds metering at every billable point:

**File**: `src/worker.ts`

```typescript
export async function executeAgentRunWithBilling(job: Job<JobData>): Promise<string> {
  const { workspaceId, agentId } = job.data;

  // 1. Pre-run: credit check
  const check = await checkCredits(workspaceId);
  if (!check.allowed) {
    const client = await getSlackClient(workspaceId);
    await client.chat.postMessage({
      channel: job.data.channelId,
      thread_ts: job.data.threadTs,
      text: '⚠️ Credits depleted. Use `/credits` to purchase more.',
    });
    throw new Error('Credits depleted');
  }

  // 2. Meter orchestration fee (if enabled)
  await meter(workspaceId, 'execution', 'agent_run', {
    quantity: 1, agentId,
    detail: `Agent run: ${agent.name}`,
  });

  // 3. Execute core agent run
  const result = await executeAgentRun(job);

  // 4. Post-run: meter AI tokens
  const model = result.model || 'sonnet';
  await meter(workspaceId, 'ai_tokens', `${model}_input`, {
    quantity: Math.ceil(result.inputTokens / 1000),
    runId: result.runId, agentId,
    detail: `${model}: ${result.inputTokens} input tokens`,
  });
  await meter(workspaceId, 'ai_tokens', `${model}_output`, {
    quantity: Math.ceil(result.outputTokens / 1000),
    runId: result.runId, agentId,
    detail: `${model}: ${result.outputTokens} output tokens`,
  });

  // 5. Meter tool calls (parsed from run output)
  for (const toolCall of result.toolCalls) {
    const actionName = TOOL_ACTION_MAP[toolCall.name] || 'custom_tool_call';
    const credMode = TOOL_CRED_MODE[toolCall.name] || 'byok';
    await meter(workspaceId, 'tool_call', actionName, {
      quantity: toolCall.name === 'serpapi_batch_search'
        ? (toolCall.input?.keywords?.length || 1) : 1,
      runId: result.runId, agentId,
      credentialMode: credMode,
      detail: `${toolCall.name} API call`,
    });
  }

  return result;
}
```

**Tool action mapping**:

```typescript
const TOOL_ACTION_MAP: Record<string, string> = {
  'serpapi_search': 'serpapi_search',
  'serpapi_batch_search': 'serpapi_search',
  'hubspot_search_contacts': 'hubspot_call',
  'hubspot_create_contact': 'hubspot_call',
  // ... all HubSpot operations
  'linear_search_issues': 'linear_call',
  'linear_create_issue': 'linear_call',
  // ... all Linear operations
  'zendesk_search': 'zendesk_call',
  'zendesk_create_ticket': 'zendesk_call',
  // ... all Zendesk operations
  'chargebee_list_customers': 'chargebee_call',
  // ... all Chargebee operations
  'posthog_query_events': 'posthog_call',
  // ... all PostHog operations
};

const TOOL_CRED_MODE: Record<string, string> = {
  'serpapi_search': 'platform',
  'serpapi_batch_search': 'platform',
  // Everything else defaults to 'byok'
};
```

**Additional metering in SaaS wrappers for**:
- KB search/create → `meter(ws, 'kb_operation', 'kb_search', ...)`
- KB source sync → `meter(ws, 'kb_operation', 'kb_source_sync', ...)`
- Source ingest → `meter(ws, 'source_operation', 'source_ingest', ...)`
- Context retrieve → `meter(ws, 'source_operation', 'context_retrieve', ...)`
- Memory ops → `meter(ws, 'source_operation', 'memory_op', ...)`
- Trigger fires → `meter(ws, 'trigger', 'trigger_fire', ...)`
- Tool authoring → `meter(ws, 'authoring', 'tool_generation', ...)`
- Document fills → `meter(ws, 'authoring', 'doc_fill', ...)`
- Sub-agent spawns → `meter(ws, 'execution', 'sub_agent_run', ...)`

### 6.5 Stripe Integration

**New file**: `src/modules/billing/stripe.ts`

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(config.stripe.secretKey);

// Create checkout session for credit purchase
export async function createCheckoutSession(
  workspaceId: string,
  amountCents: number,       // 5000 = $50.00
  successUrl: string,
  cancelUrl: string,
): Promise<string> {          // Returns checkout URL
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: { name: `TinyHands Credits ($${(amountCents / 100).toFixed(2)})` },
      },
      quantity: 1,
    }],
    metadata: { workspace_id: workspaceId },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return session.url!;
}

// Handle Stripe webhooks
export async function handleStripeWebhook(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const workspaceId = session.metadata!.workspace_id;
      const amountCents = session.amount_total!;
      // Convert dollars to hundredths of a cent: $50.00 → 5000000
      await addCredits(workspaceId, amountCents * 100, session.payment_intent as string,
        `Credit purchase: $${(amountCents / 100).toFixed(2)}`);
      // DM workspace admin
      const ws = await getWorkspace(workspaceId);
      const client = await getSlackClient(workspaceId);
      const newBal = (await getCreditSummary(workspaceId)).balance;
      await client.chat.postMessage({
        channel: ws.authed_user_id,
        text: `✅ $${(amountCents / 100).toFixed(2)} credits added. Balance: $${formatDollars(newBal)}`,
      });
      break;
    }
    case 'charge.refunded': {
      // Deduct refunded amount
      break;
    }
  }
}
```

### 6.6 `/credits` Slash Command

**File**: `src/slack/commands-saas.ts`

```typescript
export function registerSaasCommands(app: App): void {
  app.command('/credits', async ({ command, ack, client }) => {
    await ack();
    const workspaceId = command.team_id;
    const summary = await getCreditSummary(workspaceId, 30);

    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '💳 Credit Balance' } },
        { type: 'section', text: { type: 'mrkdwn',
          text: `*Balance:* $${formatDollars(summary.balance)}\n\n`
            + `*Usage (last 30 days):*\n`
            + summary.breakdown.map(b =>
                `  ${b.label}: $${formatDollars(b.amount)}`
              ).join('\n')
            + `\n  *Total:* $${formatDollars(summary.totalUsed)}`,
        }},
        { type: 'actions', elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Buy $10' },
            action_id: 'buy_credits', value: '1000' },
          { type: 'button', text: { type: 'plain_text', text: 'Buy $50' },
            action_id: 'buy_credits', value: '5000' },
          { type: 'button', text: { type: 'plain_text', text: 'Buy $100' },
            action_id: 'buy_credits', value: '10000' },
        ]},
      ],
    });
  });
}
```

### 6.7 Low Balance Notification

Triggered inside `meter()` when balance drops below threshold:

```typescript
if (newBalance <= threshold && previousBalance > threshold) {
  const client = await getSlackClient(workspaceId);
  await client.chat.postMessage({
    channel: workspace.authed_user_id,
    text: `⚠️ Low credits: $${formatDollars(newBalance)} remaining. Use \`/credits\` to buy more.`,
  });
}
```

### 6.8 Testing

- Metering: Run agent, verify credit_transactions with correct amounts.
- Balance: Buy credits, run agent, verify decrement.
- Depletion: Set balance to 0, attempt run, verify blocked.
- Low balance: Verify notification at threshold.
- Pricing toggle: Disable action, verify free. Enable, verify charged.
- Margin: Verify upstream_cost < price in all transactions.
- Stripe: Mock webhook, verify credits added.

---

## Phase 7: Onboarding, Admin & UX

**Goal**: Self-service install, workspace settings, platform admin tools.

**Repo**: `tinyhands-cloud`

### 7.1 Landing Page

**New file**: `landing/index.html`

Simple page with "Add to Slack" button. Served from `GET /`.

### 7.2 Post-Install Onboarding

After OAuth callback succeeds:

```typescript
const client = await getSlackClient(workspaceId);
await client.chat.postMessage({
  channel: workspace.authed_user_id,
  text: 'Welcome to TinyHands!',
  blocks: [
    { type: 'header', text: { type: 'plain_text', text: 'Welcome to TinyHands!' } },
    { type: 'section', text: { type: 'mrkdwn',
      text: `Your workspace has *$${formatDollars(freeTrialCredits)}* in free credits.\n\n`
        + '*Quick start:*\n'
        + '1. `/new-agent` — Create your first AI agent\n'
        + '2. `/tools` — Connect integrations\n'
        + '3. `/credits` — Check balance & buy credits\n'
        + '4. `/kb` — Add knowledge base articles',
    }},
  ],
});
```

### 7.3 Dashboard Credit Section

The SaaS worker provides additional data to the core dashboard. The core `buildDashboardBlocks(workspaceId)` handles agent/run metrics. The SaaS layer appends a credits section:

```typescript
import { buildDashboardBlocks } from '@core/modules/dashboard';

export async function buildSaasDashboard(workspaceId: string) {
  const coreBlocks = await buildDashboardBlocks(workspaceId);
  const credits = await getCreditSummary(workspaceId);

  return [
    ...coreBlocks,
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn',
      text: `*💳 Credits:* $${formatDollars(credits.balance)}\n`
        + `*📊 This month:* $${formatDollars(credits.monthlyUsed)} used`,
    },
    accessory: {
      type: 'button',
      text: { type: 'plain_text', text: 'Buy Credits' },
      action_id: 'open_buy_credits',
    }},
  ];
}
```

### 7.4 Platform Admin Module

**New file**: `src/modules/platform-admin/index.ts`

```typescript
export async function listAllWorkspaces(): Promise<WorkspaceSummary[]> { ... }
export async function getWorkspaceDetail(teamId: string): Promise<WorkspaceDetail> { ... }
export async function suspendWorkspace(teamId: string, reason: string): Promise<void> { ... }
export async function reactivateWorkspace(teamId: string): Promise<void> { ... }
export async function adjustCredits(teamId: string, amount: number, reason: string): Promise<void> { ... }
export async function updatePricing(actionType: string, actionName: string, updates: PricingUpdate): Promise<void> { ... }
export async function getPlatformMetrics(): Promise<PlatformMetrics> { ... }
export async function getRevenueReport(days: number): Promise<RevenueReport> { ... }
```

### 7.5 `/platform` Admin Command

```typescript
app.command('/platform', async ({ command, ack, client }) => {
  // Only PLATFORM_ADMIN_IDS can use this
  // Subcommands:
  //   /platform workspaces     — list all workspaces + balances
  //   /platform revenue        — revenue / cost / margin report
  //   /platform pricing        — view / update pricing catalog
  //   /platform suspend <ws>   — suspend a workspace
  //   /platform credits <ws> <amt> — adjust credits
});
```

**Customer view** (`/platform revenue`):
```
💰 Revenue & Margins (March 2026)
──────────────────────────────────────
                Revenue    Cost    Margin
AI Tokens       $842.30   $561.50   33%
SerpAPI          $127.80    $21.30   83%
Tool calls        $0.00     $0.00    —
──────────────────────────────────────
Total          $970.10   $582.80   40%
```

### 7.6 Uninstall Handling

```typescript
app.event('app_uninstalled', async ({ context }) => {
  await deactivateWorkspace(context.teamId);
  // Data retained 30 days, then purged by cleanup cron
});
```

### 7.7 Testing

- Full install flow → onboarding DM → agent creation → run → credit deduction.
- Platform admin commands restricted to PLATFORM_ADMIN_IDS.
- Revenue report accuracy.

---

## Phase 8: Infrastructure & Deployment

**Goal**: SaaS deployment, scaling, monitoring.

**Repo**: `tinyhands-cloud`

### 8.1 Process Architecture

| Process | Source | Change from Core |
|---------|--------|-----------------|
| Listener | `tinyhands-cloud/src/index.ts` | HTTP Events API + OAuth (not Socket Mode) |
| Workers | `tinyhands-cloud/src/worker.ts` | Wraps core execution with metering |
| Scheduler | Wraps `@core/scheduler` | Propagates workspace_id from triggers |
| Sync | Wraps `@core/sync` | Iterates all workspaces, per-workspace Slack clients |

### 8.2 PM2 Ecosystem

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    { name: 'saas-listener', script: 'dist/index.js', instances: 1 },
    { name: 'saas-worker-1', script: 'dist/worker.js' },
    { name: 'saas-worker-2', script: 'dist/worker.js' },
    { name: 'saas-worker-3', script: 'dist/worker.js' },
    { name: 'saas-scheduler', script: 'dist/scheduler.js', instances: 1 },
    { name: 'saas-sync', script: 'dist/sync.js', instances: 1 },
  ],
};
```

### 8.3 Scaling

| Resource | Notes |
|----------|-------|
| Listener | Stateless HTTP → can be load-balanced |
| Workers | Add more for higher throughput |
| Scheduler | Single instance (or Redis leader election) |
| Sync | Single instance (or Redis leader election) |
| PostgreSQL | 50-100 connections, PgBouncer for large scale |
| Redis | Single instance fine for hundreds of workspaces |

### 8.4 Webhook URL Pattern

Multi-tenant webhook URLs include workspace:

```
/webhooks/{workspaceId}/agent-{agentName}
/webhooks/{workspaceId}/linear
/webhooks/{workspaceId}/zendesk
/webhooks/{workspaceId}/intercom
```

### 8.5 SaaS Environment Variables

```
# Slack (SaaS mode — no BOT_TOKEN or APP_TOKEN)
SLACK_SIGNING_SECRET
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET

# Core
ANTHROPIC_API_KEY          # Platform's default key
DATABASE_URL
REDIS_URL

# SaaS-specific
ENCRYPTION_KEY             # 32-byte base64 AES-256 key
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
PLATFORM_ADMIN_IDS         # Comma-separated Slack user IDs
FREE_TRIAL_CREDITS         # Hundredths of a cent (default 50000 = $5.00)

# Docker
DOCKER_BASE_IMAGE
DOCKER_DEFAULT_CPU
DOCKER_DEFAULT_MEMORY
```

### 8.6 Monitoring

Per-workspace monitoring via the existing observability module (now workspace-scoped). Platform-level monitoring via `/platform` command.

### 8.7 Testing

- Load test with 10+ simulated workspaces.
- Scheduler fires triggers from multiple workspaces.
- Sync processes all workspaces correctly.
- Webhook routing by workspace.

---

## Complete Summary

### Core Repo (`tinyhands`) Changes

| Area | Files | Nature of Change |
|------|-------|-----------------|
| Migrations | 2 new (010, 011) | workspaces table, workspace_id columns, indexes, backfill |
| Database layer | `src/db/index.ts` | Add TenantDB class, defaultWorkspaceId helpers |
| Types | `src/types/index.ts` | Add workspaceId to JobData |
| Queue | `src/queue/index.ts` | Workspace-scoped Redis keys |
| Slack handlers | events.ts, commands.ts, actions.ts, buffer.ts | Extract team_id, pass workspaceId |
| Slack client | `src/slack/index.ts` | Add getSlackClient(workspaceId) factory |
| Entry points | index.ts, worker.ts, scheduler.ts, sync.ts | Auto-bootstrap workspace, pass workspaceId |
| All modules | 20 module directories | ~150 function signatures gain workspaceId |

**Self-hosted behavior**: Identical to today. One auto-created workspace, no billing, Socket Mode.

### SaaS Repo (`tinyhands-cloud`) — New

| Area | Files | Purpose |
|------|-------|---------|
| Entry points | index.ts, worker.ts, scheduler.ts, sync.ts | HTTP Events API, metering wrappers |
| OAuth | slack/oauth.ts | Slack OAuth v2 install/callback |
| Workspaces | modules/workspaces/index.ts | Workspace CRUD, caching |
| Billing | modules/billing/index.ts | meter(), checkCredits(), addCredits() |
| Stripe | modules/billing/stripe.ts | Checkout, webhooks, auto-recharge |
| Platform admin | modules/platform-admin/index.ts | Cross-workspace management |
| Encryption | utils/encryption.ts | AES-256-GCM for stored credentials |
| Middleware | middleware/tenant.ts | Workspace validation |
| Migrations | 3 new (012, 013, 014) | RLS, credentials, credit system |
| Commands | slack/commands-saas.ts | /credits, /platform |
| Landing page | landing/ | "Add to Slack" install page |
| Config | config.ts | SaaS-specific env vars |

### Pricing Model Summary

| Action | Enabled | Your Cost | Customer Price |
|--------|---------|-----------|---------------|
| AI tokens (Opus in) | Always | $0.015/1K | $0.020/1K |
| AI tokens (Opus out) | Always | $0.075/1K | $0.100/1K |
| AI tokens (Sonnet in) | Always | $0.003/1K | $0.004/1K |
| AI tokens (Sonnet out) | Always | $0.015/1K | $0.020/1K |
| AI tokens (Haiku in) | Always | $0.00025/1K | $0.0004/1K |
| AI tokens (Haiku out) | Always | $0.00125/1K | $0.002/1K |
| SerpAPI search | Always | $0.005/call | $0.01/call |
| HubSpot/Linear/Zendesk/etc. | Off (free) | $0.00 | $0.00 |
| KB/Source/Memory ops | Off (free) | $0.00 | $0.00 |
| Agent run orchestration | Off (free) | $0.00 | $0.00 |
| Trigger fires | Off (free) | $0.00 | $0.00 |
| Tool authoring | Off (free) | $0.00 | $0.00 |

All prices configurable via `/pricing` at any time. Toggle `enabled` to start charging for any action.
