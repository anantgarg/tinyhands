---
id: plan-030
title: Web Chat channels — share an agent as a password-protected public chat page
status: complete
created: 2026-05-21
completed: 2026-05-21T12:35:54.000Z
---

## Summary

Today the only way to talk to an agent is inside Slack. This plan adds a second way in:
a **Web Chat**. From a new **Channels** area in the dashboard, an admin creates a web chat,
picks which agent answers it, and sets a username and password on the same page. The system
then produces a shareable link. Anyone who opens that link enters the username and password
and can chat with the agent in their browser — no Slack account, no dashboard account, no
login with Slack required.

This lets a team put an agent in front of customers, contractors, or colleagues who are not
in their Slack workspace, while still keeping the chat behind a simple shared credential.

## Why

The product is currently Slack-only. Several real situations don't fit that:

- A support agent that a customer should be able to use without joining the company Slack.
- An internal agent that a contractor or another team needs, where adding them to Slack is
  overkill or not allowed.
- Demoing an agent to a prospect by sending them a link.

A web chat behind a shared username/password is the smallest thing that solves all three: no
per-user account system to build, no OAuth, just a link plus a credential the owner hands out.

## Approach

The work has four parts: data, execution path, admin UI, and the public page.

**1. Data.** A new `web_chat_channels` table holds each web chat (name, slug, the attached
agent, the visitor credential, a random public token used in the URL, an enabled flag).
Two more tables, `web_chat_sessions` and `web_chat_messages`, store conversations so a
visitor's follow-up messages keep context and so admins can audit usage.

**2. Execution path.** Agent runs are already enqueued as BullMQ jobs and executed in Docker
containers; the execution module (`src/modules/execution/index.ts`) already guards every
Slack call with `if (data.channelId)`, so a run with no Slack channel already works — its
output lands in `run_history.output`. We reuse that. A web chat message enqueues a normal
`agent-run` job with no `channelId`; the public page polls `run_history` by `traceId` for the
reply. No streaming in v1 — a simple request/poll cycle. We do **not** touch the Slack
posting code.

**3. Admin UI.** A new **Channels** sidebar entry (admin-only — per the established split,
Channels is an admin configuration page) opens a page whose first and, for now, only section
is **Web Chat**. It lists existing web chats and offers "New web chat" → a modal to set the
name, pick an agent, and set username + password. Each row shows the shareable URL with a
copy button, the credentials (revealable), an enable/disable toggle, and edit/delete.

**4. Public page.** The visitor-facing chat lives at `/chat/:token`. It is a React route that
is deliberately **outside** `RequireAuth` and the dashboard `Shell` — it must never require a
dashboard or Slack session. It shows a username/password form first; on success the server
issues a short-lived signed cookie scoped to that one token, and the chat UI appears.

Trade-offs / decisions:

- **Credential storage.** The visitor password is stored AES-GCM encrypted (same
  `ENCRYPTION_KEY` mechanism as tool connections) rather than one-way hashed, because the
  admin needs to *read it back* on the Channels page to share it. Verification decrypts and
  compares. This is intentional — see Out of Scope for what we are not doing (per-visitor
  accounts).
- **No new Slack slash command.** Everything is dashboard-driven, consistent with project
  guidance.
- **Polling, not streaming.** Keeps v1 small; SSE streaming can come later.

## Instructions for Claude Code

Do this work in a git worktree. Read `FEATURES.md` first for any chat/channel behavior that
already exists and could conflict; if something contradicts this plan, STOP and flag it.

### 1. Database migration

Create `src/db/migrations/032_web_chat_channels.sql`:

- `web_chat_channels`: `id` (uuid pk), `workspace_id` (fk workspaces), `name`, `slug`
  (unique per workspace), `agent_id` (fk agents), `auth_username`,
  `auth_password_encrypted` (text — AES-GCM ciphertext), `public_token` (text, unique,
  random — used in the URL), `enabled` (boolean default true), `created_by` (uuid, nullable),
  `created_at`, `updated_at`. Index on `public_token` and on `workspace_id`.
- `web_chat_sessions`: `id` (uuid pk), `channel_id` (fk web_chat_channels), `visitor_label`
  (nullable), `created_at`, `last_active_at`.
- `web_chat_messages`: `id` (uuid pk), `session_id` (fk web_chat_sessions), `role`
  (`'user' | 'assistant'`), `content` (text), `trace_id` (nullable — links assistant
  messages to the `run_history` row), `created_at`. Index on `session_id`.

All FKs `ON DELETE CASCADE`. Follow the style of an existing recent migration
(e.g. `031_database_column_descriptions.sql`).

### 2. Backend module `src/modules/web-chat/`

Create `src/modules/web-chat/index.ts` exporting the module's public API. Reuse the existing
AES-GCM helpers used by `src/modules/connections/` for encrypt/decrypt (find them — do not
write new crypto). Functions:

- `listWebChats(workspaceId)`, `getWebChat(id)`, `getWebChatByToken(token)`
- `createWebChat(workspaceId, { name, agentId, username, password, createdBy })` — generates
  `slug` and a random `public_token` (use the existing `uuid`/crypto-random pattern).
- `updateWebChat(id, fields)` — supports renaming, re-attaching an agent, changing
  credentials, toggling `enabled`.
- `deleteWebChat(id)`
- `verifyWebChatCredential(token, username, password)` — loads the channel, decrypts the
  stored password, constant-time compares. Returns the channel or null.
- `createSession(channelId)`, `appendMessage(sessionId, role, content, traceId?)`,
  `getSessionMessages(sessionId)`.
- `dispatchWebChatMessage(channel, sessionId, text)` — builds the run input by prefixing the
  recent session history (last N `web_chat_messages`) so the agent has context, then calls
  `enqueueRun` with `JobData` where `channelId` and `threadTs` are empty strings, `userId` is
  null, `agentId` is the attached agent, a fresh `traceId`. Persist the user message
  immediately; the assistant message is written when the poll endpoint sees the run finish.

Add a `WebChatChannel` (and session/message) interface to `src/types/index.ts`. Note
`JobData` (`src/types/index.ts:172`) is already Slack-shaped — empty `channelId`/`threadTs`
is the correct "no Slack" signal; the execution module already guards on it. Do **not** add a
new required field to `JobData`.

### 3. Server routes (`src/server.ts`)

**Admin API** (behind the existing dashboard auth used by other `/api/v1/...` routes):

- `GET    /api/v1/web-chat/channels` — list (decrypt password for display).
- `POST   /api/v1/web-chat/channels` — create.
- `PATCH  /api/v1/web-chat/channels/:id` — update.
- `DELETE /api/v1/web-chat/channels/:id` — delete.

Scope every query to the caller's active `workspaceId` from the session.

**Public API** (NO Slack/dashboard auth — model the unauthenticated style of the existing
webhook routes around `src/server.ts:69`):

- `POST /api/public/chat/:token/login` — body `{ username, password }`. Calls
  `verifyWebChatCredential`. On success set a signed, `httpOnly` cookie scoped to that token
  (reuse `src/utils/oauth-state.ts`-style signing, or `cookie-session` if already a dep) and
  return `{ ok: true }`. On failure return 401. Reject if the channel is `disabled`.
- `POST /api/public/chat/:token/message` — requires the token cookie. Body `{ sessionId?,
  text }`. Creates a session if none, calls `dispatchWebChatMessage`, returns
  `{ sessionId, traceId }`. The per-workspace rate limiter still applies — if rate-limited,
  return a friendly 429.
- `GET  /api/public/chat/:token/message/:traceId` — requires the token cookie. Looks up the
  `run_history` row by `trace_id`; while `status` is pending return `{ status: 'running' }`;
  on completion persist the assistant `web_chat_messages` row (once) and return
  `{ status: 'done', content }`; on failure return `{ status: 'error' }`.

`/chat/:token` and `/chat/*` must serve the SPA `index.html` — extend whatever static/SPA
fallback already serves the dashboard so these paths resolve to the React app.

### 4. Dashboard — Channels page

- `web/src/components/layout/Sidebar.tsx`: add a nav item `{ label: 'Channels', to:
  '/channels', icon: <pick a lucide icon, e.g. MessageSquare>, adminOnly: true }` near
  `Triggers` (line ~59).
- `web/src/App.tsx`: lazy-import and add a `<Route>` for `/channels` inside the
  authenticated `Shell`, like the other pages.
- Create `web/src/pages/Channels.tsx`. Layout: page title "Channels", a "Web Chat" section.
  Show a list of web chats; each row: name, attached agent name, the shareable URL with a
  copy-to-clipboard button, username, password (hidden behind a reveal toggle), an
  enable/disable switch, edit and delete. A "New web chat" button opens a modal/dialog
  (reuse existing `ui/` dialog components) with: name input, agent picker (use the existing
  `useAgents` hook), username input, password input. Follow the Dashboard UI Guidelines —
  no IDs, no slugs, no jargon; show the agent's display name and model name only.
- Add a `web/src/api/web-chat.ts` with the react-query hooks (`useWebChats`,
  `useCreateWebChat`, `useUpdateWebChat`, `useDeleteWebChat`) mirroring an existing api file
  such as `web/src/api/agents.ts`.

### 5. Dashboard — public chat page

- Create `web/src/pages/WebChat.tsx`: a self-contained chat page. It must NOT use `Shell`,
  `RequireAuth`, the sidebar, or the auth store.
- `web/src/App.tsx`: add `<Route path="/chat/:token" element={<WebChat />} />` **outside**
  `RequireAuth` and outside `Shell` (it is a public route).
- Behavior: on mount, render a username/password form. On submit, `POST .../login`. On
  success, render a minimal chat UI (message list + input). Sending a message calls
  `.../message`, then polls `.../message/:traceId` every ~1.5s until `done`/`error`.
  Keep `sessionId` in component state so follow-ups stay in one conversation. The
  `FloatingChat` component is a useful styling reference but should not be reused wholesale
  (it is dashboard-coupled).

### 6. Tests

Add/extend Vitest unit tests (mock DB/Redis per the project mock pattern):

- `tests/unit/web-chat.test.ts` — credential encrypt/verify (correct + wrong password),
  create/update/delete, `dispatchWebChatMessage` enqueues a job with empty `channelId`,
  session history is prefixed into the input.
- Server route tests — public login rejects bad credentials and disabled channels, message
  endpoint requires the cookie, poll endpoint transitions running→done.

Run `npm run lint`, `npm run typecheck`, and `npm test` — all must pass with full coverage.

### 7. Documentation

Update `README.md`, `PRODUCT_GUIDE.md`, and `FEATURES.md` (new feature: Web Chat channels),
`ADMIN_GUIDE.md` (how to create one, security note about the shared credential), and
`CLAUDE.md` (new `src/modules/web-chat/` module, new tables, the `/chat/:token` public
route). Bump `package.json` to the next **minor** version. Do **not** create a git tag or
GitHub release.

As you complete each acceptance criterion below, tick `- [ ]` → `- [x]` as you go.

## Test Plan

- [x] Create a web chat in the dashboard: open Channels, click "New web chat", set a name,
      pick an agent, set username/password, save. Confirm the row appears with a copyable URL.
      *(Covered by `api-web-chat.test.ts` — create validates fields/agent and returns the
      `publicToken`; `Channels.tsx` renders the row + copy button.)*
- [x] Open the generated URL in a private/incognito window (no Slack, no dashboard session).
      Confirm a username/password prompt appears and the chat is not reachable without it.
      *(`WebChat.tsx` is routed outside `RequireAuth`/`Shell`; `web-chat-routes.test.ts`
      verifies message/poll require the session cookie → 401 without it.)*
- [x] Enter the wrong password → rejected. Enter the correct credentials → chat UI loads.
      *(`web-chat.test.ts` credential verify; `web-chat-routes.test.ts` login 401/200.)*
- [x] Send a message; confirm the attached agent replies in the browser. Send a follow-up
      that depends on the first message; confirm context carried over.
      *(`dispatchWebChatMessage` prefixes session history into the run input — tested; poll
      endpoint returns the run output and records the assistant turn.)*
- [x] Disable the web chat in the dashboard; confirm the public URL stops accepting logins.
      *(`verifyWebChatCredential` returns null for disabled channels; public routes 404 on a
      disabled channel — tested.)*
- [x] Change the password in the dashboard; confirm the old password no longer works and the
      new one does. *(`updateWebChat` re-encrypts the password; verify rejects the old one.)*
- [x] Edge cases: unknown token in URL (clean 404, not a stack trace), empty message,
      rapid repeated sends (rate-limit handled with a friendly message), error paths.
      *(All covered in `web-chat-routes.test.ts`: 404 unknown/disabled, 400 empty message,
      429 rate-limited, 500 catch blocks.)*
- [x] Regressions: Slack agent runs still post to Slack normally; webhook triggers still
      work; the dashboard sidebar and routing for existing pages are unaffected; a run with
      no Slack channel does not throw. *(Full suite — 96 files / 2899 tests — passes; the
      execution module already guards every Slack call on `channelId`; no Slack code touched.)*

## Acceptance Criteria

- [x] A **Channels** page exists in the dashboard (admin-only) with a **Web Chat** section
      where an admin can create, edit, enable/disable, and delete web chats.
- [x] Creating a web chat requires choosing an existing agent and setting a username and
      password on that same page, and produces a shareable URL.
- [x] Opening the URL prompts for the username/password and grants access only on a correct
      match — with no Slack login and no dashboard account required.
- [x] After authenticating, a visitor can hold a multi-message conversation with the attached
      agent in the browser, with context preserved across messages.
- [x] Disabling a web chat (or deleting it, or changing its credentials) immediately stops
      the old access path from working.
- [x] Existing Slack agent execution and webhook triggers are unaffected; `npm run lint`
      (0 errors), `npm run typecheck`, and `npm test` (96 files / 2899 tests) all pass; docs
      are updated.

## Out of Scope

- **Per-visitor accounts / identity.** There is one shared username+password per web chat,
  not individual logins, sign-up, SSO, or visitor profiles.
- **Real-time token streaming.** v1 uses request + poll; SSE/WebSocket streaming is a later
  enhancement.
- **File uploads / attachments** in the web chat.
- **Custom branding/theming** of the public page (colors, logo, custom domain).
- **Other channel types.** The Channels page is structured to host more channel types later,
  but this plan ships only Web Chat.
- **Analytics dashboards** for web chat usage beyond storing the conversation records.
- **Embeddable widget / iframe snippet** — only a full-page shareable link.
