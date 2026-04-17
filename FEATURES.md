# TinyHands Features & Workflows

Internal reference document. Source of truth for how every feature works.
Claude MUST check this before making changes and update it after commits.

---

## Multi-Tenant Workspaces

TinyHands is multi-tenant: one deployment serves many Slack workspaces. A user can belong to multiple workspaces and switch between them in the dashboard.

### Ownership split

- **Platform (TinyHands deployment operator):** Slack app + app-level token + OAuth client, PostgreSQL, Redis, worker/listener/scheduler/sync processes, Docker runner image, deploy infrastructure.
- **Workspace (admin):** Anthropic API key, tool connections (Linear, Zendesk, HubSpot, etc.), agents, KB sources, documents, triggers, memory, audit log.

### Onboarding a new workspace

Admins visit the deployment's "Add to Slack" button (which links to `/api/v1/auth/slack/install`), authorize the TinyHands Slack app, and the workspace is created automatically. The installing user becomes the first workspace admin. They then set the workspace's Anthropic API key in **Workspace Settings** (with a "Test key" button that validates it before saving).

### Sign in with Slack

Dashboard auth is Slack OAuth. Users who belong to multiple workspaces see a workspace switcher in the sidebar header. Switching changes the active workspace across every page in the dashboard; dashboard API routes enforce membership checks on every request.

### Platform admin

Operators of the TinyHands deployment (rows in `platform_admins`) can view per-workspace health aggregates at `/platform` — runs in the last 24 hours, error rate, whether a Claude key is configured. No cross-workspace data access beyond those aggregates.

### Isolation invariants

- Every tenant-data Redis key is prefixed with the workspace id (via `rkey(workspaceId, ...parts)` in `src/queue/index.ts`).
- Every agent run gets its own Docker container with a per-run secrets temp dir mounted read-only, deleted in a `finally` block on completion.
- Webhook URLs for agent triggers include the workspace slug: `/webhooks/w/{workspaceSlug}/agent/{agentSlug}`. The legacy `/webhooks/agent-{name}` form returns a 301 when it can resolve unambiguously.
- OAuth flows for third-party tools use a signed `state` parameter that carries the workspace id; the signature is verified on callback.
- The logger runs `redactSecrets()` on every log line so API keys, bot tokens, and OAuth secrets cannot leak to stdout.

---

## Agent Lifecycle

### Creating Agents

**Methods:**
- **AI Chat** (primary) -- AI-guided conversation via FloatingChat in creation mode. Opens automatically at `/agents/new`.
- **Manual Wizard** (alternative) -- Traditional 4-step form (Describe, Identity, Settings, Tools). Accessible by clicking X on the AI chat or "Or set up manually" link. User can summon the AI copilot anytime from the manual wizard via the floating sparkle button (✨) or Cmd+K.
- **Slack `/new-agent`** -- redirects to dashboard
- **API** -- `POST /api/v1/agents`

**AI Chat Creation Flow (FloatingChat in creation mode):**

When user navigates to `/agents/new`, the FloatingChat opens in creation mode (80% viewport height, 640px reading width, centered). An AI-guided conversation walks them through:

1. **Describe** (text input) -- "What would you like your agent to do?" User describes the goal in plain English. AI goal analyzer runs and generates initial config (name, prompt, model, tools, effort, memory, response mode).
2. **Clarify** (text input, conditional) -- If the description is vague, AI asks follow-up questions.
3. **Channel** (dropdown card) -- "Which Slack channel should it live in?" Searchable list of workspace channels.
4. **Activation** (multi-choice card) -- "When should it respond?" Every message / Relevant messages (recommended) / Only when @mentioned.
5. **Schedule** (yes/no + schedule card, conditional) -- "Should it run on a schedule?" Only asked if time patterns detected. Frequency + timezone picker.
6. **Triggers** (multi-choice card, conditional) -- "Any external event triggers?" Only if relevant integrations (Linear, Zendesk, etc.) are configured.
7. **Tools** (multi-select card) -- "Which services should it access?" Shows configured integrations with read/write toggles. AI pre-selects from analysis.
8. **Effort** (multi-choice card, conditional) -- "How thorough should it be?" Quick / Balanced / Deep / Maximum. Skipped if inferred.
9. **Memory** (yes/no card, conditional) -- "Should it remember past conversations?" Skipped if inferred.
10. **Access** (multi-choice card) -- "Who should be able to use it?" Everyone / View-only / Invite only.
11. **Approval** (multi-choice card, conditional) -- "When it takes actions, should it..." Auto / Ask user / Ask owner. Only if write tools selected.
12. **Confirm** (confirmation card) -- Shows full config summary. "Create Agent" or "Let me change something" (chat-based editing).

**Interactive card types used:** MultiChoice, YesNo, Dropdown, MultiSelect, Schedule, Confirmation.

**State machine:** 20 phases with conditional skipping based on goal analysis confidence. Phases in brackets are skipped when conditions are met:

INIT → DESCRIBE → ANALYZING → SUMMARY → [CLARIFY] → [PROMPT_REVIEW] → CHANNEL → ACTIVATION → [SCHEDULE_ASK] → [SCHEDULE] → TOOLS → [EFFORT] → [MEMORY] → ACCESS → [APPROVAL] → CONFIRM → [CHANGE_REQUEST] → CREATING → DONE

Skip rules:
- High confidence (detailed description + tools + triggers): skip CLARIFY, EFFORT, MEMORY
- Medium confidence: skip EFFORT, MEMORY
- No time patterns in goal: skip SCHEDULE_ASK
- No write tools selected: skip APPROVAL

**Rules:**
- Any workspace user can create agents.
- Agent creator automatically becomes owner.
- A Slack channel is created for each new agent.
- Non-admin creators: goal analyzer restricts tool suggestions to read-only tools and does not propose new tools.
- Write tools with team credentials require admin approval (tool request created, not attached immediately).
- Chat-based editing: on the confirmation card, user can say "Let me change something" and type changes in natural language. AI interprets and updates config.
- X button closes the chat and shows the original 4-step manual wizard as a fallback.
- "Or set up manually" link on the chat background page also switches to manual mode.
- Chat panel is centered at bottom (matching regular chat position).
- **Adaptive conversation depth**: AI determines confidence from the goal analysis. Detailed descriptions → fewer questions (3-4). Vague descriptions → CLARIFY phase with follow-up questions (8-10).
- **Rich analysis summary**: After analyzing, shows agent name, recommended tools with reasoning, suggested triggers, model choice, and memory recommendation.
- **System prompt review**: PROMPT_REVIEW phase shows a collapsible PromptPreviewCard. User can "Looks good" or "Let me edit" (re-runs analyzer with changes).
- **Proper tool detection**: Groups integrations (HubSpot read+write = "HubSpot (view & edit)"). Shows connection status. Pre-selects from analysis by mapping tool names to integration group bases. Friendly "no services yet" message with single Continue button if none configured.
- **Channel improvements**: Private channels show 🔒 prefix. "Create a new channel" as first dropdown option. Help text shown: "Don't see your channel? Private channels need TinyHands to be invited first. Use /invite @TinyHands in the channel." Refresh button to refetch channels after inviting the bot. Channel API auto-paginates to return ALL workspace channels.
- **Confirmation card sections**: Agent, Channel, Response Mode, Tools, Triggers, Behavior, Access, Instructions (collapsible prompt).
- **Copilot on manual wizard**: Floating sparkle button (✨) in bottom-right when using manual wizard. Opens FloatingChat to help fill fields. Also accessible via Cmd+K.

**Agent Creation Flow:**

```
User navigates to /agents/new
     |
     v
FloatingChat opens in creation mode
(80% height, 640px width)
     |
     v
AI: "What would you like your agent to do?"
     |
     v
User describes goal (text input)
     |
     v
Goal Analyzer (AI) runs
     |
     v
AI determines which questions to ask
(skips phases with high-confidence answers)
     |
     v
Asks questions one at a time
using interactive cards
(channel, activation, tools, etc.)
     |
     v
Shows confirmation card with full config
     |           |
     | Create    | Change something
     v           v
Create Agent   Chat-based editing
     |          (re-shows confirmation)
     v
Channel created + triggers set up
     |
     v
Navigate to agent detail page
```

### Agent Configuration

| Setting | Values | DB column | Dashboard label |
|---------|--------|-----------|-----------------|
| Model | `sonnet`, `opus`, `haiku` | `agents.model` | Sonnet / Opus / Haiku |
| Effort | Quick, Standard, Thorough, Maximum | `agents.max_turns` | Quick / Standard / Thorough / Maximum |
| Memory | on / off | `agents.memory_enabled` | Memory toggle |
| Channels | one or more Slack channels | `agents.channels` (JSON array) | -- |
| Activation | mentions_only, respond_to_all, or default (relevance check) | `agents.mentions_only`, `agents.respond_to_all` | Only when @mentioned / Relevant messages / Every message |
| Default access | none, viewer, member | `agents.default_access` | Invite Only / Limited Access / Full Access |
| Write policy | auto, confirm, admin_confirm | `agents.write_policy` | Automatic / Ask User First / Ask Owner/Admins |
| Self-evolution | off, supervised, autonomous | `agents.self_evolution_mode` | Off / Supervised / Autonomous |

### Pausing / Resuming / Deleting

- **Pause/Resume** -- from agent detail header button or Agents list overflow menu. Sets `agents.status` to `paused` or `active`. Paused agents ignore all messages.
- **Delete** -- from agent detail overflow menu or Agents list overflow menu. Requires owner access (`canModifyAgent`).
- Platform admins (superadmin/admin) have owner-level access to all agents and can pause/resume/delete any agent.

### Version History

Every configuration change creates a version entry in `agent_versions`.

**Tracked fields:** instructions (system_prompt), model, tools, max_turns, memory_enabled, mentions_only, respond_to_all, default_access, write_policy.

**Capabilities:**
- Preview any version to see full configuration snapshot.
- Restore any version to revert the agent to that state.
- Each version records: what changed, who changed it, when.

**Implementation:** Migration 020 added columns for model, tools, max_turns, memory_enabled, mentions_only, respond_to_all, default_access, write_policy to `agent_versions`.

**Access:**

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer |
|--------|-----------|-------|-------------|-------------|--------|
| Create agent | Yes | Yes | N/A | N/A | No |
| Edit agent config | Yes | Yes | Yes | No | No |
| Add read tools | Yes | Yes | Yes | No | No |
| Add write tools (team creds) | Yes (immediate) | Yes (immediate) | Needs approval | No | No |
| Pause/Resume agent | Yes | Yes | Yes | No | No |
| Delete agent | Yes | Yes | Yes | No | No |
| View version history | Yes | Yes | Yes | No | No |
| Restore version | Yes | Yes | Yes | No | No |

---

## Agent Execution

### Full Flow

```
1. Slack message received (listener process, src/index.ts)
2. Relevance check (skip if @mentioned or mentions_only/respond_to_all)
3. Job enqueued to BullMQ (priority queue via Redis)
4. Worker dequeues job (src/worker.ts)
5. Rate limit check (TPM/RPM token bucket at 90% capacity)
6. Context retrieval:
   - KB search (full-text via tsvector)
   - Source chunks (indexed data)
   - Agent memory (if enabled)
   - Thread history (Slack conversation context)
7. Docker container created with mounted tools, sources, config
8. Claude Agent SDK runs inside container, streams events to stdout
9. Worker reads stream -> buffers -> posts to Slack thread in real-time
10. Run record updated (tokens, cost, duration, status)
11. Container cleaned up
12. Memories extracted and stored (if memory enabled)
```

```
Slack Message
     |
     v
[Listener] ---------> Relevance Check
     |                      |
     | relevant             | not relevant
     v                      v (skip)
[BullMQ Queue]
     |
     v
[Worker] -----------> Rate Limit Check
     |                      |
     | ok                   | over limit
     v                      v (delay)
[Build Context] -----> KB + Sources + Memory + Thread
     |
     v
[Docker Container] --> Claude SDK
     |
     v
[Stream to Slack] ---> Buffer --> Post/Update
     |
     v
[Cleanup] -----------> Save run record + Extract memories
```

**Access:**

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer |
|--------|-----------|-------|-------------|-------------|--------|
| Trigger agent via message | Yes | Yes | Yes | Yes | Read-only (upgrade request) |
| Override model (/opus etc.) | Yes | Yes | Yes | Yes | No |
| View run history | Yes | Yes | Yes | Yes | Yes |
| Approve write action (confirm) | Yes | Yes | Yes | Yes | No |
| Approve write action (admin_confirm) | Yes | Yes | Yes | No | No |

### Rate Limiting

- Redis-backed token bucket in `src/queue/index.ts`.
- Pre-flight check at 90% TPM capacity -- if over, job is delayed.
- Per-minute tracking for both TPM (tokens per minute) and RPM (requests per minute).
- Applies globally across all workers.
- Automatic 60-second pause on 429 responses from Anthropic API.
- **Container output 429 detection:** When the Claude Code SDK inside a Docker container hits a rate limit (e.g., concurrent connections exceeded), it may exit with code 0 but output the 429 error JSON. The execution module detects rate limit patterns in the output (`rate_limit_error`, `Number of concurrent connections`, `429` + `rate limit`), marks the run as `failed` with a friendly message, sets the global rate limit flag in Redis (60s cooldown), re-queues the job with a 60-second delay, and posts a Slack message explaining the automatic retry. This prevents raw 429 JSON from being shown to users as agent output.

### Thread Replies vs Top-Level Messages

- Agent responses always go to a Slack thread (reply to the triggering message).
- Follow-up messages in the same thread continue the conversation with full thread context.
- Real-time streaming via `src/slack/buffer.ts` -- progressive message updates in Slack.

### DM Routing (Multi-Agent Selection)

- Users can DM the TinyHands bot directly.
- If the user has access to multiple agents, the system either:
  - Routes to the most relevant agent automatically, or
  - Shows a picker to choose which agent to talk to.
- Follow-up messages in the same DM thread continue with the chosen agent.

### Model Override (/opus, /sonnet, /haiku)

- Prefix a message with `/opus`, `/sonnet`, or `/haiku` to override the agent's default model for that run.
- Handled by `src/modules/model-selection/`.
- Override applies only to the single run, not permanently.

### Effort Levels (Quick, Standard, Thorough, Maximum -> maxTurns)

| Level | Best for | maxTurns |
|-------|----------|----------|
| Quick | Single-turn answers | Low |
| Standard | Multi-step reasoning (default) | Default |
| Thorough | Deep research and iteration | Higher |
| Maximum | Complex, multi-tool investigations | Highest |

Effort is stored as `max_turns` in the agents table. The dashboard shows friendly labels.

**Max turns exhaustion:** When an agent runs out of turns before producing a final response (Claude Code CLI reports `error_max_turns`), TinyHands posts an error message to the Slack thread: "Ran out of steps before finishing — the task needed more steps than the current effort level allows. Try increasing the effort level in the agent's settings, or simplify the task." Previously, the agent would silently vanish (status message deleted, no output posted).

### Run Records

Every execution creates a `run_history` row tracking:
- `status`: queued, running, success, error
- `input_tokens`, `output_tokens`, `estimated_cost_usd`
- `duration_ms`, `queue_wait_ms`
- `context_tokens_injected`, `tool_calls_count`
- `model`, `trace_id`, `job_id`, `slack_user_id`
- `created_at`, `completed_at`

### Queue Priorities

| Priority | Value | Use case |
|----------|-------|----------|
| high | 1 | @mentions, DMs |
| normal | 2 | Channel messages (default) |
| low | 3 | Scheduled triggers, bulk |

---

## Access Control

### Platform Roles

| Role | Hierarchy value | Permissions |
|------|----------------|-------------|
| superadmin | 3 | Full platform control: manage all agents, tools, KB, roles, audit log |
| admin | 2 | Manage tools, KB, and agents. Cannot change platform roles |
| member | 1 | View and interact with agents only |

**Rules:**
- First person to run any slash command in bot DM becomes superadmin (`initSuperadmin`).
- Only superadmins can grant/revoke superadmin roles (`addSuperadmin` checks `isPlatformAdmin`).
- There must always be at least one superadmin (enforced in `removePlatformRole`).
- `isPlatformAdmin()` returns true for both superadmin and admin.

**Non-admin (member) restrictions:**
- Cannot create agents (New Agent button hidden; create page redirects to agents list).
- Cannot access Tools & Integrations page (sees "Admin Access Required" message).
- Cannot manage KB sources or API keys (can only search and add entries).
- Can only edit or delete agents they own.
- Goal analyzer restricts tool suggestions to read-only tools.

### Agent Roles

| Role | Hierarchy value | Permissions |
|------|----------------|-------------|
| owner | 3 | Full control: modify agent, manage roles, delete, approve upgrades |
| member | 2 | Full interaction: read and write tool actions |
| viewer | 1 | Read-only: write actions trigger automatic upgrade request |
| none | 0 | No access (used when default_access is "none" / Invite Only) |

**Resolution order (in `getAgentRole`):**
1. Check platform role -- superadmin or admin automatically get `owner` access on all agents.
2. Check explicit agent role in `agent_roles` table.
3. Fall back to agent's `default_access` field (none / viewer / member).

### Default Access Levels

| Dashboard label | DB value | Behavior for users without explicit role |
|-----------------|----------|------------------------------------------|
| Invite Only | `none` | Agent hidden. Only explicitly granted users can see/use it |
| Limited Access | `viewer` | Can see agent. Write actions trigger upgrade requests |
| Full Access | `member` | Full interaction for everyone |

### Permission Check Functions

| Function | Returns true when |
|----------|-------------------|
| `canView(ws, agent, user)` | Agent role >= viewer |
| `canInteract(ws, agent, user)` | Agent role >= member |
| `canModifyAgent(ws, agent, user)` | Agent role === owner |
| `canSendTask(ws, agent, user)` | Delegates to `canAccessAgent()` |
| `isPlatformAdmin(ws, user)` | Platform role is superadmin or admin |
| `hasMinimumRole(userRole, required)` | Backward-compat hierarchy comparison |
| `hasMinimumAgentRole(userRole, required)` | Agent role hierarchy comparison |

**Who can create agents:** Everyone (any user) -- except when member restrictions apply (members cannot create agents).

**Who can modify agents:** Owners only (via `canModifyAgent` which checks `agentRole === 'owner'`). Platform admins get owner-level access to all agents automatically.

**Access Summary:**

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer | None |
|--------|-----------|-------|-------------|-------------|--------|------|
| View agent | Yes | Yes | Yes | Yes | Yes | No |
| Interact with agent | Yes | Yes | Yes | Yes | No (triggers upgrade request) | No |
| Modify agent settings | Yes | Yes | Yes | No | No | No |
| Manage agent roles | Yes | Yes | Yes | No | No | No |
| Manage platform roles | Yes | No | No | No | No | No |
| Request upgrade | N/A | N/A | N/A | N/A | Yes | No |
| Approve upgrade request | Yes | Yes | Yes | No | No | No |

### Upgrade Request Flow (Viewer -> Member)

1. Viewer attempts write action or clicks "Request Access" in dashboard.
2. `requestUpgrade()` creates row in `upgrade_requests` (status: pending, requested_role: member).
3. All agent owners are notified via Slack DM.
4. Owner/admin reviews in dashboard **Requests > Upgrade Requests**.
5. `approveUpgrade()`: sets status to approved, grants member role via `setAgentRole()`, user notified via Slack DM.
6. `denyUpgrade()`: sets status to denied, no notification sent.
7. Audit events logged for both request creation and resolution (fire-and-forget).

---

## Tool System

### Tool Categories

| Category | Examples | Config needed | Discovery |
|----------|----------|---------------|-----------|
| Core/built-in | File access, web search, code analysis, shell commands | None (always available) | Hardcoded |
| Integration tools | HubSpot, Zendesk, Linear, Google Drive, etc. | API keys or OAuth | Auto-discovered from `src/modules/tools/integrations/` |
| Custom tools | User-created via dashboard | Code + schema | Stored in `custom_tools` table |
| Agent-created tools | Created by agents during execution | Needs admin approval | Stored in `custom_tools` with approval flag |

### Tool Manifest Structure (ToolManifest)

Every integration exports a `manifest` from `src/modules/tools/integrations/<name>/index.ts`:

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier, e.g. "chargebee" |
| `label` | string | Human-readable name, e.g. "Chargebee" |
| `icon` | string | Slack emoji, e.g. ":credit_card:" |
| `description` | string | Short text for integration picker UI |
| `configKeys` | string[] | Required credential fields (e.g. ["api_key", "site"]) |
| `configPlaceholders` | Record | Optional placeholder hints per config field |
| `setupGuide` | string | Optional Slack mrkdwn setup instructions |
| `supportedCredentialModes` | string[] (optional) | Which credential modes this integration supports. Defaults to all three (team, delegated, runtime) if omitted. |
| `tools` | ToolDefinition[] | Read and optionally write tool definitions |
| `register()` | function | Register tools into database |
| `updateConfig()` | function | Update credentials for existing tools |

### Tool Definition Structure (ToolDefinition)

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | DB name, e.g. "chargebee-read" |
| `schema` | string | JSON-stringified JSON Schema for inputs |
| `code` | string | JavaScript code that runs in Docker |
| `accessLevel` | 'read-only' / 'read-write' | Whether tool can mutate data |
| `displayName` | string | Friendly label shown in Slack during execution |

### Read vs Write Tools (Name Suffix -read/-write, accessLevel Property)

- Tool names follow pattern: `<integration>-read` and `<integration>-write`.
- `accessLevel` property: `read-only` vs `read-write`.
- Dashboard shows: "Can view data" (read) and "Can make changes" (write).
- Enabling write automatically includes read access.

### Tool Code Constraints

- Runs inside Docker container with only Node.js built-ins (no npm packages).
- Config loaded from `path.join(__dirname, '<tool-name>.config.json')`.
- Inputs available via global `input` variable.
- Output via `console.log(JSON.stringify(result))`.
- 30-second timeout on all HTTP requests.

### Adding Tools to Agents

- During creation: wizard step 4 lets users select tools.
- After creation: agent's Tools tab in dashboard.
- When a non-admin adds a write tool and team credentials exist, a tool request is created (pending admin approval) instead of immediately attaching.
- When a non-admin selects "Team credentials" as the credential mode: read tools with existing team connections are set immediately (no request); read tools without team connections or write tools create a credential request for admin review.
- Admins can add any tool and set any credential mode immediately without approval.
- Only platform admins (superadmin/admin) can approve credential requests — agent owners cannot self-approve.

### Existing Integrations

| Integration | ID | Access | Config Keys |
|-------------|-----|--------|-------------|
| Chargebee | `chargebee` | read + write | `api_key`, `site` |
| HubSpot | `hubspot` | read + write | `access_token` |
| Linear | `linear` | read + write | `api_key` |
| Zendesk | `zendesk` | read + write | `subdomain`, `email`, `api_token` |
| PostHog | `posthog` | read-only | `api_key`, `project_id` |
| SerpAPI | `serpapi` | read-only | `api_key` |
| Knowledge Base | `kb` | read-only | (auto-configured) |
| Google Drive | `google-drive` | read + write | OAuth |
| Google Sheets | `google-sheets` | read + write | OAuth |
| Google Docs | `google-docs` | read + write | OAuth |
| Gmail | `gmail` | read + write | OAuth |
| Notion | `notion` | read-only | OAuth |
| GitHub | `github` | read-only | OAuth |
| Documents | `docs` | read + write | (auto-configured) |

Most integrations support all three credential modes (team, delegated, runtime). Integrations can restrict this via `supportedCredentialModes` in their manifest. **Auto-configured tools** (Documents, Knowledge Base) have `supportedCredentialModes: []` — they don't need external credentials and the credential dropdown is hidden in the dashboard.

**Google OAuth note:** All four Google integrations share a single OAuth config and callback (`/auth/callback/google`). One connection covers Drive, Sheets, Docs, and Gmail. Which services an agent uses depends on which tools are enabled. Legacy "Google Workspace" integration exists for backward compat but registers no tools (cleaned up by migration 019).

**Tool Request Approval Flow:**

```
Non-admin adds write tool
     |
     v
Team credentials exist? --no--> Attach tool directly
     |
     | yes
     v
Create tool_request (pending)
     |
     v
Slack DM to admins: "View in Dashboard"
     |
     v
Admin reviews in Dashboard
     |            |
     | approve    | deny
     v            v
Attach tool    Notify user
to agent       (denied)
```

**Access:**

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer |
|--------|-----------|-------|-------------|-------------|--------|
| View available integrations | Yes | Yes | No | No | No |
| Connect integrations (team creds) | Yes | Yes | No | No | No |
| Add read tools to own agent | Yes | Yes | Yes | No | No |
| Add write tools (immediate) | Yes | Yes | No | No | No |
| Add write tools (request) | N/A | N/A | Yes | No | No |
| Create custom tools | Yes | Yes | No | No | No |
| Approve agent-created tools | Yes | Yes | No | No | No |

---

## Credential & Connection System

### Team Credentials (Admin-Configured, Shared Workspace-Wide)

- Created via Tools & Integrations page by admins.
- Stored in `connections` table with `connection_type = 'team'`, `user_id = NULL`.
- Encrypted with AES-256-GCM (requires `ENCRYPTION_KEY` env var, 32+ chars).
- One team connection per integration per workspace (upsert on conflict).

### Personal Credentials (User-Owned, OAuth or Manual)

- Created via Connections page by individual users.
- Stored in `connections` table with `connection_type = 'personal'`, `user_id` set.
- OAuth supported for: Google, Notion, GitHub.
- API key entry available for any integration. OAuth supported for Google, Notion, and GitHub.
- One personal connection per integration per user per workspace (upsert on conflict).

### Connection Modes: Team, Delegated, Runtime

Stored in `agent_tool_connections` table (unique per `agent_id` + `tool_name`):

| Mode | DB value | Dashboard label | Behavior at runtime |
|------|----------|-----------------|---------------------|
| Team | `team` | Team credentials | Uses shared team connection |
| Delegated | `delegated` | Agent creator's | Uses first agent owner's personal connection |
| Runtime | `runtime` | Each user's own | Uses invoking user's personal connection |

### Missing Credentials: Confirmation Before Running

Every tool on an agent MUST have an explicit `agent_tool_connections` entry. If any tools have missing or unconfigured credentials at runtime, the agent does not silently fail or fall back. Instead:

1. The system identifies all tools with missing credentials.
2. A message is posted in the Slack thread listing the affected tools with a link to the dashboard Connections page.
3. The user is asked: "Should I continue without these tools?" with Continue / Cancel buttons.
4. If the user approves: the agent runs without the unconfigured tools.
5. If the user cancels or the 5-minute timeout expires: the run is cancelled.

This ensures users always know which tools are unavailable and can make an informed decision.

Credential modes are set in three ways:
- **Dashboard**: when a user picks a credential mode for a tool, the mode is applied to ALL tools in the same integration group (e.g., setting Google Docs Read to "Each user's own" also sets Google Docs Write).
- **Agent creation**: the AI goal analyzer recommends modes, and on creation the selected modes are saved for all tools.
- **Adding a tool**: when a tool is added to an agent, it inherits the credential mode from any existing sibling tool in the same integration group.

### Admin Involvement: Non-Admin Using Team Credentials

**Rule:** When a non-admin selects "Team credentials" for any tool on their agent (read or write), a credential request is created. The admin resolves it by configuring the team connection on the Connections page (or denying).

**Admin bypass:** Platform admins set credential modes immediately with no request needed.

### Credential Resolution Order at Runtime

`resolveToolCredentials(wsId, agentId, toolName, userId)`:

1. Look up `agent_tool_connections` for explicit mode.
2. If `team` -- `getTeamConnection(wsId, integrationId)`.
3. If `delegated` -- iterate `getAgentOwners()`, find first owner's personal connection.
4. If `runtime` -- `getPersonalConnection(wsId, integrationId, userId)`.
5. If no explicit mode -- return `null` (triggers "credentials not configured" error).
6. If null returned -- run fails with role-aware error message.
7. All credentials auto-decrypted via `decryptCredentials()`.
8. Google OAuth tokens auto-refreshed via `refreshIfGoogleOAuth()`.

**Critical rule:** The system never silently falls back to stale or empty credentials. If credentials are missing, the run fails with a clear, specific error rather than proceeding with broken config.

**Credential Resolution Flow:**

```
resolveToolCredentials(agent, tool)
     |
     v
Agent-Tool Connection exists?
     |            |
     | yes        | no
     v            v
Use explicit   "Credentials not
mode           configured" error
  |
  +---team--------->Use team connection
  |
  +---delegated---->Use agent owner's personal connection
  |
  +---runtime------>Use current user's personal connection
     |
     v
Credentials found?
     |            |
     | yes        | no
     v            v
Decrypt +      Role-aware
auto-refresh   error message
     |
     v
Return credentials
```

### Smart Credential Recommendations

During agent creation, the AI goal analyzer recommends credential modes:

| Mode | When recommended | Behavior |
|------|-----------------|----------|
| Team | Agent monitors or acts for whole team (e.g., ticket triage, dashboards) | Uses shared team credential |
| Creator's | Agent is personal to the user (e.g., "manage MY tasks") | Uses agent creator's personal credential |
| Each User's Own | Agent acts on behalf of whoever talks to it (e.g., "send email as requesting user") | Each user provides own credential |

All modes are available for all integrations by default. Integrations that restrict their supported modes (via `supportedCredentialModes` in the manifest) are respected — the AI will only recommend from the allowed modes.

### Missing Credential Error Messages (Role-Aware)

Generated by `getCredentialErrorContext()`:

| Mode | Runner Role | Message |
|------|-------------|---------|
| Not configured | Admin/Owner | "Credentials haven't been configured for this agent yet. Open agent settings." |
| Not configured | Others | "Credentials haven't been configured. Let @owner know." |
| Team | Admin | "Shared credentials haven't been set up. Go to Connections page in the dashboard." |
| Team | Agent owner | "Ask a workspace admin to connect the tool in the Connections page." |
| Team | Regular user | "Let @owner or a workspace admin know." |
| Delegated | Agent owner | "You haven't connected yet. Go to the Connections page in the dashboard." |
| Delegated | Others | "Let @owner know — they need to connect in the dashboard." |
| Runtime | Anyone | "I need your credentials. Go to the Connections page in the dashboard." |

All error messages include a link to the dashboard Connections page. No credential entry or connection management happens in Slack.

### Credential Mode Dropdown (Agent Tools Page)

Each integration tool on an agent has a credential mode dropdown with three options:

- **Team credentials** — always shown. Displays "(Connected)" or "(Not Connected)" based on whether a team connection exists. If a non-admin selects this, a credential request is created for admin review.
- **Agent creator's** — always shown. Displays "(Connected)" or "(Not Connected)" based on whether the agent creator has a personal connection. If not connected, a "Connect" link appears next to the dropdown linking to the Connections page.
- **Requesting user's** — always shown. No connection status displayed (the invoking user is unknown at configuration time).

If no credential mode has been selected, the dropdown shows "Not configured" in amber text.

If an integration restricts its supported credential modes (via `supportedCredentialModes` in the manifest), only the supported options appear in the dropdown. Currently all integrations support all modes.

### Google Drive Folder Restrictions

- Users can restrict a Google personal connection to a specific Drive folder.
- Set via Connections page folder browser (browse, navigate, select).
- Stored as `root_folder_id` and `root_folder_name` in encrypted credentials.
- Agents using this connection can only access files within that folder and subfolders.
- Can be changed or cleared at any time.

**Access:**

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer |
|--------|-----------|-------|-------------|-------------|--------|
| Create team connections | Yes | Yes | No | No | No |
| Edit/delete team connections | Yes | Yes | No | No | No |
| View team connections | Yes | Yes | Yes (read-only) | Yes (read-only) | Yes (read-only) |
| Create personal connections | Yes | Yes | Yes | Yes | Yes |
| Edit/delete own personal connections | Yes | Yes | Yes | Yes | Yes |
| Set connection mode on own agent | Yes | Yes | Yes | No | No |
| Switch write tool to team creds (immediate) | Yes | Yes | No | No | No |
| Switch write tool to team creds (request) | N/A | N/A | Yes | No | No |
| Restrict Google Drive folder | Yes | Yes | Yes | Yes | Yes |

### Connection Health Monitoring

- Periodic health check runs every 30 minutes in the sync process.
- Google OAuth connections: attempts token refresh; marks expired if refresh fails.
- Other OAuth connections (Notion, GitHub): checks `oauth_token_expires_at`; marks expired if past.
- Token expiry timestamp (`oauth_token_expires_at`) stored on OAuth callback and updated on each Google token refresh.
- When a connection expires:
  - Status set to `expired` in the database.
  - Slack DM sent to connection owner with warning message and "Reconnect in Dashboard" button linking to `/connections`.
- Dashboard indicators:
  - Sidebar badge on Connections nav item shows count of expired connections visible to the current user (admins: expired team connections + own personal; non-admins: own personal only).
  - Warning banner at top of Connections page when expired connections exist.
  - "Reconnect" button on expired connections in both personal and team tables.
- Expired connections are visible in the dashboard (API returns both `active` and `expired` connections).

---

## Approval & Request Workflows

All non-realtime approvals happen in the **web dashboard**. Slack sends notification-only messages with "View in Dashboard" CTA link. Sidebar badge shows total pending count. Tab badges show per-type counts. Admins are notified via Slack DM when new requests arrive.

### 1. Upgrade Requests

**When it happens:** A user with limited access (viewer) tries to interact with an agent that requires member access, or clicks "Request Access" in the dashboard.

**Flow:**
1. User interacts with agent or clicks "Request Access"
2. `requestUpgrade()` creates row in `upgrade_requests` (status: pending)
3. Request appears in **Requests > Upgrade Requests**
4. Agent owner or admin reviews and approves or denies
5. If approved: user gets member role via `setAgentRole()`, notified via Slack DM
6. If denied: user notified with reason

### 2. Credential Requests (Team Credentials)

**When it happens:** A non-admin user selects "Team credentials" for any tool (read or write) on their agent.

**Credential Request Rules:**
- **Read tool + team connection exists:** No request needed — mode set to "Team credentials" immediately. No admin approval required since credentials are already configured.
- **Read tool + team connection missing:** Request created → Dashboard shows **Configure + Deny**. Admin must configure the team connection first.
- **Write tool (any):** Request always created → Dashboard shows **Approve + Deny**. Write access is a privilege escalation requiring explicit admin approval.
- **Only platform admins** (superadmin/admin) can approve requests. Agent owners cannot self-approve team credential requests.
- **Mode persists immediately:** When a non-admin selects "Team credentials", the credential mode is saved to the database right away (so it doesn't revert on page refresh), even while the request is pending.

**Flow:**
1. Non-admin selects "Team credentials" in the credential dropdown
2. System checks: is user an admin? If yes, credential mode set immediately. Done.
3. If not admin: credential mode persisted to DB immediately (prevents revert on refresh)
4. For read tools with existing team connection: done, no request needed
5. For read tools without team connection or any write tool: credential request created (pending)
6. All admins receive Slack DM with "View in Dashboard" link
7. Admin reviews in **Requests > Credential Requests**:
   - Read tools (missing connection): Admin clicks **Configure** → navigates to Connections page to set up team credentials
   - Write tools: Admin clicks **Approve** → tool added to agent with team credential mode
8. If admin clicks **Deny**:
   - Read tools: credential mode cleared (not configured)
   - Write tools: tool removed from agent entirely (write access is a privilege escalation)
9. On approve: `approveToolRequest()` adds the tool AND sets credential mode to "team"

**Dashboard indicators:**
- Agent tools page shows amber "Pending approval" badge next to credential dropdown for tools with pending requests
- "Can make changes" button hidden for non-admins when write access is not active (only admins can add write tools directly)

**Why this exists:** Team credentials are shared company-wide. Non-admins should not use shared credentials without admin awareness. Read tools with existing connections are safe (credentials already vetted). Write tools always require explicit approval since they grant mutation access.

### 3. Evolution Proposals

**When it happens:** An agent with self-evolution enabled detects a potential improvement. Agents in "supervised" mode create proposals for human review. Agents in "autonomous" mode auto-execute.

**Flow:**
1. Agent identifies improvement during a run
2. `createProposal()` creates row with action type, description, diff
3. Supervised: status = pending; Autonomous: status = executed (auto-runs)
4. Admins receive Slack DM with "Review in Dashboard" link
5. Admin reviews in **Requests > Evolution Proposals**
6. If approved: `executeProposal()` runs (prompt updated, tool added, etc.)
7. If rejected: proposal archived

**Proposal types:** `update_prompt`, `write_tool`, `create_mcp`, `commit_code`, `add_to_kb`

### 4. Feature Requests (Missing Capabilities)

**When it happens:** During agent creation, the AI goal analyzer identifies needed tools or capabilities that don't exist in the system.

**Flow:**
1. User describes agent goal during creation
2. Goal analyzer identifies required tools that don't exist
3. Feature request created listing missing tools and descriptions
4. Admins receive Slack DM with "View in Dashboard" link
5. Admin reviews in **Requests > Feature Requests**
6. Admin can dismiss or use as guide to build missing integration

**Note:** Feature requests are informational only. Admin must build missing tools via code (adding integration in `src/modules/tools/integrations/`).

### 5. KB Contributions

**When it happens:** An agent submits content to the knowledge base during a run.

**Flow:**
1. Agent creates KB entry during execution
2. Entry saved with `approved: false`
3. Admin reviews in **Requests > KB Contributions**
4. If approved: entry becomes searchable by all agents
5. If rejected: entry deleted

### 6. Write Approvals (Runtime -- Slack Only)

**When it happens:** During agent execution, the agent attempts a write action and the agent's write policy is `confirm` or `admin_confirm`.

**Flow:**
1. Agent starts executing a write tool during a run
2. Agent pauses and posts approval request in Slack thread with Approve/Deny buttons
3. For `confirm` (Ask User First): any user in the thread can approve. 5-minute timeout.
4. For `admin_confirm` (Ask Owner/Admins): only agent owner can approve. No timeout.
5. If approved: agent resumes and completes the write action
6. If denied: agent skips the action and continues
7. If timeout (confirm only): treated as denied

**Why Slack-only:** Write approvals are real-time, time-sensitive decisions that happen mid-execution. They must stay in the Slack thread where the conversation is happening.

### Summary: Where Each Request Type Lives

| Request Type | Dashboard Tab | Slack Notification | Slack Approve/Deny |
|---|---|---|---|
| Upgrade Requests | Requests > Upgrade Requests | No (planned) | No |
| Credential Requests | Requests > Credential Requests | Yes (with dashboard CTA) | No |
| Evolution Proposals | Requests > Evolution Proposals | Yes (with dashboard CTA) | No |
| Feature Requests | Requests > Feature Requests | Yes (with dashboard CTA) | No |
| KB Contributions | Requests > KB Contributions | Planned | No |
| Write Approvals | N/A (Slack-only) | In-thread | Yes (real-time) |

**Access:**

| Request Type | Who Can Create | Who Can Approve/Deny |
|---|---|---|
| Upgrade Requests | Viewers (automatic on write attempt or manual) | Agent owner, Superadmin, Admin |
| Credential Requests | Non-admin selecting "Team credentials" for any tool | Superadmin, Admin (Configure + Deny) |
| Evolution Proposals | Agent (automated, when self-evolution enabled) | Agent owner, Superadmin, Admin |
| Feature Requests | System (automated, during agent creation) | Superadmin, Admin (dismiss only) |
| KB Contributions | Agent (automated, during execution) | Superadmin, Admin |
| Write Approvals (confirm) | Agent (automated, mid-execution) | Any user in thread |
| Write Approvals (admin_confirm) | Agent (automated, mid-execution) | Agent owner only |

---

## Action Approval (Write Policies)

This is a **runtime** concept, separate from tool attachment approval (which is an admin workflow for adding tools to agents).

| DB value | Dashboard label | Behavior |
|----------|-----------------|----------|
| `auto` | Automatic | Write actions execute immediately for members |
| `confirm` | Ask User First | Agent pauses, DMs requesting user with action details and Approve/Deny buttons. 5-minute timeout |
| `admin_confirm` | Ask Owner/Admins | Agent pauses, DMs agent owner with action details and Approve/Deny buttons. No timeout |

**Rules:**
- Default for new agents: `auto`.
- Enforced at runtime via Redis-backed approval state in `src/queue/index.ts`.
- Approval routes in `src/server.ts` handle approve/deny actions from Slack DM buttons.
- Redis helpers in `src/queue/index.ts` manage approval request creation, polling, and expiration.
- When denied: requesting user receives DM explaining which action was blocked and why.
- When approved: agent automatically resumes and completes the write action.
- Expired requests (`confirm` only): treated as denied.

**Write Approval Flow (Runtime):**

```
Agent executes write tool
     |
     v
write_policy?
     |            |              |
     | auto       | confirm      | admin_confirm
     v            v              v
Execute       DM user         DM owner
immediately   (5min timeout)  (no timeout)
                  |              |
                  v              v
              Approve/Deny   Approve/Deny
                  |              |
                  v              v
              Execute or     Execute or
              skip action    skip action
```

**Access:**

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer |
|--------|-----------|-------|-------------|-------------|--------|
| Set write policy on agent | Yes | Yes | Yes | No | No |
| Approve (confirm mode) | Yes | Yes | Yes | Yes | No |
| Approve (admin_confirm mode) | Yes | Yes | Yes | No | No |
| Deny (any mode) | Same as approve for each mode | | | | |

---

## Documents

Native document management system. Three document types: **Docs** (rich text), **Sheets** (spreadsheets with tabs), and **Files** (any uploaded file).

### Document Types

| Type | Storage | Agent Read Format | Agent Write Format |
|------|---------|-------------------|-------------------|
| Doc | Slate JSON (JSONB) | Markdown | Markdown (auto-converted to Slate) |
| Sheet | Sparse cell data in `sheet_tabs` (JSONB) | CSV | CSV (auto-converted to cell data) |
| File | BYTEA in `document_files` | Text extraction (PDF, DOCX, text) | Binary upload |

### Agent Access

- Agents interact via the `docs` tool integration (two tools: `docs-read` and `docs-write`).
- `docs-read` actions: `list`, `search`, `read_doc`, `read_sheet_tab`, `read_file`
- `docs-write` actions: `create_doc`, `create_sheet`, `create_file`, `update_doc`, `update_cells`, `append_rows`, `create_tab`, `delete_tab`, `rename`, `archive`
- Agent tools call internal API endpoints (`/internal/docs/*`) with `X-Internal-Secret` header.
- Each document has an `agent_editable` toggle (default: true). If false, agent write operations return 403.
- Agents can never permanently delete documents.
- Agent updates support optimistic locking: `expected_version` can be passed with `update_doc`/`rename` actions. If omitted, falls back to current version (no conflict check). All create/update/get responses include `version` so agents can track it.
- Cell updates (both API and internal) are limited to 10,000 cells per request and 10 MB total payload size.

### Human Access (Dashboard)

- **Documents page** (`/documents`): master list of all documents across all agents.
- Filter by type (All / Docs / Sheets / Files), search by title/content, pagination.
- Create new documents or spreadsheets, upload files, import CSV or DOCX. **Every document must be associated with an agent** — the create dialog requires selecting an agent.
- **Agent Docs tab** (`/agents/:id` → Docs): shows documents scoped to that agent. Users with write access can create new documents directly from this tab (agentId is auto-filled).
- Inline title editing, `agent_editable` toggle, version history, export/download.

### Version History

- Every update creates a version snapshot (content, title, change summary, who changed it).
- Cap: 50 versions for docs/sheets, 10 for files.
- Restore any version via the History dialog in the editor.
- Optimistic locking: version counter on each document, 409 Conflict on stale writes.

### Full-Text Search

- `document_search` table with `tsvector` + GIN index.
- Indexed: doc content (plain text), sheet cell values, extracted file text.
- Text extraction: `pdf-parse` for PDFs, `mammoth` for DOCX, passthrough for text files.

### File Handling

- Max file size: 25 MB.
- Blocked extensions: .exe, .sh, .bat, .dll, .so, .cmd, .com, .msi, .scr.
- Storage: PostgreSQL BYTEA via `document_files` table (abstracted via StorageProvider for future S3 swap).
- Preview by mime type: images (img), PDFs (iframe), text (pre), otherwise download only.

### Import/Export

- **Docs**: export as Markdown.
- **Sheets**: export as CSV (per tab).
- **Import**: CSV → Sheet, DOCX → Doc (via mammoth).
- **Files**: direct download.

### Database Tables

- `documents` — metadata, content (JSONB), version counter, tags, `agent_editable`
- `document_versions` — version snapshots with content, change summary
- `sheet_tabs` — per-tab sparse cell data (JSONB), columns, row/col counts
- `document_files` — binary file storage (BYTEA), separated for future S3 swap
- `document_search` — full-text search index (tsvector + GIN)

### Access Control

Every document must be associated with an agent (`agent_id` is required). Permissions follow agent roles. Superadmin/Admin get owner-level access to ALL agents automatically.

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer |
|--------|-----------|-------|-------------|-------------|--------|
| View all documents | Yes | Yes | Yes | Yes | Yes |
| Create documents | Yes | Yes | Yes | No | No |
| Edit documents | Yes | Yes | Yes | No | No |
| Delete (archive) | Yes | Yes | Yes | No | No |
| Permanent delete | Yes | Yes | No | No | No |
| Toggle agent_editable | Yes | Yes | Yes | No | No |

---

## Knowledge Base

### KB Entries

- Stored in `kb_entries` table.
- Full-text search via PostgreSQL tsvector + GIN index.
- Fields: title, content, category, source, approved (boolean).
- Agent-contributed entries default to `approved: false` (need admin review).
- Admins can add manual entries, edit non-synced entries, approve pending entries, delete entries.
- Auto-synced entries from connected sources cannot be edited.

### KB Sources

| Source | Config | Connection Type |
|--------|--------|-----------------|
| GitHub | Repository (owner/name), branch, path filter | GitHub API token (KB API key) |
| Google Drive | Folder ID (via folder picker) | Google OAuth connection |
| Zendesk Help Center | Subdomain, category ID (optional) | Zendesk API token (KB API key) |
| Website / Docs (Web Crawl) | Start URL, max pages, URL pattern filter | Firecrawl API key (KB API key) |
| Notion | Root page ID | Notion OAuth connection |

### KB Source Management

- **Add Source**: 4-step wizard (Choose Type, Configure, Sync Settings, Review & Create).
- **Edit**: Update source name and configuration.
- **Sync**: Run immediate one-time sync.
- **Delete**: Removes source and all associated entries.
- Auto-sync toggleable per source (24-hour interval).

### KB Page Hierarchy

1. **Sources** -- top-level view with source cards (GitHub, Drive, Zendesk, etc.) + "Manual Entries" card.
2. **Documents** -- click source card to see entries, with source name in breadcrumb.
3. **Content** -- click entry for full content, category, source, last-updated date.

### KB Source Sync (Every 15 Minutes via Sync Process)

- Sync process (`src/sync.ts`) handles KB source syncs.
- Auto-sync checks periodically for sources with auto-sync enabled.
- Each source connector handles fetching and indexing from its data source.

### KB API Keys

- Managed on Sources sub-page.
- Keys shown once at creation -- copy immediately.
- Used for external programmatic KB access.

**Access:**

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer |
|--------|-----------|-------|-------------|-------------|--------|
| Browse KB sources | Yes | Yes | Yes | Yes | Yes |
| Search KB entries | Yes | Yes | Yes | Yes | Yes |
| View KB entry content | Yes | Yes | Yes | Yes | Yes |
| Add manual entries | Yes | Yes | No | No | No |
| Edit non-synced entries | Yes | Yes | No | No | No |
| Delete entries | Yes | Yes | No | No | No |
| Approve pending entries | Yes | Yes | No | No | No |
| Add KB sources | Yes | Yes | No | No | No |
| Edit KB sources | Yes | Yes | No | No | No |
| Delete KB sources | Yes | Yes | No | No | No |
| Trigger sync | Yes | Yes | No | No | No |
| Manage API keys | Yes | Yes | No | No | No |

---

## Triggers

### Types

| Type | DB value | Description |
|------|----------|-------------|
| Channel messages | `slack_channel` | Agent responds to messages in specific channels |
| Scheduled | `schedule` | Cron expression with timezone support |
| Linear | `linear` | React to issue updates |
| Zendesk | `zendesk` | React to ticket events |
| Intercom | `intercom` | React to conversation events |
| Webhook | `webhook` | Generic HTTP webhook at `/webhooks/agent-{name}` |

### Rules

- Scheduler process (`src/scheduler.ts`) evaluates cron triggers every 60 seconds.
- Deduplication via Redis NX keys with 5-minute window (prevents duplicate triggers from same event).
- Scheduled triggers post results to agent's `channel_id`.
- Triggers can be paused, resumed, edited, and deleted from dashboard Triggers tab.
- Webhook signature verification for GitHub, Linear, Zendesk, Intercom (in `src/utils/webhooks.ts`).
- Schedule triggers use cron expressions with timezone support (timezone auto-detected from Slack workspace).

**Access:**

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer |
|--------|-----------|-------|-------------|-------------|--------|
| View triggers | Yes | Yes | Yes | Yes | Yes |
| Create triggers | Yes | Yes | Yes | No | No |
| Edit triggers | Yes | Yes | Yes | No | No |
| Pause/Resume triggers | Yes | Yes | Yes | No | No |
| Delete triggers | Yes | Yes | Yes | No | No |

---

## Agent Memory

- **Optional** per-agent (toggle in Settings during creation or on Overview tab).
- **Categories:** customer_preference, decision, context, technical, general, preference, procedure, correction, entity.
- Stored in `agent_memories` table with relevance scores.
- Memories extracted automatically after each run (when enabled).
- Viewable and deletable from agent's Memory tab in dashboard.
- User can type `forget about <topic>` in agent's channel to remove specific memories.

---

## Self-Evolution

### Modes

| Mode | DB value | Behavior |
|------|----------|----------|
| Off | `off` | No self-evolution |
| Supervised | `supervised` | Creates proposal for admin review (status: pending) |
| Autonomous | `autonomous` | Auto-executes proposals immediately (status: executed) |

### Proposal Types

| Action | What it does |
|--------|-------------|
| `update_prompt` | Modify agent's system prompt |
| `write_tool` | Create a new custom tool |
| `create_mcp` | Create an MCP server configuration |
| `commit_code` | Commit code changes |
| `add_to_kb` | Add content to knowledge base |

### Rules

- Only `canModifyAgent()` (owner-level access) can approve or reject proposals.
- Supervised: proposal created with status `pending`, admins notified via Slack DM with "Review in Dashboard" link.
- Autonomous: proposal created with status `executed`, `executeProposal()` runs immediately.
- `getPendingProposals()` returns all pending proposals, optionally filtered by agent.
- History limited to last 50 proposals per agent (`getProposalHistory`).
- Agent-created tools require admin approval before other agents can use them (shown in "Agent-Created Tools" section on Tools page).

**Access:**

| Action | Superadmin | Admin | Agent Owner | Agent Member | Viewer |
|--------|-----------|-------|-------------|-------------|--------|
| Enable/disable self-evolution | Yes | Yes | Yes | No | No |
| Set evolution mode | Yes | Yes | Yes | No | No |
| View proposals | Yes | Yes | Yes | Yes | Yes |
| Approve proposals | Yes | Yes | Yes | No | No |
| Reject proposals | Yes | Yes | Yes | No | No |
| Approve agent-created tools | Yes | Yes | No | No | No |

---

## Self-Improvement

- Detects critique in agent output (e.g., user corrects agent behavior in-thread: "that's wrong", "next time do X", "fix your tone").
- Automatically suggests prompt refinements based on the critique.
- Shows diff of proposed changes for approval.
- Handled by `src/modules/self-improvement/`.
- Works independently of self-evolution mode.

---

## Skills

### Structure

- Markdown files in `skills/` directory at repo root.
- YAML frontmatter for metadata; markdown body is the template (for `prompt_template` type).
- Auto-discovered: no registration files to edit. System reads all `.md` files in the skills directory.
- Loaded by `src/modules/skills/` (builtins loader).

### Types

| Type | Description |
|------|-------------|
| `prompt_template` | Markdown body is the template with `{{variable}}` placeholders |
| `mcp` | MCP server integration, capabilities listed in frontmatter |

### Required Frontmatter Fields

```yaml
id: unique-id
name: Display Name
skillType: prompt_template | mcp
description: Short description
```

### Adding a New Skill

1. Create `skills/<name>.md`.
2. Add YAML frontmatter with required fields.
3. For prompt template skills, write the template as the markdown body.
4. No other files need editing.

---

## Workflows

- Multi-step stateful workflows (DAG of steps).
- Stored in `workflow_definitions` and `workflow_runs` tables.
- **Step types:** agent_action, human_action, conditional, parallel.
- Timer-based expiration on steps.
- Human-in-the-loop: workflow pauses for human input at `human_action` steps.
- Capped at 20 steps to prevent runaway execution.
- Side effects tracked to prevent duplicate execution on retries.
- Handled by `src/modules/workflows/`.

---

## Dashboard

### Design Principles (Strict Rules)

The dashboard is for a **non-technical audience**. Follow these rules without exception:

- **No user IDs** -- never show raw Slack user IDs (e.g., `UH6TP67FB`). Always resolve to display names.
- **No technical identifiers** -- no trace IDs, database IDs, internal names, or API slugs.
- **Friendly labels** -- "Effort" not "maxTurns". "Web Search" not "WebSearch". "Ask Owner/Admins" not "admin_confirm".
- **No jargon** -- avoid "built-in", "integration", "token bucket", "tsvector". Say what it does, not how it works.
- **Model names** -- show "Sonnet", "Opus", "Haiku" -- never full model IDs like `claude-sonnet-4-20250514`.
- **Status labels** -- "Completed" not "success". "Failed" not "error". "Running" not "in_progress".

### Dashboard Labels & Terminology

All user-facing text in the dashboard and agent creation flow MUST use these labels. Never use internal/technical terms.

**Credential Modes:**

| Internal Value | Dashboard Label | Creation Flow Label |
|---------------|----------------|-------------------|
| `team` | Team credentials | Shared team credentials |
| `delegated` | Agent creator's | The agent creator's credentials |
| `runtime` | Requesting user's | Each user's own credentials |
| `personal` | Requesting user's | Each user's own credentials |

**Never use:** "delegated", "runtime", "credential mode", "connection mode" in user-facing text.

**Tool Access Levels:**

| Internal Value | Dashboard Label |
|---------------|----------------|
| `read-only` | Can view data |
| `read-write` | Can make changes |

**Agent Response Modes:**

| Internal Value | Dashboard Label |
|---------------|----------------|
| `mentions_only` | When tagged |
| `respond_to_all_messages` | Every message |
| (default) | When relevant |

**Write Policies:**

| Internal Value | Dashboard Label |
|---------------|----------------|
| `auto` | Automatic |
| `confirm` | Ask before acting |
| `admin_confirm` | Ask owner/admins |

**Status Labels:**

| Internal Value | Dashboard Label |
|---------------|----------------|
| `success` | Completed |
| `error` / `failed` | Failed |
| `in_progress` / `running` | Running |
| `active` | Active |
| `expired` | Expired |
| `revoked` | Revoked |

**Model Names:**

| Internal Value | Dashboard Label |
|---------------|----------------|
| `claude-sonnet-4-20250514` (or any sonnet) | Sonnet |
| `claude-opus-4-6` (or any opus) | Opus |
| `claude-haiku-4-5-20251001` (or any haiku) | Haiku |

**Effort (maxTurns):**

| Internal Value | Dashboard Label |
|---------------|----------------|
| `maxTurns` | Effort |
| Low values (1-10) | Quick tasks |
| Medium values (15-25) | Standard tasks |
| High values (30-50) | Complex tasks |

### Pages

| Page | Access | Description |
|------|--------|-------------|
| Dashboard | All | Agent metrics, recent activity, cost tracking |
| Agents | All | List, filter, search. Split: "Your Agents" + "Other Agents". Create/edit |
| Agent Detail | All (varies by role) | 6 tabs: Overview, Tools, Runs, Memory, Triggers, Access |
| Tools & Integrations | Admin only | Connect services, manage integrations, agent-created tools |
| Connections | All | Personal connections tab + Team connections tab (read-only for non-admins) |
| Knowledge Base | All | Browse sources, entries, search. Admin: add/edit/approve/delete |
| Documents | All | List, create, edit, delete docs/sheets/files. Filter by type, search, version history |
| Requests | All | Tabs: Tool Requests, Upgrade Requests, Evolution Proposals, Feature Requests, KB Contributions |
| Error Logs | All | Recent errors and failed runs |
| Audit Log | Admin only | Full action audit trail, filterable |
| Access & Roles | Admin only | Platform role management |
| Workspace Settings | Admin only | Global configuration |

### Sidebar Badges

- Total pending request count badge on "Requests" sidebar item.
- Per-type counts on individual request sub-tabs.

**Access:**

| Page | Superadmin | Admin | Member | Notes |
|------|-----------|-------|--------|-------|
| Dashboard (home) | Full | Full | Full | Metrics, activity, cost |
| Agents | Full | Full | View + interact with accessible agents | Members cannot create agents |
| Agent Detail | All tabs | All tabs | Varies by agent role | Viewers see limited tabs |
| Tools & Integrations | Full | Full | No access ("Admin Access Required") | |
| Connections | Full + manage team | Full + manage team | Personal only (team read-only) | |
| Knowledge Base | Full CRUD | Full CRUD | Browse + search only | Cannot add/edit/delete |
| Requests | All tabs | All tabs | All tabs | Can only act on own requests unless admin |
| Error Logs | Full | Full | Full | |
| Audit Log | Full | Full | No access | Admin only |
| Access & Roles | Full | Full | No access | Admin only |
| Workspace Settings | Full | Full | No access | Admin only |

---

## AI Chat Assistant (FloatingChat)

The FloatingChat widget is an AI-powered assistant available on every page. It uses Claude with tool-use to provide intelligent responses, agent configuration updates, and deep diagnostic analysis.

### Modes

1. **Creation Mode** — Activated at `/agents/new` or by typing "create a new agent" in the chat from any page. Runs the full agent creation flow (see Agent Lifecycle > AI Chat Creation Flow).
2. **Regular Chat Mode** — Multi-turn conversation with streaming responses. Can manage agents and diagnose issues.

### Capabilities

- **Agent configuration** — Select an agent from the dropdown, then ask to change settings. The assistant proposes changes as a visual diff that you can review and apply with one click.
- **Agent diagnostics** — Ask "why is this agent failing?" or "what went wrong in the last run?" The assistant inspects run history, tool calls, error rates, memories, triggers, tool code, and audit logs to diagnose issues and suggest fixes.
- **General workspace questions** — Ask about error rates, usage, which agents exist, etc.
- **Agent creation from any page** — Type "create a new agent" or click the suggestion to start the creation flow without navigating away.

### Diagnostic Tools

The assistant has access to 13 tools it calls on-demand to gather data:

| Tool | What it does |
|------|-------------|
| Agent config | Read the agent's full settings, instructions, tools, model |
| Recent runs | Fetch recent runs with status filtering |
| Run detail | Read a specific run's input, output, tokens, cost |
| Run tool calls | Inspect individual tool calls with inputs/outputs/errors |
| Run trace | Read the full step-by-step execution trace |
| Tool code | Read a tool's actual code and schema to understand capabilities |
| Tool analytics | Check success rates, average duration, last error |
| Agent memories | Review learned facts and patterns |
| Agent triggers | Check scheduled and event-based trigger configs |
| Error rates | Compare error rates across all agents |
| Audit log | See recent config changes and actions |
| List agents | List all agents in the workspace |
| Propose changes | Build a structured config change diff for review |

### Streaming

Responses stream via Server-Sent Events (SSE). During diagnostic analysis, the UI shows real-time status indicators like "Checking run history..." and "Analyzing tool errors..." as the assistant calls tools.

### Model Override

Type `/opus`, `/sonnet`, or `/haiku` at the start of a message to override the model for that request. A badge appears in the header showing the active override. Click to clear.

### Multi-Turn Conversation

The full conversation history is sent with each request, so the assistant remembers context within a conversation. Conversations are stored in-memory (up to 20, not persisted to database).

### Execution Trace Capture

Every agent run now stores:
- **`conversation_trace`** — Full JSONL output from the Claude SDK execution, stored on the run_history record.
- **`tool_calls`** table — Per-invocation records with tool name, input parameters, output, errors, and sequence number. Enables the diagnostic assistant to inspect exactly what each tool did during a run.

### Context-Aware Suggestions

Empty state shows different quick-action buttons depending on context:
- **With agent selected**: "Why is this agent failing?", "Show recent errors", "Improve instructions", "Change the model"
- **Without agent**: "Create a new agent", "Which agent has the most errors?", "Show overall usage"

### Non-Technical Language Rules

The assistant follows strict rules for user-facing language:
- Tool names: "Google Sheets" not "google-sheets-read"
- Models: "Sonnet" not "claude-sonnet-4-20250514"
- Durations: "2.3s" not "2300ms"
- Costs: "$0.03" not "0.03 USD"
- No IDs, no jargon, no technical internals

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/chat/stream` | POST | SSE streaming chat (primary) |
| `/api/v1/chat` | POST | Non-streaming chat (backward compatible) |

**Request body** (both endpoints):
```json
{
  "messages": [{"role": "user", "content": "..."}],
  "agentId": "optional-agent-id",
  "context": "dashboard|agent|tools|kb|general",
  "modelOverride": "opus|sonnet|haiku"
}
```

The non-streaming endpoint also accepts the legacy `{ "message": "..." }` format for backward compatibility.

---

## Observability

- **Cost tracking** per run: input tokens, output tokens, estimated cost in USD (via `src/utils/costs.ts`, `estimateCost()`, `getModelId()`).
- **Error rate monitoring**: tracks failed runs, posts alerts when error rate exceeds thresholds.
- **Alerts**: posted to `#tinyhands` Slack channel. Built-in rules: high error rate (>10%), expensive runs (>$5), daily budget exceeded, queue depth warnings, long-running jobs.
- **Daily digest**: automated summary posted to Slack -- run count, token usage, cost, top agent, top user, high error agents, anomalous cost spikes (>2x 7-day average). Generated by sync process.
- **Run history**: full execution records in `run_history` table with all metrics.
- **Error Logs page**: browse failed runs with error details, agent name, duration, user, timestamp.
- **Daily budget**: set `DAILY_BUDGET_USD` env var. When exceeded, non-critical triggers paused and alert posted.

---

## Auto-Update

- Pull-based deployment from GitHub (no CI/CD pipeline needed).
- Enabled via `AUTO_UPDATE_ENABLED` env var.
- Checks for new commits periodically.
- Only deploys when `package.json` version changes.
- Process: pull code -> `npm install` -> `npm run build` -> run migrations -> reload PM2.
- Resilient reload: if bulk `pm2 reload` fails, falls back to reloading each process individually to prevent partial deploys.
- Deploy webhook endpoint: `POST /webhooks/github-deploy`.
- Handled by `src/modules/auto-update/`.

---

## Notifications & Alerts

### Notification Channels

| Channel | Description |
|---------|-------------|
| **Slack DM** | Direct message to specific user(s) |
| **Slack Channel** | Posted to #tinyhands (or configured channel) |
| **Slack Thread** | In-context reply in the conversation thread |
| **Dashboard Badge** | Count badge on "Requests" sidebar item |
| **Dashboard Page** | Viewable on a specific dashboard page/tab |
| **Silent** | Logged only, not surfaced to users |

### Notification Matrix

| Event | Slack DM | Slack Channel | Slack Thread | Dashboard Badge | Silent | Recipients |
|-------|----------|--------------|-------------|----------------|--------|------------|
| **Evolution Proposals** (pending) | Yes | - | - | Yes (Requests) | - | Platform admins |
| **Credential Requests** (non-admin) | Yes | - | - | Yes (Requests) | - | Platform admins |
| **Upgrade Requests** | - | - | - | Yes (Requests) | - | Agent owners |
| **KB Contributions** | - | - | - | Yes (Requests) | - | Admins |
| **Feature Requests** | - | - | - | Yes (Requests) | - | Admins |
| **Error Rate Alert** (>10%) | - | Yes | - | - | - | Channel watchers |
| **Single Run Cost Alert** (>$5) | - | Yes | - | - | - | Channel watchers |
| **Daily Budget Alert** | - | Yes | - | - | - | Channel watchers |
| **Long Running Task Alert** | - | Yes | - | - | - | Channel watchers |
| **Daily Digest** | - | Yes | - | - | - | Channel watchers |
| **OAuth Connection Success** | Yes | - | - | - | - | OAuth user |
| **Credential Error Pre-Run** | - | - | Yes | - | - | Thread users |
| **Write Action Approval** | - | - | Yes | - | - | Thread users |
| **Critique Detection** | - | - | Yes | - | - | Thread users |
| **Run Completion/Error** | - | - | Yes | - | - | Thread users |
| **Role Changes** | - | - | - | - | Yes | (none) |
| **Trigger Failures** | - | - | - | - | Yes | (none) |
| **OAuth Token Expiry** | Yes | - | - | Yes | - | Connection owner (DM with dashboard reconnect CTA) |
| **Audit Events** | - | - | - | - | Yes | (none) |

### Dashboard "Requests" Page Tabs

5 tabs with per-type badge counts:
1. **Upgrade Requests** — Viewer→Member access requests
2. **Action Approvals** — Write policy approval queue
3. **Evolution Proposals** — Agent self-improvement proposals
4. **Credential Requests** — Non-admin team credential requests (Approve+Deny for write tools, Configure+Deny for read tools)
5. **Feature Requests** — User-submitted feature/tool requests
6. **KB Contributions** — Pending knowledge base entries

### Alert Cooldowns

- Observability alerts: 30-minute cooldown per condition
- Daily digest: Once per day at configured time (default 8am)

---

## Error Handling

**User-facing rules:**
- All user-facing error messages are professional and non-technical.
- Never expose `err.message`, database errors, or stack traces to users.
- Generic pattern: "Something went wrong. Please try again."
- Credential errors use role-aware messages (see Credential & Connection System section).

**Internal logging:**
- Full technical details preserved in logs via `src/utils/logger.ts`.
- Structured logging with context (workspaceId, agentId, userId, etc.).
- Log levels: error, warn, info, debug (configurable via `LOG_LEVEL` env var).
- Run events logged via `logRunEvent()` for per-run tracing.

---

## Database

### PostgreSQL with Migrations

- Migrations in `src/db/migrations/`.
- Query helpers: `query<T>()` (returns array), `queryOne<T>()` (returns single row or undefined), `execute()` (no return).

### Connection Pool: Per-Process Sizing

| Process | Pool max |
|---------|----------|
| Listener | 2 |
| Worker | 3 |
| Scheduler | 1 |
| Sync | 1 |

- `idleTimeoutMillis`: 10000 (10s)
- `connectionTimeoutMillis`: 5000 (5s)

### Graceful Shutdown

- All processes call `closeDb()` on SIGTERM.
- Pool drained before process exit.

### Pool Health Logging Every 5 Minutes

- Logs total, idle, and waiting connection counts.
- Helps diagnose connection exhaustion.

### Circuit Breaker on Pool Reset (Max 3 Resets, 30s Cooldown)

- `consecutiveFailures` tracked per query.
- Pool reset attempted after `MAX_FAILURES_BEFORE_RESET` (3 consecutive failures).
- Rate limited: no more than one reset per 30 seconds (`RESET_COOLDOWN_MS`).
- Circuit breaker: stops after `MAX_RESETS` (3 total resets).
- Mutex prevents concurrent resets.
- `isConnectionError()` detects: ECONNREFUSED, ECONNRESET, ETIMEDOUT, SSL errors, timeout, connection terminated, remaining slots.

### Key Tables

| Table | Purpose |
|-------|---------|
| `agents` | Agent config (name, system_prompt, tools[], model, default_access, write_policy, channels) |
| `run_history` | Execution records (tokens, cost, duration, status, trace_id) |
| `custom_tools` | Tool definitions (schema, code, config, access_level) |
| `kb_entries` | Knowledge base articles (tsvector full-text search) |
| `kb_sources` | KB source configs (auto-sync, connectors) |
| `triggers` | Agent activation rules (cron, webhook, event-based) |
| `sources` / `source_chunks` | Agent data sources and indexed content |
| `agent_memories` | Persistent cross-run memory (facts, categories, relevance) |
| `workflow_definitions` / `workflow_runs` | Multi-step automation state |
| `evolution_proposals` | Agent self-improvement proposals |
| `platform_roles` | Workspace-level roles (superadmin, admin, member) |
| `agent_roles` | Per-agent access levels (owner, member, viewer) |
| `agent_versions` | Configuration version history (all tracked fields) |
| `workspace_settings` | Per-workspace configuration |
| `upgrade_requests` | Viewer-to-member upgrade request tracking |
| `connections` | Encrypted tool credentials (team + personal) |
| `agent_tool_connections` | Per-agent tool connection mode config |
| `oauth_states` | OAuth flow state tracking |
| `action_audit_log` | Comprehensive action audit trail |

---

## Audit Log

- Comprehensive action trail stored in `action_audit_log` table.
- **Tracked actions:** role changes (platform and agent), agent creation/updates/deletion, tool invocations with user context, connection creation/deletion, upgrade request approvals/denials.
- Indexed by: workspace, agent, user, timestamp.
- Forever retention.
- Accessible via dashboard Audit Log page (admin only) or `/audit` Slack command (redirects to dashboard).
- Filterable by agent, user, action type, date range.
- Audit events are fire-and-forget (non-blocking, best-effort via `logAuditEvent()` with `.catch(() => {})` pattern).

---

## Slack Integration

### Slash Commands

| Command | Where | Who | What it does |
|---------|-------|-----|--------------|
| `/agents` | Anywhere | All | Link to web dashboard |
| `/new-agent` | Anywhere | All | Redirect to agent creation on dashboard |
| `/update-agent` | Anywhere | All | Redirect to agent management on dashboard |
| `/tools` | Anywhere | All | Redirect to tools page on dashboard |
| `/kb` | Anywhere | All | Redirect to KB page on dashboard |
| `/audit` | Anywhere | All | Redirect to audit log on dashboard |
| `/templates` | Anywhere | All | Redirect to agent templates on dashboard |
| `/connect` | Bot DM | All | Manage personal tool connections |
| `add @user as superadmin` | Bot DM | Superadmins | Grant superadmin access |

### Event Subscriptions (Socket Mode)

- `message.channels` -- public channel messages
- `message.groups` -- private channel messages
- `message.im` -- direct messages
- `message.mpim` -- group DMs
- `app_mention` -- @mentions
- `app_home_opened` -- Home tab opened
- `file_shared` -- file uploads for KB

### Activation Modes

| Mode | DB columns | Behavior |
|------|-----------|----------|
| Only when @mentioned | `mentions_only = true` | Agent responds only when @mentioned |
| Relevant messages | both false (default) | AI-determined relevance check |
| Every message | `respond_to_all = true` | Agent responds to all messages in its channels |

### Channel Listing

- Dashboard channel API (`GET /api/v1/slack/channels`) auto-paginates to return ALL workspace channels.
- Public channels: always visible (bot has `channels:read` scope).
- Private channels: only visible if the bot has been invited (`groups:read` scope, bot must be a member).
- Channel list sorted: private channels first, then public, alphabetical within each group.
- Help text shown on all channel dropdowns: "Don't see your channel? Private channels need TinyHands to be invited first. Use /invite @TinyHands in the channel."
- Refresh button available to refetch after inviting the bot.

### Real-Time Streaming

- Progressive message updates in Slack threads via `src/slack/buffer.ts`.
- Custom avatars: each agent posts with its own name and emoji (`chat:write.customize` scope).
- Status updates shown while agent thinks, uses tools, composes response.

---

## Processes

| Process | Entry | Count | Purpose |
|---------|-------|-------|---------|
| Listener | `src/index.ts` | 1 | Slack events, commands, webhooks, Express server, dashboard API |
| Worker | `src/worker.ts` | 3 | Dequeue jobs, run agents in Docker containers |
| Scheduler | `src/scheduler.ts` | 1 | Evaluate cron triggers every 60s |
| Sync | `src/sync.ts` | 1 | KB source sync, alerts, daily digest, auto-update |

All managed by PM2. Total: 6 processes.

---

## Templates

- Pre-built agent templates in `templates/` directory at repo root.
- Markdown files with YAML frontmatter (same discovery pattern as skills).
- One-click activation from dashboard.
- 10 templates across categories: Content & SEO, Sales & Revenue, Customer Insights, Competitive Intelligence, Growth.
- Auto-discovered: drop a file, no registration needed.

---

## Multi-Agent Teams

- Lead agent can spawn sub-agents for parallel work.
- Concurrency limits: default 3 concurrent sub-agents.
- Depth limits: default 2 levels (prevents recursive explosion).
- Results aggregated when all sub-agents complete.
- Total cost calculated across all sub-agent runs.
- Handled by `src/modules/teams/`.

---

## Self-Authoring (Agent-Created Tools)

- Agents can create tools during execution.
- `src/modules/self-authoring/` handles tool creation, code artifacts, MCP configs.
- Created tools require admin approval before other agents can use them.
- Shown in "Agent-Created Tools" section on Tools & Integrations page.
- Admin can approve or delete from overflow menu.
- Code validated and sandbox-tested in Docker before activation.
- Tool versioning: every code update recorded, rollback available.

---

## Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | App-level token for Socket Mode (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | Slack request signature verification |
| `ANTHROPIC_API_KEY` | Claude API key |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `WEB_DASHBOARD_URL` | Falls back to `OAUTH_REDIRECT_BASE_URL` or `http://localhost:3000` | Dashboard URL used in Slack messages |
| `ENCRYPTION_KEY` | (none) | 32+ chars, AES-256-GCM credential encryption |
| `GOOGLE_OAUTH_CLIENT_ID` | (none) | Shared by Drive, Sheets, Docs, Gmail |
| `GOOGLE_OAUTH_CLIENT_SECRET` | (none) | Google OAuth secret |
| `NOTION_OAUTH_CLIENT_ID` | (none) | Notion OAuth client ID |
| `NOTION_OAUTH_CLIENT_SECRET` | (none) | Notion OAuth secret |
| `GITHUB_OAUTH_CLIENT_ID` | (none) | GitHub OAuth client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | (none) | GitHub OAuth secret |
| `OAUTH_REDIRECT_BASE_URL` | (none) | Public URL for OAuth callbacks |
| `OAUTH_DOMAIN` | (none) | Domain for Nginx SSL/Let's Encrypt setup |
| `LETSENCRYPT_EMAIL` | (none) | Let's Encrypt certificate notifications |
| `GITHUB_TOKEN` | (none) | Auto-update feature |
| `PORT` | 3000 | Express server port |
| `LOG_LEVEL` | info | Logging verbosity |
| `DOCKER_BASE_IMAGE` | (default) | Base Docker image for agent execution containers |
| `DAILY_BUDGET_USD` | (none) | Daily spending limit |
| `AUTO_UPDATE_ENABLED` | false | Enable pull-based auto-update from GitHub |
| `DATABASE_POOL_URL` | (none) | PgBouncer connection for queries (direct URL used for migrations) |
