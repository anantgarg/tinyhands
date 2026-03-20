# TinyHands Dashboard TODO

## Pending Features
- [ ] Slack DM: Make DMs work like channels with access to all agents user has access to

## Recently Completed
- [x] Drive folder picker on Connections page (Set Folder / Change Folder per connection)
- [x] Slack mentions (@user) resolve to display names in agent instructions
- [x] Slack emoji codes (:bell: etc.) render as actual emoji in agent instructions
- [x] Credential dropdown fix: API returns camelCase, mode persists correctly
- [x] Connection upsert: reset status to active on reconnect
- [x] Agent detail: 3s timeout on Slack channel name resolution (no more slow loads)
- [x] Removed redundant Agent Tool Modes tab from Connections page
- [x] Read/Write → Can view data/Can make changes (consistent language)
- [x] KB hierarchy: Sources → Documents → Content browsing
- [x] KB: Entry counts fixed, search above cards, pending tab only for manual
- [x] KB: Manual entries filter fixed (sourceId=manual → kb_source_id IS NULL)
- [x] Google OAuth: Fixed redirect_uri_mismatch, all 4 integrations work
- [x] Google Workspace: Split into 4 tools (Drive, Sheets, Docs, Gmail)
- [x] Version History: Tracks ALL config changes with snapshot preview
- [x] Agent Create: Settings descriptions, grouped tools, goal analyzer auto-select
- [x] Non-admin restrictions: Hide Create Agent, owner-only actions
