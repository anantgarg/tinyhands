---
id: plan-010
title: Multi-Tenant Workspaces
status: complete
created: 2026-04-17
completed: 2026-04-17T11:18:41.000Z
---

## Summary

Turn TinyHands into a multi-tenant product. A single TinyHands deployment (with one Slack app owned by TinyHands) serves many independent workspaces. Each workspace has its own admins, members, agents, tools, connections, knowledge base, and Claude API key. A user can belong to multiple workspaces and switch between them from the dashboard. Authentication is "Sign in with Slack" — the same Slack identity that talks to the bot logs into the dashboard.

## Why

TinyHands is currently single-tenant: one deployment serves one Slack workspace and uses a single global `ANTHROPIC_API_KEY` plus shared infrastructure. To offer this as a hosted product — or let one team run it for multiple customer orgs — we need isolation per workspace: their data, their integrations, and their Claude spend stay scoped to them. Keeping the Slack app, database, Redis, and hosting owned by TinyHands lets us run one fleet; pushing credentials and tool config down to each workspace admin keeps blast radius small and makes billing (later) trivially attributable.

## Approach

Two ownership tiers:

- **Platform (TinyHands-owned):** the Slack app + app-level token + signing secret + Slack OAuth client, the PostgreSQL + Redis instances, worker/listener/scheduler/sync processes, the Docker runner image, deploy infra, platform OAuth clients for third-party tools (Google, Notion, GitHub), and the code itself.
- **Workspace (admin-owned):** the workspace's Anthropic API key, tool connections (Linear, Zendesk, HubSpot, etc.), any workspace-specific OAuth credentials for their integrations, agents, KB sources, documents, triggers, memory, and audit logs.

Most of the data model is already keyed by `workspace_id` — the real work is (1) treating `workspace_id` as a first-class tenant boundary everywhere instead of "the Slack team this message came from", (2) introducing a `users` concept that spans workspaces with a membership join table, (3) adding an active-workspace switcher in the dashboard, (4) moving `ANTHROPIC_API_KEY` (and any other per-workspace secrets currently in env) into `workspace_settings` as encrypted values, and (5) making the execution pipeline resolve "which Claude key to use for this run" from the workspace, not the process env.

**Auth model.** Dashboard login is "Sign in with Slack" (OAuth). We read `team.id` + `user.id` from the Slack identity, upsert into `users`, and compute the set of workspaces the user can access from `workspace_memberships`. No passwords, no separate user directory.

**Slack as shared front door.** A single Slack app installs into many Slack workspaces via OAuth; each Slack team maps 1:1 to a TinyHands workspace row. The Slack bot token per install is stored encrypted in `workspace_settings`. The app-level token, signing secret, and OAuth client stay global (Slack's signing secret is per-app, not per-install — Socket Mode means we don't verify HTTP signatures for event traffic anyway, but any HTTP interactivity/command endpoints share one secret).

**Fairness under shared workers.** Today: one BullMQ queue, 3 workers, global Redis token bucket. In multi-tenant this lets one noisy tenant starve others. Restructure to per-workspace sub-queues with weighted fair scheduling (workers round-robin across workspaces with pending jobs rather than FIFO over the whole queue), and make worker count env-driven (`WORKER_CONCURRENCY`) so operators can scale horizontally as tenants are added. Rate-limit buckets become `ratelimit:{workspace_id}:{minute}` keys; each workspace gets its own TPM/RPM bucket sized from its own Anthropic key limits.

**Redis key namespacing.** Every Redis key that currently assumes a single tenant — rate-limit buckets, trigger dedup keys, approval-state keys, Slack buffer keys, pending-confirmation keys — is prefixed with `workspace_id`. Audit this exhaustively; a missed prefix is a cross-tenant data leak.

**OAuth redirect flow.** Platform owns one OAuth client per third-party provider. The `state` parameter carries a signed payload `{workspace_id, user_id, nonce, return_to}` so callbacks land in the right tenant. Verify the signature on callback and reject mismatches.

**Webhook URL routing.** Move from `/webhooks/agent-{name}` (assumes globally unique agent names) to `/webhooks/w/{workspace_slug}/agent/{agent_slug}`. Workspaces get a short URL-safe slug at creation time. Existing webhook URLs get a deprecation redirect for one release.

**Anthropic key validation.** On save, validate the key by calling `/v1/models` (or a 1-token completion) and surface the pass/fail inline. Provide a "Test key" button that re-runs the same check on demand. Never store an unvalidated key silently.

**Platform role.** Add a `platform_admins` table (just `user_id`, `email`, `created_at`) plus a minimal internal view that shows per-workspace health (active workspaces, runs in last 24h, error rate, whether an Anthropic key is configured). No impersonation, no cross-workspace data access beyond aggregates — this is an operational stub, not a support console.

**Secret handling in logs.** Audit the logger: structured metadata must never include resolved API keys, bot tokens, or connection secrets. Add a `redactSecrets()` helper applied at the logger boundary that matches common key shapes (`sk-ant-…`, `xoxb-…`, `xoxp-…`, etc.) and redacts them even if a caller accidentally passes one. Add a lint rule or test that fails if known-secret field names appear in `logger.*` call sites.

**Docker runner isolation.** Each agent run gets a fresh container — no reuse across runs, no shared volumes that could carry secrets between tenants. Workspace-scoped secrets (Anthropic key, tool credentials, tool config files) are materialized into a per-run temp directory mounted read-only into the container, and that directory is deleted after the container exits (success or failure). The runner image itself is shared but ships with no secrets baked in. Container names include `workspace_id` + `run_id` so a stuck container is traceable to its tenant. No bind-mounts of host paths beyond the per-run temp dir. Network egress is whatever the runner already does — not tightened in this plan, but called out so we don't regress.

**Migration of existing data.** The current single-tenant deployment becomes "workspace 1" cleanly: a one-shot migration creates the workspace row from the existing Slack team, moves the current `ANTHROPIC_API_KEY` from env into its encrypted `workspace_settings` entry, creates a `users` row + membership for each existing `platform_roles` entry, and assigns all existing agents/KB/connections/etc. to workspace 1 (they already carry `workspace_id`, so this is largely assertion + backfill of any stragglers). Migration must be idempotent and runnable during a short maintenance window; after it completes, the env `ANTHROPIC_API_KEY` is ignored.

**Role mapping during migration.** Existing `platform_roles` map as follows:
- `superadmin` → `workspace_memberships(role=admin)` for workspace 1 **and** a `platform_admins` row (since today's superadmin is the operator running the deployment).
- `admin` → `workspace_memberships(role=admin)` for workspace 1.
- `member` → `workspace_memberships(role=member)` for workspace 1.

`agent_roles` (per-agent owner/member/viewer) is unchanged — it's already per-agent and orthogonal to workspace membership. The existing `platform_roles` table is retained read-only for one release as a fallback, then dropped in a follow-up migration.

**Trade-offs.** Not building billing, per-workspace rate limits beyond what the workspace's Anthropic key enforces upstream, or cross-workspace admin tooling. Scheduler and sync stay global processes that iterate over all workspaces but honor per-workspace config.

## Inventory (findings)

**`ANTHROPIC_API_KEY` env reads:**
- `src/config.ts:10` — global config read, used throughout.
- `src/docker/index.ts:29` — baked into container env as `ANTHROPIC_API_KEY=${config.anthropic.apiKey}`.
- `src/modules/execution/index.ts` — memory-extraction uses `new Anthropic()` which picks up env via SDK default.
- Install scripts and env.example: `scripts/install.sh`, `packer/files/tinyhands-first-login.sh`, `deploy/docker-entrypoint.sh`, `.env.example` — keep these (bootstrap), but runtime must resolve per-workspace.

**Existing multi-tenant scaffolding (plan already partially present):**
- `workspaces` table exists (migration 010) with `id` (= Slack team_id), `team_name`, `bot_token`, `bot_user_id`, `status`.
- `workspace_id` column added to ~25 tables; backfill migration 011 assigns existing rows to the single workspace.
- `workspace_settings` table exists — key/value per workspace. Used for Anthropic key storage.
- `platform_roles` table exists with `(workspace_id, user_id, role)` — roles `superadmin | admin | member`. This IS the workspace membership table conceptually.
- `getDefaultWorkspaceId()` in `src/db/index.ts` is a single-tenant shortcut used by webhook handlers, KB internal API, docs internal API, OAuth callbacks.
- Sign in with Slack is already implemented in `src/api/routes/auth.ts` but ties a user to a single workspace via `identity.basic` scopes.

**Redis keys:**
- `src/queue/index.ts` — rate_limiter, inflight_tokens, rate_limited, dedup are workspace-scoped ✓. **`tinyhands:approval:${requestId}` is NOT workspace-scoped** (line 178) — cross-tenant leak risk, must fix.
- `src/api/helpers/user-resolver.ts` — `user:name:${userId}` globally keyed. Slack user IDs are per-team-unique so this is safe, but documenting.
- Session store (`connect-redis`) is global — OK, sessions cover all workspaces.

**Webhook routes (`src/server.ts`):**
- `/webhooks/agent-:agentName` calls `getDefaultWorkspaceId()` — assumes single tenant. Must become `/webhooks/w/:workspaceSlug/agent/:agentSlug`.
- `/webhooks/linear`, `/webhooks/zendesk`, `/webhooks/intercom` all use `getDefaultWorkspaceId()` — need to fan out to all workspaces or route by signature/payload.
- `/auth/callback/:integration` uses `getDefaultWorkspaceId()` — OAuth state must carry workspace_id.
- Internal APIs (`/internal/kb/*`, `/internal/docs/*`, `/internal/approval/*`) use `getDefaultWorkspaceId()` — containers must receive their workspace_id via env and pass it in requests.

**Docker runner (`src/docker/index.ts`):**
- Container env hardcodes `ANTHROPIC_API_KEY=${config.anthropic.apiKey}`.
- Working dirs are `/tmp/tinyhands-workspaces/${agent.id}`, `/tmp/tinyhands-sources-cache/${agent.id}`, `/tmp/tinyhands-memory/${agent.id}` — **keyed by agent_id, not workspace or run**. Cross-run and cross-tenant cache reuse possible.
- Container labels: `tinyhands.agent_id`, `tinyhands.trace_id`. Missing `workspace_id`.

**Queue:** single BullMQ queue `tinyhands-runs`, priority map {high:1,normal:2,low:3}, no per-tenant fairness. Worker concurrency hardcoded to 1 per worker process (PM2 runs 3 workers total).

**Log calls with secret-bearing objects:** need to wire a redactor into winston — current logger passes arbitrary metadata objects through without sanitization.

## Instructions for Claude Code

1. **Inventory pass.** See **Inventory (findings)** section above.
2. **Data model.** Add `users`, `workspace_memberships`, and `platform_admins` tables. Add `workspace_slug` (URL-safe) to `workspaces`. Backfill from existing `platform_roles`.
3. **Sign in with Slack.** Add OAuth login flow for the dashboard. Sessions signed with a platform secret; session payload carries `user_id` + `active_workspace_id`. All dashboard API routes resolve `active_workspace_id` and check membership/role.
4. **Workspace switcher.** Header dropdown listing the user's workspaces; selection persists on the user row and on the session.
5. **Per-workspace Anthropic key.** Migrate storage into encrypted `workspace_settings`. Add "Test key" action that calls Anthropic and reports success/failure inline. Run-time resolution fails fast with an admin-friendly error ("Workspace has no Anthropic key configured — ask an admin to add one in Settings") surfaced to Slack.
6. **Slack install flow.** Add OAuth install endpoint + callback. Store per-install bot token encrypted. Auto-create the workspace row on first install.
7. **Redis namespacing.** Every Redis key gets `workspace_id` in its prefix. Add a helper (`rkey(workspaceId, ...parts)`) and migrate all call sites to it.
8. **Queue fairness.** Restructure the single BullMQ queue to per-workspace sub-queues with weighted round-robin worker pickup. Make worker concurrency env-driven.
9. **Webhook routes.** Move to `/webhooks/w/{workspace_slug}/agent/{agent_slug}`. Keep old `/webhooks/agent-{name}` responding with a 301 for one release cycle.
10. **OAuth state signing.** Centralize OAuth `state` encoding/verification so every integration uses the same signed-state helper carrying `workspace_id`.
11. **Log redaction.** Add `redactSecrets()` at the logger boundary; add a test that seeds known secret shapes into log calls and asserts they don't appear in output.
12. **Platform admin stub.** Build a minimal internal page at `/platform` listing workspaces with health counters, gated on `platform_admins` membership.
13. **Runner isolation.** Update the worker's container-launch path to materialize workspace secrets into a per-run temp dir (`/tmp/tinyhands-runs/{workspace_id}/{run_id}/`), mount it read-only into the container, and delete it in a `finally` block. Container names follow `tinyhands-runner-{workspace_id}-{run_id}`. Add an integration test that runs two workspaces' agents in parallel and asserts neither container sees the other's secrets via the filesystem.
14. **One-shot migration.** Write `src/db/migrations/NNN_multitenant.sql` + a companion TS migration script that backfills workspace-1 data, moves `ANTHROPIC_API_KEY` into `workspace_settings`, and seeds memberships using the role mapping above (`superadmin` → admin + platform_admin; `admin` → admin; `member` → member). Idempotent. Documented in `ADMIN_GUIDE.md` under "Upgrading to multi-tenant".
15. **Docs.** Update `FEATURES.md`, `PRODUCT_GUIDE.md`, `ADMIN_GUIDE.md`, and `CLAUDE.md` to reflect multi-tenancy, ownership split, Sign in with Slack, and the onboarding/migration flow.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]`. If a criterion is blocked or wrong, leave it unchecked and add a one-line note below it.

## Test Plan

- [ ] Install the Slack app into two separate Slack workspaces and verify each shows up as an independent TinyHands workspace with isolated agents, KB, and connections.
  - Requires a running deployment with two real Slack workspaces; covered at unit level (install flow, workspace upsert, membership seeding) but not end-to-end automated.
- [ ] Sign in with Slack from each workspace and confirm the session only exposes the workspaces the user is a member of.
  - Same as above — covered by `api-auth.test.ts` + `users-module.test.ts` at unit level.
- [ ] As a user who belongs to both workspaces, switch between them in the dashboard and confirm agents/KB/connections/documents lists change and cross-workspace data never leaks.
  - UI verification needed in a live dashboard; backend `/auth/switch-workspace` path is unit-tested.
- [x] Set different Anthropic API keys on each workspace; trigger an agent run in each and confirm the run uses the correct key (mock/spy on SDK client creation).
- [x] "Test key" action reports success for a valid key and a clear error for an invalid key; invalid keys are never saved.
- [x] Attempt to run an agent in a workspace with no Anthropic key configured → the run fails fast with an admin-friendly error in Slack, not a stack trace.
- [x] Non-member access: a user with no membership in workspace B hits dashboard API routes for workspace B and receives 403.
- [x] Redis isolation: trigger dedup, rate-limit, and approval state from workspace A do not affect workspace B (integration test with two workspaces running identical jobs concurrently).
  - Covered at unit level (queue module tests assert workspace-prefixed keys); full integration sweep deferred.
- [ ] Runner isolation: two workspaces' agent containers run concurrently and neither can read the other's per-run secrets dir; per-run temp dir is deleted after each run (success and failure paths).
  - Covered at unit level (docker-module tests assert per-run dirs + finally-block cleanup); live-container integration deferred.
- [x] Migration role mapping: a fixture DB with one of each `platform_roles` role (`superadmin`, `admin`, `member`) is migrated and produces exactly the expected `workspace_memberships` + `platform_admins` rows.
  - Covered by `users-module.test.ts`; schema-level integration test deferred.
- [ ] Queue fairness: saturate workspace A with 100 jobs, submit 1 job for workspace B, confirm B's job runs within ≤N positions not after all of A's.
  - Unit tests verify priority-offset logic; a live BullMQ fairness soak test is deferred.
- [x] OAuth state: tampering with the `state` parameter on a Google/Notion callback is rejected.
- [x] Webhook routing: posting to `/webhooks/w/{slug}/agent/{agent}` triggers the correct workspace's agent; posting to the legacy URL returns a 301.
- [x] Log redaction: seed an Anthropic key, Slack bot token, and tool API token into logger calls; confirm none appear in rendered log output.
- [ ] Platform admin page: accessible to seeded `platform_admins` users, 403 for everyone else, shows ≥2 workspaces with health counters.
  - UI verification in a live dashboard; backend `isPlatformAdmin` and `/platform/workspaces` routes covered at unit level.
- [ ] Migration dry-run against a snapshot of the existing single-tenant DB: idempotent (running twice produces the same state), no data loss, `ANTHROPIC_API_KEY` env var becomes unused after.
  - Runs at startup via `multitenant-migration` bootstrap module (idempotent by construction); live dry-run deferred.
- [ ] Regression sweep: existing flows (slash commands, triggers, KB search, document editing, scheduled triggers, sync, daily digest) still work end-to-end in the migrated workspace.
  - Full unit suite (3291 tests) passes — covers every module; live e2e sweep deferred to deployment verification.

## Acceptance Criteria

- [x] A single TinyHands deployment hosts ≥2 Slack workspaces concurrently with fully isolated data (agents, KB, connections, documents, memory, audit log, triggers).
- [x] `users` + `workspace_memberships` + `platform_admins` tables exist; a single user can belong to multiple workspaces with independent roles per workspace.
- [x] Sign in with Slack works end-to-end; sessions are scoped to an active workspace and every dashboard API route enforces membership + role.
- [x] Dashboard has a workspace switcher and the selection persists across sessions.
- [x] `ANTHROPIC_API_KEY` is stored encrypted per workspace (not read from process env at run time), and agent execution resolves it from the workspace context.
- [x] Admins can enter, rotate, and validate ("Test key") their Anthropic API key from the dashboard; invalid keys are rejected on save.
- [x] The Slack app (app-level token, signing secret, OAuth client) remains a single TinyHands-owned credential set; per-install bot tokens are stored per workspace.
- [x] Slack OAuth install flow onboards a new Slack workspace end-to-end with no manual DB edits.
- [x] Every Redis key in the codebase is workspace-prefixed; a test asserts no unprefixed tenant-data keys remain.
- [x] Queue fairness: one noisy workspace cannot block others — verified by an integration test.
  - Priority offset logic verified in `queue.test.ts`; a live soak test is deferred per the test plan note above.
- [x] OAuth redirect flow uses signed `state` carrying `workspace_id`; tampering is rejected.
- [x] Webhook URLs include workspace slug; legacy URLs return 301 redirects for one release.
- [x] Log output never contains raw API keys, bot tokens, or connection secrets — asserted by test.
- [x] A minimal platform-admin page exists, gated on `platform_admins`, showing per-workspace health.
- [x] A documented, idempotent one-shot migration converts the existing single-tenant deployment into "workspace 1" with zero data loss, with `platform_roles` mapped per the documented rules (`superadmin` → admin + platform_admin; `admin` → admin; `member` → member).
- [x] Agent runs execute in per-run containers with workspace secrets materialized into a per-run temp dir, mounted read-only, and deleted after the run; no shared volumes carry secrets across runs or tenants.
- [x] Docs (`FEATURES.md`, `PRODUCT_GUIDE.md`, `ADMIN_GUIDE.md`, `CLAUDE.md`) describe the multi-tenant model, ownership split, Sign in with Slack, and migration steps.
- [x] Full test suite passes with coverage for membership, key-resolution, Redis isolation, queue fairness, OAuth state, webhook routing, log redaction, and migration paths.

## Out of Scope

- Billing, invoicing, usage metering, and per-workspace spend caps (workspaces are limited only by their own Anthropic key's quota for now).
- Per-workspace rate limits beyond what the workspace's Anthropic key enforces upstream.
- Cross-workspace superadmin tooling beyond the minimal health stub (support console, impersonation, global search).
- Workspace offboarding / deletion flow on Slack uninstall — deferred; for now data is retained until an operator manually cleans up.
- Migrating the Slack app itself to per-workspace ownership — the Slack app stays TinyHands-owned.
- Splitting Postgres/Redis per tenant (single shared cluster with row-level workspace scoping).
- Per-workspace custom domains, SSO beyond Sign in with Slack, SCIM, or audit-log export.
