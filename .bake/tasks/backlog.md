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
- [ ] Cut a GitHub release (`gh release create v1.51.0`) with changelog entry for plan-020 (from plan-020)
- [ ] Trigger an agent in Slack and confirm the chosen user is tagged correctly (clickable mention, notification fires) (from plan-012)
- [ ] Edge: load an agent whose stored Slack ID is deactivated/unknown — verify "@Unknown user" chip renders and the chip can be replaced (from plan-012)
- [ ] Edge: workspace with >500 members — verify the `@`-mention picker stays responsive (from plan-012)
- [ ] Run `/agents` in Slack — verify status shows "Running/Paused/Archived" and model shows "Sonnet/Opus/Haiku" (from plan-012)
- [ ] Open the Slack home tab — verify recent runs show friendly agent name + model + status, no UUIDs (from plan-012)
- [ ] Open template details in Slack — verify friendly model label (from plan-012)
- [ ] Sync a KB source — verify friendly status label (from plan-012)
- [ ] Tag + deploy a patch release with the attachments/Block Kit ingestion fix (`gh release create` once version is bumped) and smoke-test with a synthetic HubSpot-shaped payload: verify `run_history.input` contains the attachment email and the agent replies in-thread (from plan-022)
- [ ] Post-deploy regression: `@mention` in a plain-text channel message still routes, DMs still work, existing working channels (`C02VCPSB4TC`, `C0746R57W86`) produce equivalent output — no degradation from the added attachment text (from plan-022)
- [ ] Post-deploy spot-check: one non-HubSpot agent per active workspace, watch next few runs for any behavior change (from plan-022)
- [ ] Generic (non-workspace-specific) follow-up reply to Vijit once the release is live (from plan-022)
- [ ] Manually verify Reducto-disabled path: in a workspace with Reducto turned off, drop a JPG/PNG into a synced Drive folder, run sync, confirm the file is listed in the source's skip-log modal with reason "Image OCR requires Reducto" and an actionable message (from plan-025)
- [ ] Edge case: a 25 MB+ camera-original JPG should be skipped with reason `too_large`, never attempted via Reducto (from plan-025)
- [ ] Edge case: a corrupt or zero-byte PNG should produce a `reducto_failed` (or `parser_failed`) skip without crashing the sync run (from plan-025)
- [ ] Edge case: confirm `.gif`, `.webp`, `.svg`, `.tiff`, and `.heic` files each still land in the skip log with reason `unsupported_format` (not OCR'd) (from plan-025)

## Completed

