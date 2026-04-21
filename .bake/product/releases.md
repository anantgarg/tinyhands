# Releases

One entry per deploy to production. Each entry names the version, the date, the merges included since the previous release, and the exact rollback command. Updated automatically by the Deploy button (see `.bake/harness/deploy.md` for the post-deploy step that appends here).

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
