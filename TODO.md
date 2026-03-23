# TinyHands Dashboard TODO

## Unimplemented Dashboard Features

Features that exist in the backend but have no dashboard UI yet.

### 1. Multi-Step Workflows
The Workflows page is a stub showing "Coming Soon." No workflow builder, no execution, no status tracking. The backend has full workflow support but the dashboard has zero UI for it.

### 2. Multi-Agent Teams
No dashboard UI for configuring teams, spawning sub-agents, or viewing team results. The backend module exists (`src/modules/teams/`) but there's no page or UI component for it.

### 3. Skills
No Skills tab on the agent detail page. No way to attach/detach skills from the dashboard. Skills are managed only via Slack commands. The backend and API exist but the dashboard has no UI.

### 4. Custom Tool Creation
The Tools page shows/approves/deletes existing custom tools, but there's no UI to create a custom tool (define schema, write code, test). Creation happens only through agent self-authoring or Slack.

### 5. Tool Authoring / Self-Authoring
No dashboard UI for AI-powered tool generation, sandbox testing, or tool pipelines. This is backend-only functionality triggered during agent runs.

### 6. Critique-Driven Learning / Self-Improvement
No dashboard UI. Critique detection and prompt refinement happen in Slack threads only.

### 7. Evolution Proposals Navigation
The Evolution page exists and works, but it's only accessible from the Requests page tab. There's no standalone Evolution page in the sidebar navigation. The page exists at `/evolution` but isn't linked.

### 8. Document Filling
No dashboard UI. Template field extraction and KB-powered filling is backend-only, triggered during agent runs.

### 9. Per-Message Model Override
No dashboard UI. The `[run with opus]` inline directive only works in Slack messages, not from the dashboard chat.

### 10. Daily Digest
No dashboard page for viewing or configuring the daily digest. It's a Slack-only feature (posts to a channel).

### 11. Alert Configuration
The dashboard shows error rates on the Dashboard page, but there's no UI to configure alert rules, thresholds, or notification channels. Alerts are hardcoded in the backend.

### 12. Floating Chat Improvements
The floating chat widget exists but is basic. Could benefit from agent selection, conversation history, and model override support.

### 13. Notion/GitHub OAuth on Connections Page
FEATURES.md mentions OAuth for Notion and GitHub, but the Connections page only shows Google integrations with OAuth buttons. Notion and GitHub OAuth are configured in the backend but not surfaced in the dashboard's Add Connection dialog.

### 14. Folder Restrictions Enforcement
The folder picker exists on the Connections page, but the Google Drive tool code doesn't actually read the `root_folder_id` from the credentials to restrict operations. The setting is stored but not enforced at runtime.

---

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
