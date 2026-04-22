---
id: plan-023
title: Investigate Splitsie KB source showing 0 entries in production
status: archived
previous_status: draft
created: 2026-04-22
---

## Summary

Investigate in production why a user in the Slack workspace **splitsie** has a Google Drive KB source that reports **Active** status with **0 entries**, even though the connected Google Drive folder contains 98 documents. The user has re-downloaded all docs, recreated the folder, reconfigured the connection, and re-added the source — the sync completes ("1 minute ago" / "3 minutes ago" Last Synced) but no entries ever land in the knowledge base.

## Why

Reported directly by a user (Nameet Potnis) in the splitsie workspace. Screenshots attached:

- `.bake/media/1776862701839-x345v7.png` — Slack thread. User reports: downloaded all docs into a folder, connection appears broken, reconfigured everything including redownloading all documents and creating a new folder. Folder has ~6 Google Docs / 98 documents total that need to be indexed. Shares the Drive folder URL: `https://drive.google.com/drive/folders/1eihiredqJ7Y-trkyHLUKqkYD5If5WWYy?usp=sharing`
- `.bake/media/1776862709130-3rmyta.png` — Dashboard KB Sources page. Shows **two** "Nameet's Google Drive" sources, both **Active**, both with **0 Entries**, last synced 1 and 3 minutes ago. User note: "tried everything for the past 2 hours. it still says 0 entries."

This is a live production incident — a paying workspace cannot use the KB feature for the Drive content they've organised. We need to diagnose what's happening before we can propose a fix.

## Approach

This plan is **investigation-only**. No code changes yet — we need to understand the failure mode first.

Areas to probe in production:

1. **Database state (splitsie workspace):**
   - `kb_sources` rows for this workspace — config, connection_id, last_sync_at, last_sync_status, error fields
   - `kb_entries` count for each kb_source_id
   - `connections` row referenced by the kb_source — provider (`google`), scopes granted, token expiry, whether refresh succeeded
   - `workspace_oauth_apps` row for provider=`google` in this workspace — is the workspace's own Google OAuth app configured, or is the source tied to a stale/revoked app?
2. **Sync logs:**
   - Recent lines from the sync process (`src/sync.ts`) filtered by workspace id / kb_source id
   - Look for silent-success paths: sync marked complete but listed 0 files (folder id wrong? permissions? shared-drive vs My Drive? pagination bug?)
   - Look for per-file failures: MIME type filtering, export failures, size limits
3. **Drive access sanity check:**
   - Using the workspace's stored OAuth token, can the Drive API list the folder `1eihiredqJ7Y-trkyHLUKqkYD5If5WWYy`? Does it return 98 items, or 0? (The user shared the folder with `anyone with the link` — but the KB source reads as the OAuth identity, not anonymously.)
4. **Duplicate sources:** Two sources named "Nameet's Google Drive" exist. Are they pointing at the same folder? Different folders? Is one from a revoked connection? Should both be consolidated?

Likely failure modes to rule in/out (in order of prior probability):
- **Folder sharing / ownership mismatch** — the folder is owned by someone else and shared via link; OAuth identity isn't a direct member, so Drive API list returns empty.
- **Shared Drive vs My Drive** — connector queries only `drive.list` without `includeItemsFromAllDrives`/`supportsAllDrives`; shared-drive items never appear.
- **MIME filter too narrow** — connector only indexes `application/vnd.google-apps.document`, skipping PDFs/Sheets/Slides that make up the 98 items.
- **Pagination / nextPageToken** — first page returns 0 relevant items, subsequent pages never fetched.
- **Stale OAuth token / scope downgrade** — sync "succeeds" with a 401/403 swallowed, marking Active.

## Instructions for Claude Code

This is a production investigation. All actions are **read-only** against prod unless the user explicitly authorises a write. Work on the production droplet (`tinyjobs-prod` per user memory). Do not commit code yet — this plan ends with a diagnostic report, not a fix.

1. **Locate the splitsie workspace.** SSH to `tinyjobs-prod`, open a DB shell, find the workspace row by Slack team name/domain = `splitsie`. Record its `workspace_id`.
2. **Pull KB source state.** For that workspace:
   - `SELECT id, name, type, config, connection_id, last_sync_at, last_sync_status, last_sync_error, created_at FROM kb_sources WHERE workspace_id = $1`
   - For each source id, `SELECT count(*) FROM kb_entries WHERE kb_source_id = $1`
   - `SELECT id, provider, scopes, token_expires_at, revoked_at FROM connections WHERE id = $1` for each referenced connection
3. **Pull OAuth app state.** `SELECT provider, client_id_configured, created_at, updated_at FROM workspace_oauth_apps WHERE workspace_id = $1 AND provider = 'google'`.
4. **Tail sync logs.** Grep the sync process logs for this workspace id and the kb_source ids from step 2. Capture both the most recent successful-looking run and any errors in the last 24 hours. Redact tokens.
5. **Reproduce the Drive list (read-only).** Using the workspace's stored OAuth access token (decrypt via the standard connections helper; do not exfiltrate to logs), call `GET https://www.googleapis.com/drive/v3/files?q='1eihiredqJ7Y-trkyHLUKqkYD5If5WWYy'+in+parents&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,size,parents)` and record: total count, MIME-type breakdown, whether `supportsAllDrives=false` vs `true` changes the count.
6. **Compare against the connector.** Open `src/modules/kb-sources/` (Google Drive connector) and confirm which query parameters it actually sends, which MIME types it accepts, and how it handles pagination + shared drives. Note any divergence from the step-5 working query.
7. **Write findings back into this plan.** Fill in the "Findings" section below with concrete numbers, the identified root cause, and the proposed fix. Only then convert this plan from investigation to implementation (new acceptance criteria, tests, etc.).

Do **not** delete the duplicate KB source, re-trigger sync, or change the user's connection without explicit approval — we need the current broken state preserved for diagnosis.

## Findings

**Workspace:** Splitsie, `workspace_id = T01PFPBDGT0`, installed 2026-04-17.

**User / OAuth:** Nameet Potnis (`U01PNGRTE66`) has an active personal `google-drive` connection (`dec4d214-...`) created 2026-04-22 12:24:50 — refresh token valid, full `https://www.googleapis.com/auth/drive` scope. OAuth app is configured for the workspace (`workspace_oauth_apps.provider=google`).

**KB sources:** two rows in `kb_sources`, both pointing at the **same** folder id `1eihlredqJ7Y-trkyHLUKqkYD5lf5WWYy` ("ARK new docs"):
- `1a41c037-...` created 2026-04-21, interval 1h, `entry_count=0`
- `83b6f6f3-...` created 2026-04-22 12:30, interval 24h, `entry_count=0`

**Live Drive API check** (run with Nameet's refreshed access token):
- Folder metadata: 200 OK, owned by `nameetpotnis@gmail.com`, `canListChildren=true`.
- `files.list` query `'folderId' in parents and trashed=false` → **200 OK, 93 files returned, no nextPageToken**.
- **Every single one of those 93 files has `mimeType: image/jpeg`** — named `WhatsApp Image 2026-04-XX at HH.MM.SS.jpeg` etc. Not a single Google Doc, Sheet, PDF, or text file.
- For comparison: Nameet's root Drive *does* contain Google Docs/Sheets elsewhere, so the token is fine.

**Sync log timeline (listener log, 2026-04-22):**
- 12:23:45–12:23:50 — source `1a41c037` sync upserts **6 entries** (Google Docs) successfully. This matches the "6 google docs" screenshot.
- 12:24:12 — `Drive folders error: 401` (old access token expired while browsing folders in the dashboard).
- 12:24:50 — user reconnects Google; new personal connection created.
- 12:25:19–12:25:58 — two more syncs of `1a41c037` each upsert the same 6 docs.
- 12:26:23 — **`"KB entries tombstoned after sync","deletedCount":6`** on source `1a41c037`, entries=0. From this moment onward every sync returns 0 files → entries=0.
- 12:28:35 — sync of `1a41c037`: entries=0.
- 12:30:19 — user creates the second KB source `83b6f6f3` pointing at the same folder.
- 12:30:26 — sync of `83b6f6f3`: entries=0.

### Root cause

The folder `1eihlredqJ7Y-trkyHLUKqkYD5lf5WWYy` ("ARK new docs") **contains only JPEG files** (93 WhatsApp images). The Google Drive sync handler (`src/modules/kb-sources/sync-handlers.ts:738-741`) explicitly skips `image/*` and `application/pdf`:

```ts
} else if (file.mimeType === 'application/pdf' || file.mimeType?.startsWith('image/')) {
  // Download binary — skip for now (OCR would need a separate service)
  logger.debug('Skipping binary file (OCR not yet implemented)', { name: file.name, mime: file.mimeType });
  continue;
}
```

So every file is silently `continue`-d, the run ends with `count=0`, and then the tombstone pass at line 778 (`deleteStaleKBEntries(..., seenFileIds=[])`) wipes the 6 Google Docs that had been indexed the day before (when they lived in this folder). Post-tombstone, every subsequent sync is a no-op.

Compounding factors:
1. **Silent user-facing failure** — dashboard shows "Active · 0 entries" with no warning that 93 files were skipped as unsupported. From the user's POV the sync is broken; in reality the connector doesn't support what they put in the folder.
2. **Destructive tombstone on empty result** — one bad sync (or a user moving docs out of the folder) irreversibly deletes all previously-indexed entries. No safety rail for "empty result after a non-empty result".
3. **Duplicate source** — the two `kb_sources` rows point at the same folder; nothing in the creation flow warns about this.

Also unrelated but noticed: `tinyhands-listener` had 304 restarts in 3 minutes (crashloop). Out of scope for this plan, flagged separately.

- [x] Workspace id for splitsie recorded
- [x] KB source rows + entry counts captured
- [x] Connection / OAuth app state captured
- [x] Sync logs for the relevant source ids captured
- [x] Live Drive API call against folder `1eihlredqJ7Y-trkyHLUKqkYD5lf5WWYy` performed — 93 files, all `image/jpeg`
- [x] Root cause identified — folder contains only JPEGs; connector skips all image mime types with no user-visible signal; tombstone pass then deletes the previously-good entries
- [ ] Fix proposal drafted (below)

## Proposed solution

Two tracks: (A) immediate user communication, (B) product fixes so this failure mode can't silently recur.

### A. Tell Nameet (no code needed)

"Your folder 'ARK new docs' currently contains 93 JPEG photos (WhatsApp images) — no Google Docs, Sheets, or text files. The knowledge base indexer only understands Google Docs, Sheets, Slides, and plain-text files today; it skips images and PDFs. Drop actual Google Docs (or plain-text notes) into that folder and the sync will pick them up. Also: you have two duplicate sources pointing at the same folder — safe to delete one."

### B. Product fixes (follow-up plan, see Out of Scope below for what stays out)

1. **Surface skipped files in the sync result.** Change `syncGoogleDrive` in `src/modules/kb-sources/sync-handlers.ts` to also return `{ indexed, skipped: { unsupportedMime, emptyContent, exportFailed } }`, persist into `kb_sources` (new column `last_sync_stats jsonb`), and render a warning badge in the dashboard KB Sources table when `indexed === 0 && skipped.unsupportedMime > 0` — e.g. *"93 images skipped — unsupported type. Add Google Docs or text files."*
2. **Safety rail on tombstone.** In `syncGoogleDrive`, do not call `deleteStaleKBEntries` when the Drive `files.list` returns zero matching files AND the source previously had `entry_count > 0`. Instead mark the run as `warning` with error_message "folder returned 0 files — refusing to clear existing entries". This prevents a misconfigured folder from nuking a working index.
3. **PDF text extraction.** Add a lightweight PDF-to-text path (e.g. `pdf-parse` run in-process, small files only — cap at 10 MB). Most users who dump "docs" into a Drive folder mean PDFs. Keep images out of scope until OCR lands.
4. **Dedup warning at source creation.** When creating a `kb_source` of type `google_drive`, check for an existing active source in the same workspace with the same `folder_id` in `config_json` and show a confirm dialog in the dashboard ("A source for this folder already exists — continue anyway?").

Each of these is small and independent; 1 and 2 are the highest-leverage (they'd have prevented this ticket).

## Test Plan

- [ ] After the fix lands, re-sync one of Nameet's sources in production and confirm `kb_entries` count matches the Drive folder item count (within the documented MIME filter)
- [ ] Verify no regression on other workspaces' Google Drive sources (spot-check 2–3 active ones — entry counts unchanged)
- [ ] Verify duplicate-source cleanup path: if the root cause is a stale connection, confirm the user can delete the broken source and keep the working one without data loss

## Acceptance Criteria

- [ ] A written root-cause statement is added to the "Findings" section, citing the specific query, MIME filter, pagination bug, or auth state that caused 0 entries
- [ ] The two duplicate "Nameet's Google Drive" sources are explained (same folder? different? one stale?) with a recommendation on consolidation
- [ ] A follow-up implementation plan (or, if trivial, an in-plan fix section) is drafted and linked — investigation alone does not close this ticket

## Out of Scope

- Shipping the fix itself — this plan is diagnosis only; implementation lands in a follow-up plan once the root cause is confirmed
- Broader refactor of the KB sync pipeline or connector architecture
- Changes to other workspaces' KB sources
- Adding new KB source types or MIME support beyond what's needed to index Nameet's 98 documents
