# TinyHands Dashboard TODO

## Pending Features
- [ ] Slack DM: Make DMs work like channels with access to all agents user has access to
- [x] Google Drive: Visual folder picker (browse + select, with breadcrumb navigation)

## Recently Completed (verify on next deploy)
- [x] Version History: Tracks ALL changes (tools, model, effort, memory, access, write policy), shows config snapshot in preview
- [x] KB Sources: Edit existing sources, help text on all config forms
- [x] Google Workspace: Restructured into 4 separate tools (Drive, Sheets, Docs, Gmail)
- [x] Legacy Google cleanup: Migration 019 removes fake connection + old tools from DB
- [x] Agent Create: Settings step descriptions under each field
- [x] Agent Create: Tools step uses grouped integration format with read/write toggles
- [x] Agent Create: Goal analyzer auto-selects relevant tools (merges custom_tools)
- [x] Agent Create: Model auto-filled from goal analyzer (fixed mapping)
- [x] Non-admin restrictions: Hide Create Agent, hide actions for non-owners, admin-only pages gated
- [x] .gitignore entries (tsconfig.tsbuildinfo, dist/)
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
