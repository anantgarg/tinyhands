---
id: plan-015
title: Bring-your-own Google OAuth app (per-workspace OAuth credentials)
status: draft
created: 2026-04-20
---

## Summary

Move Google OAuth client credentials from a single platform-owned OAuth app (`GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` env vars) to a per-workspace model, where each workspace admin creates their own Google Cloud project, configures their own OAuth client, and pastes the credentials into the TinyHands dashboard. The platform becomes transport only — it never holds a Google OAuth identity of its own.

## Why

Google's CASA audit requirement applies to whoever owns the OAuth client requesting restricted scopes (full Drive, full Gmail). If TinyHands owns the client, we pay $3k–15k/year for an audit, cap ourselves at 100 test users until approved, and carry an ongoing data-processor relationship with Google for every tenant's user data.

If each customer owns their own OAuth client:
- They publish it **Internal** (Workspace-scoped) and skip Google verification entirely — no audit, no user cap, any scope including restricted ones.
- Their end-user consent screen names their own app, not ours — cleaner trust story for their users.
- We never hold a Google data-processor role; token flow stays between the customer's Google project and their workspace.
- We can keep feature parity (full Drive read, full Gmail access) without buying an audit.

Cost we accept: ~20–40 minutes of onboarding for a workspace admin the first time they connect Google. This matches the existing "bring your own Anthropic key" pattern already implemented in `src/modules/anthropic/`, so the ergonomic cost is already priced into the platform.

## Approach

### Scope of this plan

- Google only. Notion and GitHub aren't configured in production (`NOTION_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_ID` both unset), so defer those to a follow-up. The schema and resolver code in this plan must be provider-agnostic though, so adding them later is a small change.
- BYO-only. No platform-owned fallback app. Workspaces that haven't configured a Google OAuth app see a setup prompt before any Google-related action.
- Workspace 1 gets migrated from the env-var globals on first boot after this ships (same pattern as `src/modules/multitenant-migration/`).

### Credential storage

New table `workspace_oauth_apps`:

```sql
CREATE TABLE workspace_oauth_apps (
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,            -- 'google', future: 'notion', 'github'
  client_id TEXT NOT NULL,           -- not secret on its own, stored plaintext for debuggability
  client_secret_encrypted TEXT NOT NULL, -- AES-GCM via utils/encryption (same as connections)
  publishing_status TEXT,            -- 'internal' | 'external_testing' | 'external_production' | null
  configured_by_user_id TEXT,
  configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, provider)
);
```

Encryption reuses the same `ENCRYPTION_KEY` and helper that `src/modules/connections/` uses for user tokens — don't invent a new crypto pathway.

### Credential resolution

`src/modules/connections/oauth.ts:66-110` (`getOAuthUrl`) and `:112-171` (`handleOAuthCallback`) currently read `integration.clientId()` / `clientSecret()` which hit `config.oauth.*` globals. Both become async workspace lookups: given `wsId` + provider, fetch from `workspace_oauth_apps`; if missing, throw a typed error (`OAuthAppNotConfiguredError`) that upstream callers surface as a "set up your Google OAuth app" prompt rather than a generic failure.

The redirect URI stays static (`https://app.tinyhands.ai/auth/callback/google`) — every customer registers that same string in their own Google OAuth client.

### Pre-flight gate

Every entry point that eventually calls `getOAuthUrl('google*', ...)` must first check `hasOAuthAppConfigured(workspaceId, 'google')`. Entry points today:
- Dashboard: `src/api/routes/connections.ts:357-369` (`/connections/oauth/:integration/start`)
- Slack command buttons: `src/slack/commands.ts:1236-1237`

Both branch: configured → proceed; not configured → return a deep link to the "Configure Google OAuth app" dashboard page.

### Dashboard UX

New settings page under the existing Settings area: **Settings → Integrations → Google OAuth app**. Two states:

1. **Not configured**: displays a wizard. Step-by-step accordion (1. Create project, 2. Enable APIs, 3. Set up consent screen, 4. Create OAuth client, 5. Paste credentials). Shows the exact redirect URI to register (read from `OAUTH_REDIRECT_BASE_URL` at runtime) with a copy button. Shows the exact scopes to add. Publishing-mode guidance (recommend Internal for Google Workspace customers).
2. **Configured**: shows masked client ID, "Replace credentials" and "Test connection" buttons. Test button does a minimal auth-URL generation + HEAD request against `accounts.google.com` to surface misconfig (invalid client ID, redirect URI not registered) without requiring a full user consent round-trip.

Per CLAUDE.md Dashboard UI Guidelines: no "OAuth", "client ID", "redirect URI" jargon in headers or primary copy — use "Google connection app" and "paste-in key" language. Technical strings (client ID, redirect URI) can appear in input labels since they have to match what's in Google Cloud Console. Model: similar to the existing Anthropic key setup page.

### Migration for workspace 1

Add an idempotent startup step in `src/modules/multitenant-migration/`: if `GOOGLE_OAUTH_CLIENT_ID` env var is present AND workspace 1 has no row in `workspace_oauth_apps` for `google`, insert one using those env values, log it, and continue. After the first successful run, the env vars become bootstrap-only (document in CLAUDE.md and ADMIN_GUIDE.md).

### Code cleanup after migration lands

Remove `config.oauth.googleClientId` and `config.oauth.googleClientSecret` reads from `src/modules/connections/oauth.ts:30-31`. Leave `redirectBaseUrl` and the (currently unused) Notion/GitHub fields in `src/config.ts` — redirect base stays global, and Notion/GitHub haven't been cut over yet.

## Instructions for Claude Code

Assume implementation inside a worktree (`isolation: "worktree"`). Target one PR, one release (minor bump — new feature).

### Step 1 — DB migration

Create `src/db/migrations/023_workspace_oauth_apps.sql` with the schema above. Run against local dev to verify.

### Step 2 — Credential store module

New file `src/modules/workspace-oauth-apps/index.ts`:

- `getOAuthAppCredentials(workspaceId, provider): Promise<{ clientId, clientSecret } | null>` — returns decrypted creds or null.
- `setOAuthAppCredentials(workspaceId, provider, { clientId, clientSecret, publishingStatus, userId })` — encrypts secret, upserts row.
- `hasOAuthAppConfigured(workspaceId, provider): Promise<boolean>`.
- `clearOAuthAppCredentials(workspaceId, provider)` — for "reset" button.
- `testOAuthAppCredentials(workspaceId, provider)` — builds an auth URL, HEAD-fetches it, returns `{ ok, errorCode }`.

Use the same encryption helper as `src/modules/connections/`. Add the types to `src/types/index.ts`.

### Step 3 — Wire resolver into OAuth module

Edit `src/modules/connections/oauth.ts`:
- Remove `clientId` / `clientSecret` functions from the per-integration config objects (lines 30-31, 46-47, 54-55).
- In `getOAuthUrl` (line 66), before building the URL, call `getOAuthAppCredentials(wsId, 'google' | 'notion' | 'github')`. If null, throw `OAuthAppNotConfiguredError` (new typed error class exported from the module). All Google variants map to `'google'` as the resolver key.
- In `handleOAuthCallback` (line 112), after DB state lookup, resolve the same way for the token exchange step.
- `getSupportedOAuthIntegrations()` (line 59) becomes `getSupportedOAuthIntegrations(workspaceId)` — async, filters by which providers have creds configured for that workspace.

### Step 4 — Pre-flight gate on entry points

- `src/api/routes/connections.ts:357-369` — before calling `getOAuthUrl`, check `hasOAuthAppConfigured`; if false, return `409` with `{ needsSetup: true, setupUrl: '/settings/integrations/google' }` so the dashboard can redirect.
- `src/slack/commands.ts:1236-1237` — if not configured, DM the admin a link to the dashboard setup page instead of the OAuth URL.

### Step 5 — Dashboard API routes

In `src/api/routes/connections.ts`, add:
- `GET /workspace-oauth-apps/:provider` — returns `{ configured: bool, clientIdMasked, publishingStatus, configuredAt }`. Never return the secret.
- `PUT /workspace-oauth-apps/:provider` — body `{ clientId, clientSecret, publishingStatus? }`. Admin-only.
- `DELETE /workspace-oauth-apps/:provider` — admin-only.
- `POST /workspace-oauth-apps/:provider/test` — runs `testOAuthAppCredentials`, returns result.

All gated by existing admin-role middleware (see how `/settings/anthropic-key` routes are protected — same pattern).

### Step 6 — Dashboard UI

New page under `web/src/pages/settings/integrations/google-oauth-app.tsx` (match existing web dir conventions). Match the visual language of the existing Anthropic-key settings page. Components needed:

- Setup wizard (5 accordion steps).
- Client ID + secret input form with validation (client ID format: `NNN-xxxxxx.apps.googleusercontent.com`; secret format: starts with `GOCSPX-`).
- Copy-to-clipboard for the redirect URI string (pulled from server-side config, not hardcoded in the frontend).
- "Test connection" button wired to `POST /workspace-oauth-apps/google/test`.
- "Replace credentials" and "Remove" buttons in the configured state.
- Status badge: Internal / External Testing / External Production, with an inline explainer.

Link this page from Settings → Integrations sidebar. Add a banner on the Connections page when the workspace has Google tools enabled but no OAuth app configured, pointing to the setup page.

### Step 7 — Startup migration

In `src/modules/multitenant-migration/`, add a migration step:

```
if (GOOGLE_OAUTH_CLIENT_ID is set) and (no row in workspace_oauth_apps for workspace 1, provider=google):
  insert row with those env values, publishingStatus=null, configured_by_user_id=null, log it
```

Idempotent — runs at every boot, only acts when needed.

### Step 8 — Docs

- `ADMIN_GUIDE.md`: add **"Setting up your Google OAuth app"** section. Full step-by-step (GCP project creation, enabling Drive/Sheets/Docs/Gmail APIs, consent screen config, publishing mode guidance with strong recommendation to use Internal for Workspace customers, OAuth client creation, redirect URI registration, pasting creds into TinyHands). Include screenshots placeholder.
- `PRODUCT_GUIDE.md`: update the "Google integration" section to mention BYO model and its benefits.
- `CLAUDE.md`: add a short note under Multi-Tenancy → Workspace-owned saying Google OAuth credentials are per-workspace (like the Anthropic key), and that `GOOGLE_OAUTH_CLIENT_ID` env var is bootstrap-only.
- `FEATURES.md`: add entry describing the per-workspace OAuth app feature.

### Step 9 — Tests

- Unit: `tests/unit/workspace-oauth-apps.test.ts` — CRUD, encryption round-trip, `hasOAuthAppConfigured` branching.
- Unit: extend `tests/unit/connections-oauth.test.ts` — `getOAuthUrl` throws `OAuthAppNotConfiguredError` when no creds; uses workspace creds when present.
- Unit: `tests/unit/multitenant-migration.test.ts` — bootstrap migration happy path + idempotence.
- Integration: `tests/integration/oauth-byo.test.ts` — end-to-end: configure creds via API → initiate OAuth URL generation → verify correct client_id lands in the URL for that workspace, and a different workspace's creds are isolated.
- UI: manual smoke on the dashboard page (not automated — consistent with existing test strategy).

Target 100% code coverage on new files per CLAUDE.md rule.

### Step 10 — Release

Minor version bump (`v1.50.0` per current versioning — check `gh release list --limit 1` to confirm). Changelog entry emphasising the CASA-avoidance benefit and what workspace admins need to do (one-time setup). Migration note at top: existing workspace 1 is auto-migrated from env vars; no manual action needed for that one workspace.

### Do not touch

- `OAUTH_REDIRECT_BASE_URL` — still global, still correct.
- Slack OAuth (`src/api/routes/auth.ts`) — that's platform-level identity, not a customer integration, stays on platform creds.
- Notion / GitHub OAuth — deferred to a follow-up plan. Design supports them but don't implement.
- `src/utils/oauth-state.ts` — unrelated hardening, separate plan.
- Existing `oauth_states` table and callback DB-state flow — working as designed.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]`. If a criterion can't be satisfied as written, leave it unchecked and add a one-line note explaining why.

## Test Plan

- [ ] Fresh workspace (no OAuth app configured): clicking "Connect Google Drive" shows the setup prompt, not the OAuth consent screen.
- [ ] Admin fills in the setup wizard with valid credentials → "Test connection" passes → saved → can now initiate Google OAuth flow and reach the customer's own consent screen.
- [ ] End-to-end: configure → authorize as end user → token saved in `connections` → agent run successfully calls Google Drive API with that token.
- [ ] Second workspace configured with a different OAuth app: its OAuth URL contains its own client ID; cross-workspace creds never leak (verified by DB inspection).
- [ ] Workspace 1 post-deploy: env-var credentials auto-migrated into `workspace_oauth_apps`; existing Google connections continue to work without re-auth.
- [ ] Admin "Remove credentials" → existing Google connections stop working (token refresh fails gracefully with a "reconfigure your Google OAuth app" banner).
- [ ] Non-admin user cannot see the setup page or call the `PUT /workspace-oauth-apps` API (403).
- [ ] Invalid client ID format rejected client-side and server-side.
- [ ] Test-connection against a non-existent client ID returns a clear error, not a silent success.
- [ ] Dashboard copy passes a CLAUDE.md Dashboard UI Guidelines review (no raw IDs, jargon hidden in expert sections).

## Acceptance Criteria

- [ ] `workspace_oauth_apps` table exists with encrypted secret storage.
- [ ] `getOAuthUrl` and `handleOAuthCallback` resolve credentials per workspace, not from global env.
- [ ] Dashboard settings page lets admins set, test, replace, and remove Google OAuth app credentials.
- [ ] Both dashboard and Slack entry points gate on OAuth-app configuration and guide unconfigured workspaces to setup.
- [ ] Workspace 1 is auto-migrated from env vars on first boot after deploy.
- [ ] `ADMIN_GUIDE.md` documents the full customer setup flow end-to-end.
- [ ] `CLAUDE.md` notes that `GOOGLE_OAUTH_CLIENT_ID` is bootstrap-only and Google OAuth credentials are workspace-owned.
- [ ] Unit + integration tests cover credential store, resolver branching, and cross-workspace isolation; coverage stays at 100%.
- [ ] Released as a minor version bump with changelog calling out the BYO model and that existing workspace 1 is auto-migrated.

## Out of Scope

- Notion and GitHub OAuth credentials (same pattern applies — separate plan when those flows ship).
- Slack OAuth — stays platform-owned; it's identity, not integration.
- Automatic Google Cloud project / OAuth client provisioning on behalf of customers (would require a Google Workspace reseller or similar, way out of scope).
- Shared / pooled OAuth apps across workspaces (defeats the purpose of BYO).
- Migrating existing user Google tokens to new OAuth clients after a workspace replaces its OAuth app — treated as a reconnect.
- Adopting the signed-state helper in `src/utils/oauth-state.ts`.
- Fixing missing CSRF `state` validation on Slack sign-in.
