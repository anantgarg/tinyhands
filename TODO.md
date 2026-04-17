# TinyHands Dashboard TODO

## Unimplemented Dashboard Features

Features that exist in the backend but have no dashboard UI yet.

### 1. Multi-Step Workflows
The Workflows page is a stub showing "Coming Soon." No workflow builder, no execution, no status tracking. The backend has full workflow support but the dashboard has zero UI for it.

### 2. Multi-Agent Teams
No dashboard UI for configuring teams, spawning sub-agents, or viewing team results. The backend module exists (`src/modules/teams/`) but there's no page or UI component for it.

### 3. Skills
No Skills tab on the agent detail page. No way to attach/detach skills from the dashboard. Skills are managed only via Slack commands. The backend and API exist but the dashboard has no UI.

### ~~4. Custom Tool Creation~~ ✅
~~The Tools page shows/approves/deletes existing custom tools, but there's no UI to create a custom tool (define schema, write code, test). Creation happens only through agent self-authoring or Slack.~~
Done: Create Tool dialog with 3 tabs (AI Generate, API Template, Manual), access level selector, name validation, sandbox testing with duration display.

### ~~5. Tool Authoring / Self-Authoring~~ ✅
~~No dashboard UI for AI-powered tool generation, sandbox testing, or tool pipelines. This is backend-only functionality triggered during agent runs.~~
Done: Tool Detail dialog with Overview (code + schema + sandbox test), Versions (history + rollback), and Usage (analytics) tabs. Clickable tool rows.

### ~~6. Critique-Driven Learning / Self-Improvement~~ ✅
~~No dashboard UI. Critique detection and prompt refinement happen in Slack threads only.~~
Done: Learning tab on Agent Detail with prompt health indicator, inline suggest improvement (side-by-side diff), and full version history with preview/restore.

### ~~7. Evolution Proposals Navigation~~ ✅
~~The Evolution page exists and works, but it's only accessible from the Requests page tab. There's no standalone Evolution page in the sidebar navigation. The page exists at `/evolution` but isn't linked.~~
Done: Added route in App.tsx, sidebar link under Review, fixed backend to enrich with agent name/avatar, fixed frontend type mismatches.

### ~~8. Agent Creation Data Loss (Critical)~~ ✅
~~The AI creation flow creates agents with blank/default data even though the goal analyzer generated correct config. The `doCreate()` function's `config` state appears stale due to React state timing.~~
Done: Fixed tool name mapping — preSelected was using base names (e.g. "hubspot") instead of actual tool names (e.g. "hubspot-read"), causing tools to be silently dropped on agent creation.

### ~~9. Connection Health Monitoring~~ ✅
~~No proactive notification when OAuth tokens expire. Connections stay "active" in DB until a run fails.~~
Done: 30-min periodic health check in sync process, Google OAuth token refresh with auto-expiry, Slack DM notification with dashboard reconnect CTA, sidebar badge for expired connections, warning banner + reconnect buttons on Connections page.

### ~~10. Smart Tool Selection in Agent Creation~~ ✅
~~The tools step in the AI creation flow should auto-select tools based on the goal analyzer's recommendations.~~
Done: Fixed by the same tool name mapping fix as #8 — goal analyzer recommendations now correctly pre-select tools in the MultiSelectCard.

### 11. Notification Gaps
Several events are silently logged but should notify users:

**Missing Slack DM notifications:**
- **Upgrade Requests** — Agent owners should get a DM when someone requests access (currently dashboard-only)
- ~~**OAuth Token Expiry** — Connection owner should get a DM when their token expires with a reconnect link~~ ✅
- **KB Contributions** — Admins should get a DM when new KB entries are submitted for approval
- **Trigger Failures** — Agent owner should get a DM when a scheduled/event trigger fails

**Missing Dashboard indicators:**
- ~~**Expired Connections** — Sidebar badge showing count of broken/expired connections~~ ✅
- **Agent Health** — Warning badge on agent detail page when agent has high error rate or expired tool credentials

### 12. Document Filling
No dashboard UI. Template field extraction and KB-powered filling is backend-only, triggered during agent runs.

### 9. Per-Message Model Override
No dashboard UI. The `[run with opus]` inline directive only works in Slack messages, not from the dashboard chat.

### 10. Daily Digest
No dashboard page for viewing or configuring the daily digest. It's a Slack-only feature (posts to a channel).

### 11. Alert Configuration
The dashboard shows error rates on the Dashboard page, but there's no UI to configure alert rules, thresholds, or notification channels. Alerts are hardcoded in the backend.

### 12. Floating Chat Improvements
The floating chat widget exists but is basic. Could benefit from agent selection, conversation history, and model override support.

### 13. Notion/GitHub OAuth on Connections Page
FEATURES.md mentions OAuth for Notion and GitHub, but the Connections page only shows Google integrations with OAuth buttons. Notion and GitHub OAuth are configured in the backend but not surfaced in the dashboard's Add Connection dialog.

### 14. Backfill ATC Entries for Existing Agents
Agents created before the no-fallback change may have tools without `agent_tool_connections` entries. These agents will now fail with "credentials not configured" errors. Need a migration or startup task that backfills missing ATC entries based on the integration's `connectionModel` (team-only tools get `team` mode, personal-only tools get `runtime` or `delegated` based on existing connections).

### 15. Cost Guardrails During Agent Creation & Editing
When creating or updating an agent, the AI goal analyzer (or a separate guardrail check) should automatically detect patterns that could lead to expensive runs and warn the user before saving. Examples: scheduled agents querying large datasets without date filters, unbounded API searches, agents that pull full contact/ticket lists every run instead of incremental changes, high max_turns on frequent schedules. The guardrail should suggest fixes like adding date filters, limiting result counts, or reducing schedule frequency. This should work both during AI-guided creation and when editing an existing agent's prompt or settings.

### 16. Folder Restrictions Enforcement
The folder picker exists on the Connections page, but the Google Drive tool code doesn't actually read the `root_folder_id` from the credentials to restrict operations. The setting is stored but not enforced at runtime.

### 17. Admin "All Members" Connections Tab
Admins currently can only see Team Connections and their own Personal Connections. There's no way for an admin to see other users' personal connections (e.g., to diagnose Apoorv's expired Google connections). Add a third tab on the Connections page — "All Members" (admin-only) — that lists every user's personal connections with their name, status, and integration. This would also make the expired connections badge actionable for admins: they could see who has expired connections and reach out to them. The expired badge should then also count other users' expired personal connections for admins.

### 18. Agent Diagnostics Assistant
An AI-powered diagnostic agent (like Claude Code for TinyHands) that agent creators can talk to when an agent responds incorrectly. It would pull the agent's run logs, tool call history, system prompt, and tool schemas to diagnose why the agent behaved the way it did — e.g., "the HubSpot tool returned 0 results because search_contacts can't filter by blank properties, you need filter_contacts." Today when an agent gives a wrong answer, there's no way for the creator to know whether the problem is the prompt, the tool, the data, or the model — they just see the wrong output. This assistant would bridge that gap.

### 19. Clean up orphaned Slack connect handlers
The `connect_personal_apikey`, `connect_personal_oauth`, and `personal_connection_modal` handlers in `src/slack/commands.ts` are no longer triggered from execution errors (replaced with dashboard redirect). They're still referenced by `buildCredentialSelectionBlocks` during Slack agent creation. If Slack creation is fully deprecated, these handlers can be removed.

### 20. Update PRODUCT_GUIDE.md and ADMIN_GUIDE.md for credential system changes
The credential system was overhauled: `connectionModel` replaced with `supportedCredentialModes`, Slack connect flow removed, tool requests expanded to all team credential selections, runtime "Continue without tools?" confirmation added. PRODUCT_GUIDE.md and ADMIN_GUIDE.md may reference the old behavior.

### 21. Documents Feature Follow-ups
- **RichTextEditor limited heading support**: The TipTap editor only supports h2 headings (`heading: { levels: [2] }`), but the Slate JSON format and markdown converter support h1, h2, h3. Headings created by agents or imported from markdown will display as plain text in the editor. Should either expand TipTap config to support h1-h3 or document the limitation.
- **SheetEditor no real-time collaboration**: Multiple users editing the same sheet will overwrite each other's changes since there's no WebSocket-based live sync or OT/CRDT. The `useUpdateCells` approach sends partial updates which helps, but simultaneous edits to the same cell will still race.
- **FileViewer replaceFile doesn't track version**: The `handleReplace` callback uses `replaceFile.mutate` which calls a separate endpoint that doesn't go through the optimistic locking flow, so `currentVersion` can get out of sync after a file replacement followed by a title rename.

---

## Infrastructure

### Flaky test: `api-kb.test.ts > DELETE /kb/sources/:id > deletes source (admin)`
Passes in isolation (`npx vitest run tests/unit/api-kb.test.ts`) but intermittently returns 404 instead of 200 when run inside the full `npm test` suite. Indicates test pollution from an earlier file mutating shared mock state. Blocks deploys occasionally via husky pre-commit. Discovered during v1.47.0 deploy.

### Production host untracked cruft
The production app checkout accumulated untracked files worth cleaning up: a handful of `retrigger*.js` files plus a nested `src/src/` folder with stale duplicates of repo-root files (`LICENSE`, `README.md`, `PLAN.md`, `.env.example`, `Dockerfile`, `ecosystem.config.js`, etc.). Safe to delete after confirming nothing references them, but not urgent.

### `VERSION` file drifts from `package.json`
`VERSION` is read by the pull-based auto-update checker (`src/modules/auto-update/index.ts`). It had drifted for multiple releases (`VERSION=1.43.1` while `package.json=1.46.3`) which would silently disable auto-update when it's on. Either add a pre-commit hook that asserts `VERSION` matches `package.json.version`, or remove `VERSION` entirely if pull-based auto-update stays disabled. Production currently runs deploys manually via SSH, so this is latent risk, not immediate.

### OAuth redirect URIs still reference old domain
After v1.47.0, the app's `OAUTH_REDIRECT_BASE_URL` is `https://app.tinyhands.ai`, but Slack / Google Cloud Console / Notion / GitHub OAuth apps may still have the previous domain's redirect URIs registered. New OAuth flows started from the dashboard use `app.tinyhands.ai` and will fail if the provider doesn't have that redirect URI whitelisted. Update all four third-party dashboards.

### Test-mock debt — deferred to v1.50
In v1.48.0 we skipped four test files at the vitest config level: `tests/unit/slack-module.test.ts`, `tests/unit/events.test.ts`, `tests/unit/commands.test.ts`, `tests/unit/api-misc.test.ts`. All of them mock the pre-v1.48 Slack surface (static `getSlackApp().client` plus the slash-command handlers that were deleted). The production code moved to `authorize()` + `AsyncLocalStorage` + dashboard-managed workflows, so the mocks don't compose anymore. Rewrite against the new surface in v1.50 and remove entries from `vitest.config.ts` `exclude`.

### v1.48.0 deferred to v1.49
- **Dashboard raw Slack IDs** — Access & Roles "Platform Admins" table and Dashboard "Top Users" / "Top Creators" show raw IDs (e.g. `U01ABCDEF`). `CLAUDE.md` line 334 and `FEATURES.md` line 1167 require resolved display names. Plumb `user-resolver.resolveUserNames()` through `src/api/routes/agents.ts` pending-counts / dashboard / platform endpoints.
- **Workspace Name auto-populate + Settings GET/PATCH** — `GET /settings` returns a flat `workspace_settings` key-value map but the Settings page expects a nested `{general, defaults, rateLimits, alerts}` shape, and there is no `PATCH /settings`. Rewrite the route to return the nested shape (pulling `workspaceName` from `workspaces.team_name`) and add a PATCH that writes `team_name` + `workspace_settings` atomically.

---

## Completed
- [x] Slack DM: Already works — routes to accessible agents via relevance check, shows picker for ambiguous
- [x] Drive folder picker on Connections page (Set Folder / Change Folder per connection)
- [x] Slack mentions resolve to @DisplayName badges, emoji codes render as Unicode
- [x] Credential dropdown fix: API returns camelCase, mode persists correctly
- [x] Connection upsert: reset status to active on reconnect
- [x] Agent detail: 3s timeout on Slack channel name resolution
- [x] Removed redundant Agent Tool Modes tab from Connections page
- [x] Read/Write → Can view data/Can make changes (consistent language)
- [x] KB hierarchy: Sources → Documents → Content browsing
- [x] KB: Entry counts fixed, search above cards, pending tab only for manual, manual filter fixed
- [x] KB Sources: Edit existing sources, help text, Drive folder picker
- [x] Google OAuth: Fixed redirect_uri_mismatch, all 4 integrations work
- [x] Google Workspace: Split into 4 tools (Drive, Sheets, Docs, Gmail), legacy cleaned up
- [x] Tools page: Connect with Google for OAuth, Can view data/Can make changes badges
- [x] Version History: Tracks ALL config changes with snapshot preview
- [x] Agent Create: Settings descriptions, grouped tools, goal analyzer auto-select
- [x] Non-admin restrictions: Hide Create Agent, owner-only actions
- [x] Adding tools to agents: checks integration manifests (not just custom_tools DB)
- [x] Auto-synced entries note moved above buttons in KB entry dialog
- [x] Custom Tool Creation: 3-tab dialog (AI Generate, API Template, Manual), access level, name validation, sandbox test
- [x] Tool Detail dialog: Overview (code/schema/test), Versions (history/rollback), Usage (analytics)
- [x] Learning tab: Prompt health, inline suggest improvement with diff view, full version history
- [x] Evolution page: Route + sidebar link, enriched API response with agent name/avatar, fixed type mismatches
