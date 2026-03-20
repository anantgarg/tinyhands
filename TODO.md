# TinyHands Dashboard TODO

## Urgent / In Progress
- [ ] Google Workspace: Restructure into separate tools (Drive, Sheets, Docs, Gmail) — agent running in background
- [ ] Agent Create: Settings step needs descriptions under each field explaining what they do
- [ ] Agent Create: Model should be auto-filled from goal analyzer (fixed mapping, needs deploy)
- [ ] Agent Create: Tools step should use grouped integration format (same as agent detail)
- [ ] Agent Create: Goal analyzer should auto-select relevant tools (KB search for RFP agent etc.)
- [ ] OAuth start route: Add GET /connections/oauth/:integration/start (code written, needs deploy)
- [ ] Clean up fake Google Workspace connection from production DB (again)
- [ ] Add .gitignore entries (tsconfig.tsbuildinfo, dist/) — code written, needs deploy

## Pending Features
- [ ] Version History: Track ALL changes (tools, settings, model), show diffs in preview
- [ ] Non-admin user restrictions: Hide nav items, enforce read-only on agents they don't own
- [ ] Slack DM: Make DMs work like channels with access to all agents user has access to
- [ ] Google Drive: Visual folder picker (dropdown to select folder instead of typing ID)
- [ ] KB Sources: Edit existing sources, help text on config forms

## Recently Completed (verify on next deploy)
- [x] Agent name editable by clicking (useAuthStore hook fix)
- [x] Agent creation: channel_id null error fixed
- [x] TipTap rich text editor for instructions
- [x] Audit log: Backend returns {entries, total} format
- [x] Toasts auto-dismiss after 5 seconds
- [x] Tools simplified: core tools always-on, integrations grouped with read/write toggles
- [x] Tool credentials: Team / Requesting user's / Agent creator's (no silent fallback)
- [x] Slack Home Tab simplified to dashboard button
- [x] /agents command redirects to web dashboard
- [x] Super Admin label (two words)
- [x] Sidebar nav restructured
- [x] Trigger cron description improved
- [x] Knowledge Base: Source filter, entry editing, entries count fix
