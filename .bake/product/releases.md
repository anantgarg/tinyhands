# Releases

One entry per deploy to production. Each entry names the version, the date, the merges included since the previous release, and the exact rollback command. Updated automatically by the Deploy button (see `.bake/harness/deploy.md` for the post-deploy step that appends here).

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
