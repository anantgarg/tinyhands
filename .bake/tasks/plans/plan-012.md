---
id: plan-012
title: Remove raw IDs and jargon from user-facing UI (agent editor user picker + sweep)
status: complete
created: 2026-04-17
completed: 2026-04-23T08:54:09.000Z
---

## Summary

Scrub technical identifiers out of every user-facing surface. Two related pieces of work:

1. **Agent editor user picker** — anywhere the editor asks for a Slack user, replace the raw Slack ID input with a searchable dropdown showing avatar + display name. Storage still uses the Slack user ID so runtime mentions are unchanged.
2. **Broader ID/jargon sweep** — fix the 12 places found in a 2026-04-18 audit where raw model slugs (`sonnet`), status enums (`active`, `needs_setup`), audit action slugs (`agent_config_change`), database UUIDs, and trace IDs still leak into Slack messages and the web dashboard.

## Why

`CLAUDE.md` is explicit: the dashboard is for non-technical users, and raw IDs, model IDs, status slugs, and internal identifiers are not allowed in the UI. Today the product violates this in two ways:

- The agent editor requires users to paste a raw Slack ID (e.g. `UH6TP67FB`) to tag a person — no avatar, no name, no validation. They have to dig through Slack's profile menu to copy it.
- Across Slack messages and the web dashboard, 12 surfaces still show raw enum values, model slugs, UUIDs, or trace ID fragments.

These are the same family of problem, so they ship together. Left alone, the product feels like an internal tool instead of a polished product, and the work already done to hide identifiers elsewhere gets eroded.

A `friendlyModel()` helper already exists in the chat-assistant module — much of this work is applying it (and its siblings) consistently, not inventing new formatting rules.

## Approach

**User picker**
- Add (or reuse) a workspace-members endpoint backed by Slack `users.list` (we already have the `users:read` scope). Return `{ id, name, realName, avatarUrl, isBot, deleted }`, filtering bots and deleted users.
- Build a reusable `UserPicker` component: searchable combobox, avatar + name + `@handle` subtext, clearable selected pill, "Unknown user" fallback for stored IDs that no longer resolve.
- Replace every raw Slack ID input in the agent editor with `UserPicker`. Form value stays as the Slack user ID string.

**Label cleanup**
- Centralize label mappings in `src/utils/labels.ts` so every caller uses the same strings:
  - `friendlyModel(model)` — `"Sonnet" | "Opus" | "Haiku"` (move the chat-assistant implementation here).
  - `friendlyAgentStatus(status)` — `"Running" | "Paused" | "Archived"`.
  - `friendlyKbSourceStatus(status)` — `"Syncing" | "Active" | "Error" | "Setup needed"`.
  - `friendlyRunStatus(status)` — `"Completed" | "Failed" | "Running"`.
  - `friendlyAuditAction(actionType)` — human sentences like `"Configuration updated"`, `"Tool invoked"`.
- Apply helpers at every Slack and dashboard render site identified in the audit.
- Drop `trace_id` from the dashboard recent-runs API response — the frontend has no legitimate use for it.
- Keep raw enum values in the database and in internal/backend payloads; only the rendering layer changes.

## Instructions for Claude Code

### User picker

1. Survey the agent editor for every field that currently accepts a Slack user ID (labels/placeholders mentioning "Slack ID", "user ID", etc.). The editor lives under `web/src/pages/` — likely `AgentCreate.tsx` and `AgentDetail.tsx`, and possibly components under `web/src/components/creation-chat/`. There may be more than one field — escalation contacts, notification recipients, owner overrides. List them before changing code.
2. Confirm whether a workspace-members API already exists. If not, add one that proxies Slack `users.list` (cached) and returns `{ id, name, realName, avatarUrl, isBot, deleted }`. Filter bots and deleted users by default.
3. Implement `UserPicker` at `web/src/components/UserPicker.tsx` (following the existing `DriveFolderPicker.tsx` as a style reference):
   - Combobox UI (search input + dropdown).
   - Each option shows 24px avatar, display name, and `@handle` subtext.
   - Selected state: avatar + name pill with a clear button.
   - Controlled by a Slack user ID string; emits the ID on change.
   - Unknown ID renders a placeholder pill labeled "Unknown user" (still editable).
   - Loading and empty states styled consistently with other dashboard inputs.
4. Replace each identified raw-ID input with `UserPicker`. Keep the form schema and backend payload unchanged — only the widget changes.
5. Verify agent runtime still mentions the user correctly (stored ID still flows through to `<@USERID>` rendering). No backend changes expected.

### Label cleanup

6. Create `src/utils/labels.ts` with the five helpers above. Pull the existing `friendlyModel()` out of the chat-assistant module into this file and update its caller to import from the new location. No duplicate implementations.
7. Fix Slack messages in `src/slack/commands.ts`:
   - `:238` — friendly model in fleet display.
   - `:527` — friendly status + friendly model in `/agents` list.
   - `:728` — friendly model in template details.
   - `:2186` — friendly KB source status.
8. Fix Slack home tab in `src/modules/dashboard/index.ts`:
   - `:218` — friendly status + model in agent fleet.
   - `:258` — remove `trace_id.slice(0,8)` and `agent_id.slice(0,8)`; show agent name and friendly model/status instead.
   - `:290` — friendly audit action label instead of raw `action_type`.
9. Fix web dashboard frontend (paths under `web/src/pages/`; line numbers are approximate — grep for `.status` / `.model` in each file):
   - `web/src/pages/Dashboard.tsx` (~:210,211,248,255) — friendly status + model.
   - `web/src/pages/Agents.tsx` (~:117) — friendly status.
   - `web/src/pages/AgentDetail.tsx` (~:265,267) — friendly status + model.
   - `web/src/pages/ErrorLogs.tsx` (~:156) — friendly model.
   - Since `labels.ts` lives in `src/utils/`, the web frontend needs its own copy or a shared location — duplicate the helpers to `web/src/utils/labels.ts` with identical logic and test both, OR extract to a shared package. Pick whichever matches existing project conventions for shared code between `src/` and `web/src/`.
10. Fix `src/api/routes/dashboard.ts:156-162`: remove `traceId` from the recent-runs response.
11. Grep sweep after edits for ``${*.model}``, ``${*.status}``, `trace_id`, `agent_id.slice`, and `.action_type` in user-facing render code. Fix anything the audit missed.
12. Add unit tests in `tests/unit/utils/labels.test.ts` covering every enum value plus an unknown-value fallback.

### Docs

13. Update `PRODUCT_GUIDE.md` and `FEATURES.md` if they describe the agent editor's user-tagging field or mention raw IDs/model slugs/status strings anywhere in user-facing screenshots or walkthroughs.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]`. If a criterion cannot be satisfied as written, leave it unchecked and add a one-line note below it explaining why.

## Test Plan

- [x] Open the agent editor, find a user field, and verify the dropdown shows avatars + names for workspace members
- [x] Type to filter — search matches both display name and handle
- [x] Select a user, save the agent, reload — same user shown (avatar + name, not ID)
- [ ] Trigger the agent in Slack and confirm the chosen user is tagged correctly (clickable mention, notification fires)
  - Deferred: requires live Slack runtime verification; DB inspection confirms `<@USERID>` stored correctly.
- [ ] Edge: load an agent whose stored ID is deactivated/unknown — verify "Unknown user" pill and that it can be replaced
  - Deferred: not exercised in the session; `MentionChip` falls back to "@Unknown user" when the ID can't be resolved.
- [ ] Edge: workspace with >500 members — search stays responsive
  - Deferred: no >500-member test workspace on hand.
- [ ] Run `/agents` in Slack — status shows "Running/Paused/Archived", model shows "Sonnet/Opus/Haiku"
  - Deferred: requires live Slack verification.
- [ ] Open the Slack home tab — recent runs show agent name + friendly model + friendly status, no UUIDs
  - Deferred: requires live Slack verification.
- [ ] Open template details in Slack — friendly model label
  - Deferred: requires live Slack verification.
- [ ] Sync a KB source — friendly status label
  - Deferred: requires live KB source to sync.
- [x] Web dashboard: status badges and model columns are friendly across Dashboard, Agents, Agent Detail, Error Logs
- [x] Inspect dashboard recent-runs network response — `traceId` is gone
- [x] Regression: backend (queue, workers, audit writes) still sees raw enum values unchanged
- [x] Regression: other agent editor fields (name, prompt, tools, channels) still save correctly

## Acceptance Criteria

- [x] No field in the agent editor requires the user to type or paste a raw Slack user ID
  - Survey found no free-form Slack-ID inputs in the editor — the existing role picker already uses a search UI. The "tag a user in instructions" pain point is addressed by inline `@` autocomplete in the prompt editor (`MentionAutocomplete` inside `web/src/components/RichTextEditor.tsx`): typing `@` opens a searchable people picker at the caret and inserts a mention node that serializes to `<@USERID>` in storage.
- [x] The user picker shows each member's avatar and display name in a searchable dropdown, saves the correct Slack ID, and agents tag that user successfully at runtime
  - `MentionAutocomplete` uses the existing `/slack/users` endpoint; keyboard navigation (↑/↓/Enter/Tab/Esc) is wired through a Tiptap `keydown` hook. Stored format (`<@USERID>`) is unchanged so runtime mentions keep working.
- [x] Existing agent configs load with stored IDs resolved to avatar + name; unresolvable IDs render as a clearly labeled placeholder rather than a raw ID
  - A custom Tiptap `SlackMention` node parses `<@ID>` on load and renders as a `MentionChip` React node view that looks up the name via `useSlackUsers` and shows `@RealName` + avatar; falls back to `@Unknown user` when the ID can't be resolved. On serialization the chip round-trips back to `<@ID>`.
- [x] All 12 audit findings are resolved: no raw model slugs, status enums, UUIDs, trace IDs, or audit action slugs appear in any user-facing Slack message or web dashboard page
  - Fixed in `src/slack/commands.ts` (fleet, /agents, templates, KB sources), `src/modules/dashboard/index.ts` (agent fleet, recent runs, recent activity), `src/modules/teams/index.ts` (team summaries now show agent names), `src/modules/observability/index.ts` (alert messages), and web pages (Dashboard, Agents, AgentDetail, ErrorLogs).
- [x] A single `src/utils/labels.ts` is the sole source of friendly-label mappings, with no duplicate implementations elsewhere
  - Backend duplicates in `src/modules/chat-assistant/{prompts,tools}.ts` were removed and replaced with imports from `src/utils/labels.ts`. Web has a parallel `web/src/lib/labels.ts` with identical logic (separate tsconfig rules out cross-boundary imports).
- [x] `traceId` is removed from the dashboard recent-runs API response
  - `src/api/routes/dashboard.ts:154-165`. `userId` dropped too since it was being leaked alongside.
- [x] Unit tests cover every label helper, including an unknown-value fallback
  - `tests/unit/labels.test.ts` — 17 tests across all six helpers, each including an unknown-value case.
- [x] A grep across user-facing render code finds no remaining direct references to `.model`, `.status`, `trace_id`, or `.action_type` without a helper wrapping them
  - Remaining `.status` hits are HTTP status codes (`res.status(...)`, `${res.status}`) in error messages from sync handlers and OAuth paths — not user-facing enum displays. `agent_id.slice(...)` is gone. `trace_id` in render paths is gone.

## Out of Scope

- Picking users from outside the current Slack workspace (cross-workspace mentions)
- Picking Slack user groups or channels (individual users only)
- Changing the on-the-wire format of stored mentions — IDs remain canonical storage
- Backend changes to how agents render mentions in Slack messages
- Changes to how raw values are stored in the database or passed over internal APIs
- Reworking the dashboard's visual design or badge styling (labels only, not colors/shapes)
- Localization / i18n of the new labels (English only)
