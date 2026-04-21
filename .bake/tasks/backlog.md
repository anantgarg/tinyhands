# Backlog

## Ideas

- [ ] First feature idea #new
- [ ] Manually verify schedule trigger creation from Agent Detail page works end-to-end (from plan-004)
- [ ] Manually verify webhook trigger creation from Agent Detail page works end-to-end (from plan-004)
- [ ] Manually verify trigger listing on Agent Detail page still loads correctly (from plan-004)
- [ ] Install the Slack app into ≥2 real Slack workspaces and verify each shows up as an independent TinyHands workspace with isolated agents, KB, and connections (from plan-010)
- [ ] Verify Sign in with Slack end-to-end in a live dashboard: session scoped to user's memberships, API routes reject non-members with 403 (from plan-010)
- [ ] Verify the workspace switcher in the dashboard UI: agents/KB/connections/documents lists change on switch and cross-workspace data never leaks (from plan-010)
- [ ] Run live container-level runner isolation test: two workspaces' agent containers run concurrently and neither can read the other's per-run secrets dir; per-run temp dir deleted on success + failure paths (from plan-010)
- [ ] Run a BullMQ queue-fairness soak test: saturate workspace A with 100 jobs, submit 1 job for workspace B, confirm B's job runs ahead of most of A's (from plan-010)
- [ ] Verify the platform-admin page in the dashboard UI: accessible to platform_admins only, 403 for everyone else, shows ≥2 workspaces with health counters (from plan-010)
- [ ] Migration dry-run against a snapshot of the production single-tenant DB: idempotent, zero data loss, ANTHROPIC_API_KEY env var ignored after migration (from plan-010)
- [ ] Full regression sweep of existing flows in the migrated workspace: slash commands, triggers, KB search, document editing, scheduled triggers, sync, daily digest (from plan-010)
- [ ] Manual QA post-deploy: admin fills BYO Google OAuth wizard with valid credentials, "Test connection" passes, save → OAuth flow reaches customer's own consent screen (from plan-015)
- [ ] Manual QA post-deploy: end-to-end authorize as end user → token saved in connections → agent run successfully calls Google Drive API with that token (from plan-015)
- [x] Manual QA post-deploy: legacy workspace's env-var credentials successfully copied into workspace_oauth_apps (v1.50.0 — verified by hand); existing Google connections still work without re-auth (from plan-015)
- [ ] "Remove credentials" banner copy explicitly prompting admins to reconfigure their Google OAuth app (existing health-check DM covers the reconnect case but doesn't name the OAuth-app-configuration step) (from plan-015)
- [x] Step 11 follow-up: Google bootstrap scaffolding removed in v1.50.0 (migrateGoogleOAuthApp deleted, config.oauth.googleClientId/Secret removed, .env.example entries stripped, legacy single-tenant workspace's credentials migrated by hand)
- [ ] Extend BYO OAuth app pattern to Notion and GitHub once those integrations ship (from plan-015)
- [ ] Wire GitHub / Zendesk / Web Crawl KB source connectors through the connections table so the wizard can un-grey them (currently "Coming soon") (from plan-015)
- [ ] Implement a Notion KB source connector (no sync handler exists today) (from plan-015)

## Completed

