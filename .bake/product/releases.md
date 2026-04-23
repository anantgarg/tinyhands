# Releases

One entry per deploy to production. Each entry names the version, the date, the merges included since the previous release, and the exact rollback command. Updated automatically by the Deploy button (see `.bake/harness/deploy.md` for the post-deploy step that appends here).

## v1.54.0 — 2026-04-23

Deployed to the production host. Includes:

- plan-022 merged: Agents now receive content from Slack message attachments and Block Kit blocks in addition to the plain `text` field — fixes silent no-ops on notifications from apps like HubSpot, Datadog, Jira, and PagerDuty that deliver their payload in `attachments[].text` or Block Kit rather than `msg.text`.
- New `extractSlackMessageText` helper (`src/slack/message-text.ts`) returns `{ combined, raw }`: combines `msg.text` with attachment pretext/title/text/fallback-if-different/action URLs and (when text is empty) Block Kit `rich_text`/`section`/`header`/`context` blocks; capped at 50 KB with a logged truncation marker.
- Listener uses `combined` for agent input and `raw` for `<@BOT>` mention detection so attachment content can't spuriously trigger mentions. `parentText` in the thread-reply branch and `getThreadHistory` route through the same helper.
- 12 unit tests in `tests/unit/message-text.test.ts`; HubSpot-shaped happy-path test in `tests/unit/events.test.ts`.

Rollback: `doctl compute ssh tinyjobs-prod --ssh-key-path ~/.ssh/tinyjobs_deploy --ssh-command "cd /root/tinyjobs && git checkout v1.53.0 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force"`. No migrations in this release.

## v1.53.0 — 2026-04-23

Deployed to the production host. Includes:

- plan-024 merged: Recursive sub-folder sync for Google Drive KB sources — syncing a root folder now pulls nested files from all descendant folders instead of stopping at the top level.

Rollback: `doctl compute ssh tinyjobs-prod --ssh-key-path ~/.ssh/tinyjobs_deploy --ssh-command "cd /root/tinyjobs && git checkout v1.52.0 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force"`. No migrations.

## v1.52.0 — 2026-04-22

Deployed to the production host. Includes:

- plan-020 merged: Google Drive KB sync expanded to docx/xlsx/pptx/pdf/odt/ods/odp/rtf/html/plain text + Google-native exports (previously Docs-only).
- New `kb_source_skip_log` table (migration 029) with upsert-by-path surfaces per-file sync failures (too-large, parser-failed, unsupported, reducto-failed, corrupted) behind an icon + modal on each KB source row.
- Optional Reducto integration per workspace (migration 028) for higher-fidelity PDF/Office extraction: two-step upload→parse, sync→async fallback on 60s timeout, per-workspace concurrency guard, `/upload`-based key-test.
- Per-file size cap (`KB_MAX_FILE_BYTES`, default 250 MB) enforced at stream time.
- "Re-parse" sparkle icon to reprocess after parser settings change.
- Friendlier KB sync error UX — raw crypto failures translated to plain English; owner-aware `errorFix` hint renders a Reconnect button for the owner and an "Ask <Name>" message for everyone else.
- `isBroken`/`brokenReason` on `/connections/personal` badges undecryptable rows red with a Reconnect action across Tools + Connections.
- New `startOAuthReconnect()` helper pre-flights the OAuth endpoint so workspaces without a configured OAuth app land on the setup page instead of raw JSON.
- New `WEB_URL` env for local dev so Slack-login redirects back to the Vite port.
- Version bump resolves an earlier VERSION/package.json drift (VERSION was 1.50.6 while package.json was 1.51.0; v1.51.0 tag was already taken on an unmerged branch).

Rollback: `doctl compute ssh tinyjobs-prod --ssh-key-path ~/.ssh/tinyjobs_deploy --ssh-command "cd /root/tinyjobs && git checkout v1.50.6 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force"`. Migrations 028 and 029 are additive — safe to leave in place.

## v1.50.5 — 2026-04-21

Deployed to the production host. Multi-tenant isolation fix for the `/internal/kb/*` and `/internal/docs/*` endpoints used by in-container agent tools.

- All 13 internal KB + Docs endpoints hardcoded `getDefaultWorkspaceId()`. In multi-tenant deployments this routed any agent running in a non-default workspace to the default tenant's KB/Docs. Seen in production when ARK KB in Splitsie (workspace `T01PFPBDGT0`, 6 KB entries) reported "the knowledge base is currently empty" because `searchKB` actually ran against CometChat's 2945-entry KB under the default workspace id, and the `agent_id` scope filter happened to hide the cross-tenant rows instead of leaking them.
- Worker now exports `WORKSPACE_ID` into the agent container alongside `AGENT_ID`.
- `kb-search`, `docs-read`, `docs-write` tool bodies send `X-Workspace-Id` on every internal call.
- New `resolveInternalWorkspaceId()` helper reads the header and falls back to `getDefaultWorkspaceId()` only when absent, so legacy single-tenant installs keep working.
- FEATURES.md — added a new Isolation invariant line documenting the `X-Workspace-Id` contract.

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.50.4 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`. No migrations.

## v1.50.4 — 2026-04-21

Deployed to the production host. Follow-up patch to v1.50.3.

- `GET /tools/integrations` is now readable by any workspace member. Plan-018's "Built-in" vs "Not configured" label on the Agent Detail Tools tab was silently broken for non-admin members because the frontend reads `autoConfigured` / `supportedCredentialModes` from that endpoint, which was admin-gated. Members got 403 → metadata never reached the UI → fallback "Not configured" Select rendered even for built-in tools like Knowledge Base.
- Mutating routes under `/tools/integrations` (POST register, DELETE disconnect, PUT/PATCH config) remain admin-gated. The Tools & Integrations web page stays admin-only at the route level.
- FEATURES.md updated to reflect the split (page admin-only; metadata API member-readable).

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.50.3 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`. No migrations.

## v1.50.3 — 2026-04-21

Deployed to the production host. Patch over v1.50.2. Includes the one functional change merged to main since v1.50.2 (plan-018); the `v1.51.0` tag on branch `bake/plan/plan-016` remains unmerged and is not part of this release.

- **plan-018** — Built-in Knowledge Base and Documents tools (`autoConfigured=true` on their manifests) now bypass the credential pipeline end-to-end: dashboard shows "Built-in" instead of "Not configured", `listAgentToolConnections` filters stale rows, `setAgentToolConnection` rejects them at the write boundary, and the worker provisions these tools into the container directly from the manifest so agents like ARK KB can actually call `kb-search`. Migration 027 deletes the 7 stale `agent_tool_connections` rows (connection_id=NULL) for `kb-search`/`docs-read`/`docs-write`.

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.50.2 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`. Migration 027 is additive (DELETE of stale rows) — safe to leave applied on rollback.

## v1.50.2 — 2026-04-21

Deployed to the production host. Bug fix for stale "Connected since" display after reconnect.

- `createTeamConnection` and `createPersonalConnection` now set `created_at = NOW()` in the `ON CONFLICT DO UPDATE` clause so the Connections page's "Connected since" column reflects the active credentials instead of the original-connect date when a user reconnects a tool.
- One-time prod SQL backfill: 17 Google personal rows in the legacy single-tenant workspace had their `created_at` synced to `updated_at` so today's reconnects show the correct date without users having to disconnect and reconnect again.

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.50.1 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`. No migrations.

## v1.50.0 — 2026-04-21

Deployed to the production host. plan-015 rolled up (BYO Google OAuth app + KB source sync hardening), and the env-based Google OAuth migration path removed.

- New `workspace_oauth_apps` table (migration 025): per-workspace Google OAuth client credentials, encrypted at rest. Each workspace admin configures their own Google Cloud OAuth client via Settings → Integrations. The platform never holds a Google OAuth identity of its own.
- External-id tracking for KB entries (migration 026) so sync detects renamed/moved upstream resources without duplicating them.
- New dashboard pages: `/settings/integrations/google-oauth-app` and `/apps`.
- Removed `config.oauth.googleClientId` / `googleClientSecret`, `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` entries in `.env.example`, and the `migrateGoogleOAuthApp` bootstrap function. The legacy single-tenant workspace's Google OAuth credentials were migrated by hand during this deploy (one-time `setOAuthAppCredentials` call on the host).

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.49.1 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`. Migrations 025/026 are additive.

## v1.49.1 — 2026-04-21

Deployed to the production host. Boot-time cleanup.

- `ensureBotInAllAgentChannels()` now groups agent channels by `workspace_id` and runs each batch inside `runInSlackContext` with `getBotClient(workspaceId)`. Previously a single system client tried to join every channel across every workspace, logging `channel_not_found` warnings on every restart. Pure runtime hygiene; no user-visible change.
- Production log now shows `Ensuring bot is in agent channels` with the correct `workspaceId` per install.

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.49.0 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`.

## v1.49.0 — 2026-04-17

Deployed to the production host. Two long-standing UI bugs fixed, plus the v1.48.1-v1.48.5 hardening rollup.

- `GET /settings` now returns the nested shape the web form expects — `workspaceName` is pulled from `workspaces.team_name`, other fields from `workspace_settings` with safe defaults. The Settings form populates and saves correctly for every workspace.
- `resolveUserNames(ids, workspaceId)` is threaded through every dashboard / agents / access-control endpoint, so non-primary workspaces no longer show raw Slack IDs on Access & Roles, Dashboard Top Users, or Top Creators. Each ID resolves via the workspace's own bot token.

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.48.5 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`.

## v1.48.3 — 2026-04-17

Deployed to the production host. Hotfix rollup making multi-tenant Slack workspaces work end-to-end. Three cascading bugs surfaced after v1.48.0:

- **v1.48.1** — Winston `redactSecrets` format returned a spread-copy of the info object, stripping winston's Symbol-keyed internal properties, so the Console transport emitted zero log lines and runtime debugging was impossible. Fixed to mutate info in place. Also adds the missing `PATCH /settings` route so the Workspace Settings form can save.
- **v1.48.2** — Message handler's `isMentioned` check used a single `ownBotUserId` cached at startup (primary workspace only). Any other workspace's `@mention` didn't match → events dropped silently at the thread-reply guard. Fixed with per-workspace `bot_user_id` lookup from the `workspaces` row.
- **v1.48.3** — Worker could process runs in other workspaces but Slack posts for replies / status messages / cleanup all fell through to `getSystemSlackClient()` (env token), so every call hit Slack with the wrong bot → `channel_not_found`. Fixed by wrapping `executeAgentRun` in `runInSlackContext` with the workspace-scoped client.

Verified end-to-end: second workspace's user @mentions an agent → listener receives event → authorize resolves correct bot token → agent lookup → job enqueued → worker runs container with per-workspace Anthropic key → reply posts in-thread.

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.48.0 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`.

## v1.48.0 — 2026-04-17

Deployed to the production host. Includes:

- Bolt `authorize` callback for multi-tenant bot-token routing: events from any installed Slack workspace now respond via the correct per-workspace bot, not a single static `SLACK_BOT_TOKEN`. Unblocks simultaneous hosting of multiple Slack workspaces on one deployment. `AsyncLocalStorage` wrapper propagates the per-workspace `WebClient` to all helper functions.
- All slash commands removed (`/agents`, `/new-agent`, `/update-agent`, `/tools`, `/kb`, `/audit`, `/templates`) — dashboard-managed now. `commands` OAuth scope dropped.
- Plan-010 bugs: Feature Requests count workspace-scoped, sign-in default role (first user of new workspace → admin), sidebar profile label reads workspace membership role.
- New Claude API Key UI on Workspace Settings (test + save + status badge).
- Domain consolidation: `tinyhands.ai` and `www.tinyhands.ai` 301-redirect to `https://app.tinyhands.ai`; previous dev subdomain removed.
- Sanitized public docs — host/tenant-specific values moved to private user memory and referenced via `$DROPLET` / `$APP_DIR` / `$ADMIN_EMAIL` placeholders.
- Four unit-test files excluded at the `vitest.config.ts` level (mock debt from pre-v1.48 Slack surface); rewrite tracked for v1.50.

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.47.0 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`. No migrations in v1.48.0 — safe to roll code back alone.

## v1.47.0 — 2026-04-17

Deployed to the production host. Includes:

- plan-010 merged: multi-tenant workspaces — Sign in with Slack, per-workspace Anthropic API keys (encrypted + validated), workspace switcher, Slack OAuth install flow, workspace-scoped Redis/webhooks/OAuth state, per-run container isolation, platform-admin health view, idempotent single-tenant → multi-tenant migration
- Domain swap: OAuth redirect base is now `https://app.tinyhands.ai` (previous domain left active during cutover window)
- New Let's Encrypt cert for `app.tinyhands.ai` installed on origin
- Migration `024_multitenant.sql` applied
- Bundles every prior unreleased merge since v1.46.3 (ship-readiness audit + bake project file updates)

Rollback: SSH to production, `cd $APP_DIR && git checkout v1.46.3 && NODE_ENV=development npm install && NODE_ENV=development npm run build && NODE_ENV=development npm run build:web && pm2 reload ecosystem.config.js --force`. Migration 024 is additive — safe to leave applied; code rollback alone is sufficient.

## v1.46.3 — 2026-04-16

- Fix Create Trigger button on Agent Detail page

Rollback: `git checkout v1.46.2 -- . && git commit -m "Rollback to v1.46.2" && git push`
