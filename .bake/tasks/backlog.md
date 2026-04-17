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

## Completed

