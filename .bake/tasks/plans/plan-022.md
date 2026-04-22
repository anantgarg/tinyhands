---
id: plan-022
title: Include Slack attachments and Block Kit content in the text passed to agents
status: building
created: 2026-04-22
---

## Summary

The listener in `src/slack/events.ts` treats `msg.text` as the complete representation of a Slack message, ignoring `msg.attachments` and `msg.blocks`. Many third-party Slack apps (HubSpot, Datadog, Jira, GitHub, PagerDuty, Linear-via-Slack, etc.) deliver the payload that actually matters — email addresses, domains, alert bodies, incident details — inside `attachments[].text` or Block Kit blocks, while `msg.text` is just a short header. Agents get only the header and, if their system prompt instructs them to stay silent when no useful content is present, correctly do nothing. This fix extracts text from all three sources, passes the combined result to the agent pipeline, and keeps `msg.text` available for mention detection. It is a generic ingestion fix — not specific to HubSpot or to any one customer.

## Why

One customer's silent agent made this visible, but the bug is general. Any Slack app that uses attachments or blocks to carry content is silently delivering a truncated view to TinyHands today. The fix is small, local, and unblocks the long tail of "my agent doesn't respond to notifications from <app>" reports that we haven't seen yet because most users assume their agent is just bad.

## Investigation findings (production, 2026-04-22)

Verified against real payloads pulled from the CometChat workspace via Slack `conversations.history`:

| Channel | Sender | `msg.text` | `msg.attachments` | `msg.blocks` | Agent behavior today |
|---|---|---|---|---|---|
| `C064670RAMU` interactive-demo-signups | HubSpot app | header only ("Heads up, team!… new prospect") | **contains the email**, vertical, company, HubSpot contact URL | duplicates the header | Stays silent — system prompt says "no email → silent"; agent never sees the email |
| `C02VCPSB4TC` | HubSpot app | full body with email inline | button-only attachment (no text content) | duplicates the body | Works fine |
| `C0746R57W86` | HubSpot app | full body with email inline | button-only attachment | duplicates | Works fine |
| `C0AKEHHC65A` | human user | plain URL | none | duplicates | Works fine |
| `C0ANCMYTSTY` | human `@mention` | mention + question | none | duplicates | Works fine |

Key observations:
- Across every sampled message, **`text` and `blocks` carry the same content** (Slack generates `text` as a plain-text fallback of `blocks`). So walking blocks in addition to text would double content, not add it.
- **`attachments[].text` is the only place that carries content orthogonal to `text`** in these real payloads — e.g. the HubSpot prospect email in `C064670RAMU`.
- `attachments[].fallback` usually duplicates `attachments[].text` within the same attachment — skip it if equal.
- `attachments[].actions[*]` sometimes carries a useful URL (e.g. "View contact in HubSpot" link with the contact's HubSpot record URL). Worth including — cheap, and gives the agent a deep link it can reference.
- 51 historical runs in `C064670RAMU`, all silent, confirm this isn't an intermittent race — it's deterministic truncation.

This sample is small but covers the three representative shapes: attachments-with-content (the failing shape), attachments-with-only-buttons, and text-only. The fix pattern handles all three.

## Approach

Single-purpose helper that builds a combined string from `text`, attachments, and (rarely) blocks, applied at one call site in `src/slack/events.ts`. Keep the event handler and downstream pipeline untouched.

Rules:

1. Start with `msg.text`.
2. For each `att` in `msg.attachments`, in order, append non-empty values in this sequence: `pretext`, `title`, `text`, then `fallback` **only if not equal to `text`**, then `actions[*]` rendered as `[<action.text>] <action.url>` for any `action` that has a `url`.
3. If `msg.text` is empty **and** `msg.blocks` is non-empty, walk the blocks recursively to produce a plain-text rendering. This is a fallback for Block-Kit-only apps; skipped entirely in the common case because `text` already mirrors `blocks`.
4. Join the pieces with `\n\n`, trim, and apply a hard cap of **50 000 characters** with a trailing `…[truncated]` marker if exceeded. Log a warning with `{ channelId, originalLen }` when truncation fires so we can spot adversarial senders.
5. The helper returns `{ combined, raw }`. The event handler uses `combined` everywhere a text string is passed to the agent pipeline, and `raw` (== `msg.text`) for the `<@BOT>` mention check at line 149 — mentions are always in `text`, and we don't want an app rendering `<@UBOT>` inside an attachment to spuriously look like a mention.

Block Kit walker spec (invoked only in the fallback path):

- `rich_text` block → recurse into `elements`.
  - `rich_text_section`, `rich_text_list`, `rich_text_quote`, `rich_text_preformatted` → recurse into their `elements`.
  - leaf `text` → emit `.text`.
  - leaf `link` → emit `.url` + (` ${link.text}` if `link.text` and `link.text !== link.url`).
  - leaf `emoji` → emit `:${name}:`.
  - leaf `user` → emit `<@${user_id}>`.
  - leaf `channel` → emit `<#${channel_id}>`.
  - leaf `usergroup`, `broadcast`, `color` → skip.
- `section` block → emit `.text.text` (if `text.type === 'mrkdwn'` or `'plain_text'`) and `.fields[*].text` if present.
- `header` block → emit `.text.text`.
- `context` block → emit each `elements[*].text` (mrkdwn/plain_text) or `elements[*].alt_text` (images).
- Unknown block type → skip without error; log at `debug`.

Trade-offs, explicit:

- **Occasional duplication** when an app populates both `attachments[].text` and `msg.text` with overlapping content. Accepted — the agent tolerates repetition, and aggressive deduping risks losing subtle differences (e.g. one says "Email: foo@bar.com", the other says "*Email*: foo@bar.com"). Only exact intra-attachment dupes are skipped.
- **Size cap chosen at 50 KB** as a defensive ceiling for pathological senders (e.g. Datadog alerts with giant metric tables). Typical messages are <2 KB. Truncation is logged, not silently dropped.
- **Actions without URLs are skipped.** An action with only a `name`/`value` (interactive callback, no link) isn't useful to an agent that can't click it.
- **No mutation of `msg.text`.** We compute `combined` and pass it down; the raw message object is untouched in case any other code path relies on it.

Not doing:
- Reworking the relevance gate, context injection, or agent prompt assembly. Out of scope.
- Backfilling or replaying the 51 silent runs in `C064670RAMU`. They stay as they are.
- Introducing a structured `SlackMessagePayload` type that flows through the pipeline. Cleaner long-term, but no second consumer needs it today — YAGNI.

## Instructions for Claude Code

1. Create `src/slack/message-text.ts` exporting:
   ```ts
   export function extractSlackMessageText(msg: { text?: string; attachments?: any[]; blocks?: any[] }): { combined: string; raw: string };
   ```
   Implement the rules in the Approach section. Pure function, no external dependencies.
2. Edit `src/slack/events.ts`:
   - Import the helper.
   - Replace `const text = msg.text || '';` (line 91) with:
     ```ts
     const { combined: text, raw: rawText } = extractSlackMessageText(msg);
     ```
   - At line 149, change the mention check to `rawText.includes(`<@${ownBotUserId}>`)` instead of `text.includes(...)`.
   - Grep the file for any other uses of `msg.text`, `event.text`, or ad-hoc `.text` reads on the message object; replace each with `text` if it's the "what did the user say" semantic, or `rawText` if it's identity/mention. Expected result: line 60 (log preview) should use `rawText` to keep logs honest; line 372 (`parentText` — fetched from `conversations.history`) is a different message object entirely and should pass through the same helper too.
   - Apply the helper to the `parentText` fetch around line 372 so thread-parent messages also benefit (the parent might be the HubSpot notification whose content we also need).
3. Unit tests in `tests/unit/slack/message-text.test.ts` using **real payloads captured from production** (drop the JSON verbatim into `tests/fixtures/slack/`):
   - `hubspot-attachment.json`: the `C064670RAMU` payload where the email lives only in `attachments[0].text`. Assert `combined` contains `stefan.silion@mannah.it` and the HubSpot contact URL.
   - `hubspot-inline.json`: a `C02VCPSB4TC` payload where the email is already in `text`. Assert `combined` contains the email exactly once (no double-count from blocks).
   - `block-kit-only.json`: synthetic but realistic — `text` empty, `blocks` containing a `section` with mrkdwn. Assert `combined` renders the section text.
   - `rich-text-with-link.json`: synthetic — `rich_text` block containing a `link` element. Assert the URL is emitted.
   - `mention-in-text.json`: `text: '<@UBOT> do a thing'`, no attachments. Assert `combined == rawText` and `rawText.includes('<@UBOT>')`.
   - `truncation.json`: attachment with a 60 KB `text`. Assert `combined.length <= 50_000 + len('…[truncated]')` and ends with the marker.
   - `unknown-block.json`: unknown block type — assert no throw, other content still extracted.
4. Update `tests/unit/slack/events.test.ts` (or add one if none exists) with a happy-path test: HubSpot-style payload arrives, a job is enqueued with the combined input visible.
5. `npm run typecheck`, `npm run lint`, `npm test` — all green. No skips.
6. Docs:
   - `FEATURES.md`: under the Slack ingestion section, note that agents receive content from `text`, `attachments`, and Block Kit blocks.
   - `CLAUDE.md`: no change — this doesn't affect the architectural shape enough to warrant a mention.
   - No README/PRODUCT_GUIDE/ADMIN_GUIDE changes (fix, not a new feature).
7. Tag a patch release (`v1.50.6`; bump `package.json`). Changelog line: *"Agents now receive content from Slack message attachments and Block Kit blocks in addition to the plain text. Fixes silent no-ops on notifications from apps like HubSpot, Datadog, Jira, and PagerDuty that deliver their payload via attachments."*
8. After deploy, smoke test: post a HubSpot-shaped test message (reuse the real `hubspot-attachment.json` payload) into a test channel bound to a domain-enrichment-style test agent. Verify via `run_history.input` that the combined text includes the email, and verify the agent actually posts a reply in the thread.
9. Write a reply to Vijit. Keep it generic: TinyHands had a bug where content inside Slack message attachments was not being passed to the agent. The fix is released as v1.50.6 and is live. Their agent will respond to the next HubSpot notification once HubSpot resumes posting (separately, the Apr 19 silence in that channel is on HubSpot's side — their workflow hasn't posted since then — so it's worth Vijit also checking the HubSpot workflow is still enabled). Do **not** reference their agent's system prompt, channel names, or any workspace-specific detail beyond "HubSpot notifications".

## Test Plan

- [ ] Unit tests cover: attachment-only content, inline text (no double-count), Block Kit-only fallback, link extraction, mention in text, oversized input truncation, unknown block types.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` all green.
- [ ] After deploy, a synthetic HubSpot-shaped post in a test channel produces a `run_history` row whose `input` includes the attachment email. The agent replies in-thread.
- [ ] Regression check: `@mention` in a plain-text message still routes to the mention path; DMs still work; existing working channels (`C02VCPSB4TC`, `C0746R57W86`) continue to produce equivalent output (not degraded by added duplication).
- [ ] Spot-check one non-HubSpot agent in each active workspace for any behavior change in its next few runs.

## Acceptance Criteria

- [x] Root cause identified: `src/slack/events.ts` passes only `msg.text` to the agent pipeline, dropping `attachments` and `blocks` content.
- [ ] `extractSlackMessageText` helper exists, handles attachments (including action URLs) and Block Kit as fallback, has intra-attachment dup skipping, has a 50 KB cap with logged truncation, and is covered by unit tests built on real captured payloads.
- [ ] Listener uses the helper at every point it reads `msg.text` as "what was said"; `raw` is used for mention detection and log previews.
- [ ] `parentText` fetched in the thread-reply branch goes through the same helper.
- [ ] Patch release tagged, deployed, and smoke-tested with a realistic attachment-based payload.
- [ ] Generic (non-workspace-specific) follow-up sent to Vijit.

## Out of Scope

- Backfilling or replaying historical silent runs.
- Any change to the relevance gate, agent prompt assembly, or context injection.
- Building silent-agent / silent-channel health alerts — worth a separate plan; the data to drive them (51 consecutive no-ops) exists but surfacing it is a separate product decision.
- Introducing a structured `SlackMessagePayload` type end-to-end.
- Deduping attachment text against main text beyond exact intra-attachment duplicates.
