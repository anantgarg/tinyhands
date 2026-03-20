# TinyHands Dashboard TODO

## All Clear
No pending items. All requested features have been implemented.

## Completed
- [x] Slack DM: Already works — routes to accessible agents via relevance check, shows picker for ambiguous
- [x] Drive folder picker on Connections page (Set Folder / Change Folder per connection)
- [x] Slack mentions resolve to @DisplayName badges, emoji codes render as Unicode
- [x] Credential dropdown fix: API returns camelCase, mode persists correctly
- [x] Connection upsert: reset status to active on reconnect
- [x] Agent detail: 3s timeout on Slack channel name resolution
- [x] Removed redundant Agent Tool Modes tab from Connections page
- [x] Read/Write → Can view data/Can make changes (consistent language)
- [x] KB hierarchy: Sources → Documents → Content browsing
- [x] KB: Entry counts fixed, search above cards, pending tab only for manual, manual filter fixed
- [x] KB Sources: Edit existing sources, help text, Drive folder picker
- [x] Google OAuth: Fixed redirect_uri_mismatch, all 4 integrations work
- [x] Google Workspace: Split into 4 tools (Drive, Sheets, Docs, Gmail), legacy cleaned up
- [x] Tools page: Connect with Google for OAuth, Can view data/Can make changes badges
- [x] Version History: Tracks ALL config changes with snapshot preview
- [x] Agent Create: Settings descriptions, grouped tools, goal analyzer auto-select
- [x] Non-admin restrictions: Hide Create Agent, owner-only actions
- [x] Adding tools to agents: checks integration manifests (not just custom_tools DB)
- [x] Auto-synced entries note moved above buttons in KB entry dialog
