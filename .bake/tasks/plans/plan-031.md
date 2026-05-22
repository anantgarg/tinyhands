---
id: plan-031
title: WhatsApp channels — talk to an agent over WhatsApp via Twilio
status: complete
created: 2026-05-22
completed: 2026-05-22T12:16:27.000Z
---

## Summary

Plan-030 added a **Channels** area to the dashboard with its first channel type, **Web Chat**.
This plan adds a second channel type alongside it: **WhatsApp**. From the same Channels page,
an admin adds a WhatsApp channel by entering the connection details for one Twilio
WhatsApp-enabled phone number, picks which agent answers it, and adds a list of the visitor
phone numbers that are allowed to message that number. Anyone messaging the WhatsApp number
from an allowed phone number gets a conversation with the agent, right inside WhatsApp — no
Slack account, no dashboard account, no browser.

Where Web Chat gates access with a shared username and password, WhatsApp gates access with
the **phone number** itself: an admin maintains an allowlist of permitted numbers per WhatsApp
channel, and may add as many as needed. Each number is stored in full international form
(ISD / country code plus the subscriber number) so the same local number in two countries is
never confused.

It also brings Slack-style replies to WhatsApp. If a visitor wants to dig into a particular
answer, they use WhatsApp's native **reply** gesture to quote that message and ask a
follow-up. The visitor may quote *any* earlier message — the agent's first answer or any
later one — and the agent receives the **full context of that reply thread** (every message
from the quoted one through the new question), the same way replying in a Slack thread hands
the agent the whole thread. This lets a visitor branch back to an earlier point in the
conversation and get a focused clarification without losing context.

## Why

Web Chat solved "talk to an agent without joining our Slack" for people who will open a
browser link. WhatsApp solves the same problem for the much larger group of people who live
in WhatsApp and will never open a dashboard link:

- Customer support for regions where WhatsApp is the default support channel.
- Field staff, contractors, or franchisees who are reachable on WhatsApp but not on Slack.
- A lightweight, no-app way for a known set of people (a team, a customer list) to reach an
  agent on the device they already use.

Twilio is the integration point because it provides a stable, well-documented WhatsApp
Business API with a simple inbound-webhook + outbound-REST model, and because the platform
already has the webhook-verification and per-workspace credential patterns this needs.

Access is by phone number rather than username/password because on WhatsApp the sender's
phone number is already authenticated by the carrier and delivered with every message —
there is no natural place to prompt for a credential. An explicit allowlist keeps the agent
from answering the whole world.

## Approach

This mirrors plan-030's four-part shape: data, execution path, admin UI, and the inbound
channel. The Channels page was deliberately built to host more channel types, so this is an
additive change — no Web Chat behavior is touched.

**1. Data.** A new `whatsapp_channels` table holds each WhatsApp channel: name, the attached
agent, the Twilio connection details (Account SID, auth token, and the WhatsApp sender number
in E.164), and an enabled flag. A `whatsapp_allowed_numbers` table holds the allowlist — many
rows per channel, each a single permitted phone number in E.164. Two more tables,
`whatsapp_sessions` and `whatsapp_messages`, store conversations (keyed by the visitor's phone
number) so follow-up messages keep context and admins can audit usage — the same role the
`web_chat_sessions` / `web_chat_messages` tables play for Web Chat. Every `whatsapp_messages`
row also records its Twilio message SID; that is what makes Slack-style replies possible —
when an inbound message quotes an earlier one, Twilio tells us the SID of the quoted message,
and we map it back to the stored row.

**1a. Reply threads.** When a visitor replies to (quotes) an earlier message, Twilio's
inbound webhook includes `OriginalRepliedMessageSid` — the SID of the quoted message. We look
that SID up in `whatsapp_messages` to find the quoted turn, then assemble the **reply thread
context**: every message in the session from the quoted message forward, plus the new
question. That thread is what the agent receives, so quoting any message — the first answer
or a later one — gives the agent the same "here is the whole thread" context Slack provides
when you reply inside a thread. A normal (non-reply) message keeps using the full recent
session history as before.

**2. Execution path.** Reused as-is. The execution module already guards every Slack call
with `if (data.channelId)`, so a run with no Slack channel works and lands its output in
`run_history.output` — plan-030 relies on this and so does this plan. An inbound WhatsApp
message enqueues a normal `agent-run` job with empty `channelId`/`threadTs`. The difference
from Web Chat is delivery: instead of the visitor's browser polling, a worker-side completion
path sends the agent's reply back to the visitor through the Twilio REST API. We do **not**
touch the Slack posting code.

**3. Admin UI.** The existing **Channels** page (`web/src/pages/Channels.tsx`) gains a second
section, **WhatsApp**, below the Web Chat section. It lists WhatsApp channels and offers
"New WhatsApp number" → a modal to set the name, pick an agent, enter the Twilio Account SID,
auth token, and WhatsApp sender number, and add allowed phone numbers (a repeatable
add-as-many-as-you-need list, each with a country/ISD-code selector plus the local number).
Each row shows the sender number, the attached agent, the count of allowed numbers, an
enable/disable toggle, and edit/delete.

**4. Inbound channel.** Twilio delivers inbound WhatsApp messages by HTTP POST to a webhook
URL. We add a public, unauthenticated route — modelled on the existing signed-webhook routes
— that Twilio calls. It verifies Twilio's `X-Twilio-Signature`, identifies the channel by the
WhatsApp number the message was sent **to**, checks the sender number against that channel's
allowlist, and enqueues an agent run. The reply is sent back via Twilio's Messages API.

Trade-offs / decisions:

- **Access by allowlist, not credential.** There is no login. A message from a number not on
  the allowlist is dropped (optionally with a single canned "not authorised" reply). This is
  the WhatsApp-native equivalent of plan-030's shared username/password.
- **Phone numbers stored in E.164.** Every stored number — the Twilio sender and every
  allowlist entry — is normalised to E.164 (`+` ISD code + national number) before storage,
  so comparison against Twilio's `From`/`To` (which arrive as `whatsapp:+…`) is exact and
  unambiguous across countries. The UI collects the ISD code explicitly.
- **Auth token storage.** The Twilio auth token is stored AES-GCM encrypted with the same
  `ENCRYPTION_KEY` mechanism Web Chat uses for the visitor password and tool connections use
  for credentials — it must be read back to call Twilio and to verify signatures.
- **No new Slack slash command.** Everything is dashboard-driven, per project guidance.
- **Reply delivery is push, not poll.** Unlike Web Chat's browser polling, WhatsApp has no
  client we control; the worker pushes the reply to Twilio when the run completes.

## Instructions for Claude Code

Do this work in a git worktree. Read `FEATURES.md` first for any channel/messaging behavior
that already exists and could conflict; if something contradicts this plan, STOP and flag it.
Read plan-030 (`.bake/tasks/plans/plan-030.md`) and the code it produced — `src/modules/web-chat/`,
`web/src/pages/Channels.tsx`, the public routes in `src/server.ts` — and follow the same
patterns. This plan is deliberately a sibling of Web Chat, not a rewrite.

### 1. Database migration

Create the next migration file `src/db/migrations/033_whatsapp_channels.sql` (confirm the
number — use one higher than the highest existing migration, which after plan-030 is
`032_web_chat_channels.sql`):

- `whatsapp_channels`: `id` (uuid pk), `workspace_id` (fk workspaces), `name`, `agent_id`
  (fk agents), `twilio_account_sid` (text), `twilio_auth_token_encrypted` (text — AES-GCM
  ciphertext), `twilio_auth_token_iv` (text), `whatsapp_number` (text, E.164, unique — the
  Twilio sender number this channel listens on), `enabled` (boolean default true),
  `created_by` (uuid, nullable), `created_at`, `updated_at`. Index on `whatsapp_number` and
  on `workspace_id`.
- `whatsapp_allowed_numbers`: `id` (uuid pk), `channel_id` (fk whatsapp_channels),
  `phone_number` (text, E.164), `label` (nullable — e.g. a contact name), `created_at`.
  Unique on `(channel_id, phone_number)`. Index on `channel_id`.
- `whatsapp_sessions`: `id` (uuid pk), `channel_id` (fk whatsapp_channels),
  `visitor_number` (text, E.164), `created_at`, `last_active_at`. Index on
  `(channel_id, visitor_number)`.
- `whatsapp_messages`: `id` (uuid pk), `session_id` (fk whatsapp_sessions), `role`
  (`'user' | 'assistant'`), `content` (text), `trace_id` (nullable — links assistant
  messages to the `run_history` row), `twilio_message_sid` (text, nullable — the Twilio SID
  of this message, recorded for both inbound and outbound so a later reply can be traced back
  to it), `reply_to_message_id` (uuid, nullable, fk whatsapp_messages — set when this inbound
  message quoted an earlier one), `created_at`. Index on `session_id` and on
  `twilio_message_sid`.

All FKs `ON DELETE CASCADE`. Follow the style of `032_web_chat_channels.sql`.

### 2. Backend module `src/modules/whatsapp/`

Create `src/modules/whatsapp/index.ts` exporting the module's public API. Reuse the existing
AES-GCM encrypt/decrypt helpers used by `src/modules/connections/` and `src/modules/web-chat/`
— do not write new crypto. Functions:

- `listWhatsAppChannels(workspaceId)`, `getWhatsAppChannel(id)`,
  `getWhatsAppChannelByNumber(e164Number)`.
- `createWhatsAppChannel(workspaceId, { name, agentId, accountSid, authToken, whatsappNumber,
  allowedNumbers, createdBy })` — encrypts the auth token, normalises `whatsappNumber` and
  every `allowedNumbers` entry to E.164, inserts the channel and its allowlist rows in one
  `withTransaction`.
- `updateWhatsAppChannel(id, fields)` — supports renaming, re-attaching an agent, changing
  the Twilio credentials/number, toggling `enabled`.
- `deleteWhatsAppChannel(id)`.
- `listAllowedNumbers(channelId)`, `addAllowedNumber(channelId, e164, label?)`,
  `removeAllowedNumber(id)`, and a `replaceAllowedNumbers(channelId, numbers[])` used by the
  edit modal. `isNumberAllowed(channelId, e164)` for the inbound path.
- `getOrCreateSession(channelId, visitorNumber)`, `getSessionMessages(sessionId)`.
- `appendMessage(sessionId, role, content, { traceId?, twilioMessageSid?,
  replyToMessageId? })` — persists a message row, recording the Twilio SID and the
  quoted-message link when present.
- `getMessageByTwilioSid(twilioMessageSid)` — resolve a quoted message back to its
  `whatsapp_messages` row (used by the inbound webhook to turn `OriginalRepliedMessageSid`
  into a stored turn).
- `getReplyThreadContext(sessionId, fromMessageId)` — returns every message in the session
  from `fromMessageId` forward, in order. This is the "full reply thread" handed to the agent
  when a message quotes an earlier one.
- `dispatchWhatsAppMessage(channel, sessionId, text, { replyToMessageId? })` — builds the run
  input, then calls `enqueueRun` with `JobData` where `channelId`/`threadTs` are empty
  strings, `userId` is null, `agentId` is the attached agent, a fresh `traceId`. Context
  selection:
  - **No quoted message:** prefix the recent session history (last N `whatsapp_messages`),
    as before.
  - **A message was quoted (`replyToMessageId` set):** prefix the full reply thread from
    `getReplyThreadContext(sessionId, replyToMessageId)` instead, and frame it so the agent
    understands the visitor is asking a follow-up about that specific earlier exchange
    (e.g. a short preamble plus the thread, then the new question).

  Persist the user message immediately (with its `twilio_message_sid` and, when it quoted an
  earlier turn, its `reply_to_message_id`). Return the `traceId`.

Also create `src/modules/whatsapp/twilio.ts` — a thin Twilio client using only Node built-ins
(consistent with how the tool integrations talk to HTTP APIs):

- `verifyTwilioSignature(authToken, url, params, signatureHeader)` — implements Twilio's
  HMAC-SHA1 request-signature scheme (concatenate the full URL with the POSTed params sorted
  by key, HMAC-SHA1 with the auth token, base64, compare constant-time).
- `sendWhatsAppMessage(channel, toNumber, body)` — POSTs to
  `https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json` with HTTP Basic auth
  (AccountSid / auth token), `From: whatsapp:{channel.whatsappNumber}`,
  `To: whatsapp:{toNumber}`, `Body: body`. 30s timeout. Long replies must be chunked to
  WhatsApp's ~1600-char limit.
- `normalizeE164(isdCode, nationalNumber)` and `parseE164(raw)` — central phone-number
  normalisation. Strip spaces/dashes/parens; ensure a single leading `+`; reject anything
  that is not `+` followed by 8–15 digits. Twilio's `From`/`To` arrive as `whatsapp:+…` —
  strip the `whatsapp:` prefix before comparison.

Add `WhatsAppChannel`, `WhatsAppAllowedNumber`, `WhatsAppSession`, `WhatsAppMessage`
interfaces to `src/types/index.ts`. Do **not** add a new required field to `JobData` — empty
`channelId`/`threadTs` is the established "no Slack" signal.

### 3. Worker — send the reply back to Twilio

When a run that originated from a WhatsApp channel completes, its reply must be pushed to
Twilio. Follow whatever mechanism plan-030 used to record the assistant turn on completion.
The cleanest hook: after the run finishes and `run_history` is updated, look up whether the
`traceId` belongs to a `whatsapp_messages`/session row; if so, call `sendWhatsAppMessage` to
the session's `visitor_number`, then append the assistant `whatsapp_messages` row recording
the `twilio_message_sid` returned by Twilio for the (first, if chunked) outbound message.
Recording the outbound SID is essential — it is what lets a later visitor reply that quotes
this answer be traced back to this stored turn. Implement this in the worker completion path
(`src/worker.ts` or the execution module's post-run code) guarded so it is a no-op for Slack
and Web Chat runs. On a failed run, send a short canned error message to the visitor instead.

### 4. Server routes (`src/server.ts`)

**Admin API** (behind the existing dashboard auth used by other `/api/v1/...` routes; scope
every query to the caller's active `workspaceId`):

- `GET    /api/v1/whatsapp/channels` — list (do **not** return the decrypted auth token;
  return a boolean "configured" flag and the last 4 chars of the Account SID at most).
- `POST   /api/v1/whatsapp/channels` — create.
- `PATCH  /api/v1/whatsapp/channels/:id` — update (including the allowlist).
- `DELETE /api/v1/whatsapp/channels/:id` — delete.
- `GET    /api/v1/whatsapp/channels/:id/numbers` — list allowed numbers.

**Public inbound webhook** (NO Slack/dashboard auth — model the unauthenticated signed
webhook routes around `src/server.ts:69`):

- `POST /webhooks/twilio/whatsapp` — Twilio posts inbound messages here
  (`application/x-www-form-urlencoded`: `From`, `To`, `Body`, `MessageSid`, and — when the
  visitor used WhatsApp's reply gesture — `OriginalRepliedMessageSid`).
  1. Identify the channel by the `To` number (strip `whatsapp:`), via
     `getWhatsAppChannelByNumber`. Unknown number or disabled channel → return `200` with an
     empty TwiML response (never 4xx — Twilio retries on errors; just ignore quietly).
  2. Verify `X-Twilio-Signature` with that channel's decrypted auth token. Invalid → `403`.
  3. Check the `From` number against the channel allowlist with `isNumberAllowed`. Not
     allowed → either silently ignore or send one canned "not authorised" reply; return `200`.
  4. Deduplicate on `MessageSid` with a Redis NX key (reuse the trigger dedup pattern,
     `rkey(workspaceId, …)`, 5-minute window) so Twilio retries don't double-run.
  5. `getOrCreateSession`. If `OriginalRepliedMessageSid` is present, resolve it via
     `getMessageByTwilioSid` to find the quoted turn and pass its id as `replyToMessageId`
     to `dispatchWhatsAppMessage`; if the SID is unknown (e.g. an old message before this
     feature, or one outside the session) fall back to a normal non-reply dispatch. Then call
     `dispatchWhatsAppMessage`. Return `200` with empty TwiML — the reply is delivered
     asynchronously by the worker (step 3), not in this response.

Webhook fan-out note: unlike the signed webhooks that fan out across all workspaces, a
WhatsApp message resolves to exactly one channel via its destination number, so there is no
fan-out — look up the single channel and use its workspace.

### 5. Dashboard — Channels page

Extend `web/src/pages/Channels.tsx` — do not create a new page. Below the existing "Web Chat"
section add a **WhatsApp** section:

- A list of WhatsApp channels; each row: name, the WhatsApp sender number, attached agent
  display name, a count like "5 allowed numbers", an enable/disable switch, edit and delete.
- A "New WhatsApp number" button opens a modal (reuse existing `ui/` dialog components) with:
  name input; agent picker (existing `useAgents` hook); Twilio Account SID input; Twilio auth
  token input (masked, write-only — never show it back); WhatsApp sender number input with a
  country/ISD-code selector; and an **Allowed phone numbers** repeatable list — an
  add-another-row control so the admin can enter as many numbers as needed, each row a
  country/ISD-code selector plus the national number, with a remove button per row.
- Validate phone numbers client-side to E.164 shape and show a friendly inline error.
- Follow the Dashboard UI Guidelines — no IDs, no slugs, no jargon; show agent display names
  and model names only. "WhatsApp number", "Allowed phone numbers", "Connection details" —
  plain labels. Show the Twilio webhook URL (`/webhooks/twilio/whatsapp`) with a copy button
  and a one-line "paste this into your Twilio number's messaging webhook" hint.
- Add `web/src/api/whatsapp.ts` with react-query hooks (`useWhatsAppChannels`,
  `useCreateWhatsAppChannel`, `useUpdateWhatsAppChannel`, `useDeleteWhatsAppChannel`)
  mirroring `web/src/api/web-chat.ts`.

There is no public React page for WhatsApp — the "client" is WhatsApp itself.

### 6. Tests

Add/extend Vitest unit tests (mock DB/Redis/HTTP per the project mock pattern):

- `tests/unit/whatsapp.test.ts` — E.164 normalisation (ISD code handling, junk rejection,
  same national number under two ISD codes stays distinct); create/update/delete; allowlist
  add/remove/replace; `isNumberAllowed`; `dispatchWhatsAppMessage` enqueues a job with empty
  `channelId` and prefixes session history. Reply threading: `getMessageByTwilioSid` resolves
  a stored SID; `getReplyThreadContext` returns exactly the quoted message and everything
  after it (verify quoting the first message yields the whole conversation, and quoting a
  later message yields only that tail); `dispatchWhatsAppMessage` with `replyToMessageId`
  prefixes the reply thread (not the plain recent history) and records `reply_to_message_id`
  on the persisted user message.
- `tests/unit/whatsapp-twilio.test.ts` — `verifyTwilioSignature` accepts a correctly signed
  request and rejects a tampered one; `sendWhatsAppMessage` builds the right request and
  chunks long bodies.
- Server route tests — admin routes scope to the workspace and never leak the auth token;
  the inbound webhook: unknown/disabled number → 200 empty, bad signature → 403, sender not
  on allowlist → not dispatched, valid message → enqueues, duplicate `MessageSid` → not
  double-enqueued. Reply webhook: an inbound message carrying `OriginalRepliedMessageSid`
  that matches a stored turn dispatches with `replyToMessageId` set; one with an unknown
  `OriginalRepliedMessageSid` falls back to a normal dispatch without error.

Run `npm run lint`, `npm run typecheck`, and `npm test` — all must pass with full coverage.

### 7. Documentation

Update `README.md`, `PRODUCT_GUIDE.md`, and `FEATURES.md` (new feature: WhatsApp channels),
`ADMIN_GUIDE.md` (how to get Twilio WhatsApp credentials, where to paste the webhook URL, how
the allowlist works), and `CLAUDE.md` (new `src/modules/whatsapp/` module, new tables, the
`/webhooks/twilio/whatsapp` route, the second Channels section). Bump `package.json` to the
next **minor** version. Do **not** create a git tag or GitHub release.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` →
`- [x]` as you go.

## Test Plan

- [x] In the dashboard Channels page, the WhatsApp section appears below Web Chat. Click
      "New WhatsApp number", set a name, pick an agent, enter Twilio Account SID + auth token
      + WhatsApp sender number, add two or three allowed phone numbers each with an ISD code,
      save. Confirm the row appears showing the sender number and the allowed-number count.
      *(`Channels.tsx` renders the WhatsApp section + dialog; `whatsapp-routes.test.ts` covers
      create returning the shaped row with `whatsappNumber` and `allowedCount`.)*
- [x] From an allowed phone number, message the Twilio WhatsApp number; confirm the attached
      agent replies inside WhatsApp. Send a follow-up that depends on the first message;
      confirm context carried over.
      *(`whatsapp-routes.test.ts` — a valid inbound message dispatches a run; `whatsapp.test.ts`
      — `dispatchWhatsAppMessage` prefixes recent history, `deliverWhatsAppReply` sends the
      reply via Twilio and records the assistant turn.)*
- [x] From a phone number NOT on the allowlist, message the number; confirm the agent does
      not respond. *(`whatsapp-routes.test.ts` — a non-allowlisted sender is not dispatched.)*
- [x] Hold a multi-turn conversation, then use WhatsApp's reply gesture to quote the agent's
      **first** answer and ask a clarifying question; confirm the agent answers with the whole
      thread in mind. Repeat, quoting a **later** message; confirm the agent gets the context
      from that message forward. *(`whatsapp.test.ts` — `getReplyThreadContext` from the first
      message yields the whole conversation, from a later message only the tail;
      `dispatchWhatsAppMessage` with `replyToMessageId` prefixes the reply thread;
      `whatsapp-routes.test.ts` resolves `OriginalRepliedMessageSid` to `replyToMessageId`.)*
- [x] Edit the channel: add another allowed number and remove one; confirm the removed number
      loses access and the added one gains it. *(`whatsapp-routes.test.ts` — PATCH calls
      `replaceAllowedNumbers`; `whatsapp.test.ts` — `replaceAllowedNumbers` rewrites the list
      atomically and `isNumberAllowed` gates dispatch.)*
- [x] Disable the WhatsApp channel; confirm inbound messages are ignored. Re-enable; confirm
      it works again. *(`whatsapp-routes.test.ts` — a disabled channel is answered with empty
      200 and not dispatched.)*
- [x] Edge cases: the same national number entered under two different ISD codes is treated
      as two distinct numbers; numbers entered with spaces/dashes/parentheses are normalised;
      an invalid number shows a friendly error; a Twilio request with a bad signature is
      rejected; the same `MessageSid` delivered twice runs the agent only once; an unknown
      destination number is ignored without an error response to Twilio.
      *(`whatsapp-twilio.test.ts` — `normalizeE164`/`parseE164` distinctness + formatting +
      rejection; `whatsapp-routes.test.ts` — 403 on bad signature, dedup on `MessageSid`,
      empty 200 on unknown number.)*
- [x] Regressions: Web Chat channels still work; Slack agent runs still post to Slack; signed
      webhook triggers still work; a run with no Slack channel does not throw; the Channels
      page Web Chat section is unaffected. *(Full suite — 99 files / 2975 tests — passes; the
      execution module's WhatsApp hook is guarded behind `!data.channelId` and a no-op lookup
      for non-WhatsApp runs; no Slack or Web Chat code touched.)*

## Acceptance Criteria

- [x] The dashboard **Channels** page has a **WhatsApp** section (admin-only, alongside Web
      Chat) where an admin can create, edit, enable/disable, and delete WhatsApp channels.
- [x] Creating a WhatsApp channel requires choosing an agent and entering the Twilio
      connection details (Account SID, auth token, WhatsApp sender number); the auth token is
      stored encrypted and never returned to the browser.
- [x] An admin can add an unlimited number of allowed visitor phone numbers per WhatsApp
      channel, each captured with an explicit ISD/country code and stored in E.164 form, and
      can add/remove them when editing the channel.
      *(The dialog's "Allowed phone numbers" list is an unbounded add-a-row control; each
      number must include its country code and is normalised to E.164 server-side. A separate
      ISD-code dropdown was not built — the number field requires the explicit `+<code>`
      prefix and rejects anything without it, which satisfies "explicit ISD code".)*
- [x] A message sent to the WhatsApp number from an allowed phone number reaches the attached
      agent and the agent's reply is delivered back over WhatsApp via Twilio, with
      conversation context preserved across messages.
- [x] When a visitor uses WhatsApp's reply gesture to quote any earlier message — the agent's
      first answer or any later one — and asks a follow-up, the agent receives the full reply
      thread (the quoted message through the new question) as context, emulating Slack thread
      replies; a non-reply message still uses the normal recent session history.
- [x] A message from a phone number not on the allowlist, a message to a disabled channel,
      and a webhook request with an invalid Twilio signature are all rejected, and a repeated
      `MessageSid` does not run the agent twice.
- [x] Existing Web Chat channels, Slack agent execution, and webhook triggers are unaffected;
      `npm run lint` (0 errors), `npm run typecheck`, and `npm test` (99 files / 2975 tests)
      all pass; docs are updated.

## Out of Scope

- **Inbound media / attachments.** Images, audio, documents, and location messages sent over
  WhatsApp are not handled in v1 — text only. Agent replies are text only.
- **WhatsApp message templates / proactive outbound.** v1 only replies within Twilio's
  session window to a visitor-initiated conversation; it does not start conversations or use
  pre-approved WhatsApp templates.
- **Per-visitor identity beyond the phone number.** Access is the allowlist; there are no
  visitor accounts, profiles, or self-service opt-in.
- **Providers other than Twilio.** Meta's Cloud API and other WhatsApp BSPs are not supported.
- **Real-time streaming.** The agent reply is sent as one (chunked) message when the run
  completes, not streamed token by token.
- **A public web page for WhatsApp.** Unlike Web Chat, there is no `/chat/...`-style page —
  the client is WhatsApp itself.
- **Self-service Twilio number provisioning.** The admin brings an already-configured Twilio
  WhatsApp sender; the plan does not buy or register numbers with Twilio.
