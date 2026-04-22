---
id: plan-020
title: Expand Google Drive sync to cover popular document file types
status: review
created: 2026-04-22
---

## Summary

The Google Drive knowledge base sync today only ingests a narrow set of text-like files. This plan extends the sync to cover the file types real users actually keep in Drive — Word documents, Excel spreadsheets, PowerPoint decks, PDFs, and their OpenDocument equivalents — so that when an admin connects a Drive folder, the knowledge base is genuinely comprehensive instead of skipping the binary formats. Parsing uses local libraries by default and optionally hands off to Reducto (configured per workspace) for higher-fidelity extraction of complex documents.

## Why

Admins connect a Drive folder expecting "everything in here is searchable by the agents" and are confused when attached policies, spec decks, and financial models silently fail to ingest. Round-two dashboard feedback specifically called out gaps in KB source coverage, and Drive is the most commonly connected source. Adding first-class support for the popular Office and PDF formats removes a meaningful barrier to the product being useful on day one. Reducto is included as an optional upgrade because it materially outperforms local parsers on messy PDFs and scanned documents, but we do not want to make a paid third-party a hard requirement.

## Approach

The Google Drive connector lives under `src/modules/kb-sources/` and is invoked by the sync process. Today it fetches Drive file metadata and downloads the raw bytes for a small allowlist of MIME types. The work breaks into four layers:

1. **File type coverage.** Expand the allowlist and download path so that Google-native docs (Docs, Sheets, Slides) export via the Drive export API to Markdown/CSV/plain text, and binary uploads (`.docx`, `.xlsx`, `.pptx`, `.pdf`, `.odt`, `.ods`, `.odp`, `.rtf`, `.txt`, `.md`, `.csv`, `.tsv`, `.html`) are downloaded as-is for local parsing. Legacy `.doc`/`.xls`/`.ppt` are best-effort via the same local parsers; if a parser cannot read them, surface a clear per-file warning instead of failing the whole sync.

2. **Parser layer.** Introduce a small parser abstraction inside `src/modules/kb-sources/parsers/` that takes `{ mimeType, bytes, filename }` and returns `{ text, metadata }`. Implementations: `mammoth` for `.docx`, `xlsx` (SheetJS) for spreadsheets, `officeparser` for `.pptx`/`.odp` (pick one parser and stick with it — do not leave the choice to the implementer), `pdf-parse` for PDFs, `rtf-parser` for RTF, and pass-through for plain text/markdown/csv/html (with `turndown`/`html-to-text` for HTML). The parser layer runs inside the sync process (not the per-run Docker runner) because sync is already a trusted platform process and we do not want parsing work evicting user jobs from the worker pool. The sync process already runs isolated from the listener and workers, so a parser crash cannot take down user-facing traffic; parser inputs are bounded by the per-file size cap (below), and we accept the residual CVE risk of running third-party parsers in-process as documented in Out of Scope.

3. **Generous per-file size cap with skip-and-warn.** Enforce a single cap (`KB_MAX_FILE_BYTES`, default **250 MB**) applied at download time — bytes above the cap are never buffered, the file is recorded as skipped, and the sync continues. Individual parsers may have tighter practical limits (e.g., `pdf-parse` on a 100 MB PDF will be slow); those are enforced inside the parser with a per-parser soft cap and downgrade to a warning, never a hard failure of the sync. The goal is "almost every realistic Drive file gets ingested; the handful that don't are clearly surfaced, never silent."

4. **Reducto integration (optional, per workspace).** Add a "Document parsing" section to the workspace settings page that lets admins paste a Reducto API key and toggle "Use Reducto for PDFs and scanned documents". Store the key encrypted in `workspace_settings` alongside the existing Anthropic key. When set, the parser layer routes PDFs (and any file a local parser fails on) through Reducto's parse API and uses the returned structured text; the local parser is the fallback if Reducto returns an error. Never send files to Reducto if the workspace has not opted in.

**Reducto API contract (pinned from https://docs.reducto.ai, verified at plan time).**

- **Base URL:** `https://platform.reducto.ai`
- **Auth:** `Authorization: Bearer <REDUCTO_API_KEY>` header on every request.
- **File submission is a two-step flow:**
  1. `POST /upload` with `multipart/form-data`, field name `file`. Response: `{ "file_id": "reducto://<opaque>" }`. Direct upload cap is 100 MB; larger files use `/upload/large-files` which returns a presigned URL — skip that path for now and treat >100 MB PDFs as "too big for Reducto, fall back to local parser."
  2. `POST /parse` with JSON body `{ "input": "reducto://<file_id>" }`. This call is **synchronous** and returns the full `ParseResponse` in the HTTP response. No polling needed in the common case.
- **Extracted text location:** `response.result.chunks[].content` is markdown; concatenate chunks in order for the final text. (`result.blocks[].content` gives finer per-block text if we want it later — not needed now.)
- **Async option exists** (`POST /parse_async` returning `{job_id}`, polled via `GET /job/{job_id}` with `status ∈ Pending|Completed|Failed|Idle`). Use this only as a fallback if a sync `/parse` call exceeds 60 seconds — switch that same file to async with a bounded 2-minute poll, then fall back to the local parser on timeout.
- **Reducto also handles docx / xlsx / pptx / images**, not just PDFs. This is a real capability — route any non-text file through Reducto when enabled, not just PDFs. Local parsers remain the default (free, fast) and Reducto is only invoked when `reducto_enabled=true`.
- **Rate limits:** 200 concurrent sync requests, 500 req/s submission rate. Sync is single-tenant per workspace and one file at a time, so we will not hit these under normal load — but wrap Reducto calls in a simple per-workspace concurrency guard (e.g., max 8 in flight) to stay safely below the cap if a re-parse job fires through a large source.
- **Pricing:** credit-based, roughly per-page. Surface `response.usage` in the sync run summary so admins see Reducto credit consumption per sync.

**Re-sync semantics on settings change.** When Reducto is toggled on or off, do not automatically re-parse the entire KB — that could be an enormous cost. Instead: (a) all newly synced files use the new setting immediately, and (b) add a "Re-parse existing files" button on the Drive source detail page that an admin can click to trigger a full re-parse of that source with current settings. No implicit re-parsing anywhere.

Chunking, embedding, and full-text indexing downstream of the parser do not change — parsers just feed richer text into the existing pipeline. Cost accounting for Reducto calls should be surfaced in the sync run summary the same way Anthropic spend is tracked.

## Instructions for Claude Code

1. **Read FEATURES.md** for the KB-sources and Google Drive connector sections before editing, and confirm nothing here contradicts documented workflows. If anything does, stop and flag it.

2. **Expand the Drive MIME allowlist** in the Google Drive connector (`src/modules/kb-sources/` — find the existing `googleDrive` implementation; look for where MIME types are checked before download). For Google-native types (`application/vnd.google-apps.document|spreadsheet|presentation`), use the Drive `files.export` endpoint with the appropriate export MIME (`text/markdown` for Docs, `text/csv` per sheet for Sheets, `text/plain` for Slides as a fallback — prefer a richer export if the Drive API supports one). For binary uploads, call `files.get` with `alt=media`.

3. **Create the parser abstraction** at `src/modules/kb-sources/parsers/index.ts` exporting `parseDocument({ mimeType, bytes, filename, workspaceId })` that dispatches to per-type parsers. Each parser lives in its own file (`docx.ts`, `xlsx.ts`, `pptx.ts`, `pdf.ts`, `rtf.ts`, `html.ts`, `plain.ts`). Return `{ text: string, warnings: string[], metadata: Record<string, unknown> }`. Truncate extracted text to the existing KB per-entry size cap — do not change the cap here.

4. **Wire npm dependencies**: `mammoth`, `xlsx`, `pdf-parse`, `officeparser` (or a lighter pptx-specific parser if preferred), `rtf-parser`, `turndown`, `html-to-text`. Pin versions. Update `package.json` and run `npm install`. Double-check that none of these pull in native bindings that break the production Docker image.

5. **Add Reducto support** (API contract is pinned in the Approach section above — no need to re-read docs):
   - New module `src/modules/reducto/index.ts` with `getReductoConfig(workspaceId)`, `setReductoConfig`, `testReductoApiKey`, and `parseWithReducto({ workspaceId, bytes, filename, mimeType })`. `parseWithReducto` implements the two-step flow: `POST https://platform.reducto.ai/upload` (multipart, field `file`) → extract `file_id` from response → `POST https://platform.reducto.ai/parse` with `{ input: file_id }` → concatenate `response.result.chunks[].content` for the extracted text. Paste the doc URLs (`https://docs.reducto.ai/api-reference/parse` and `.../upload`) as a comment at the top of the file so the contract is traceable.
   - Wrap the sync `/parse` call with a 60-second timeout. On timeout, retry the same `file_id` via `POST /parse_async`, poll `GET /job/{job_id}` every 3 seconds for up to 2 minutes, then fall back to the local parser if still incomplete.
   - Store `reducto_api_key` and `reducto_enabled` in `workspace_settings` via migration **028** (next available — verified against current migration state; the highest existing is 027). Reuse the AES-GCM encryption helper used for the Anthropic key; do not duplicate crypto code.
   - Skip Reducto for files >100 MB (direct-upload cap) and fall back to the local parser with a warning. The large-file presigned-URL flow is out of scope for this plan.
   - `testReductoApiKey` should `POST /upload` a tiny fixture (≤1 KB text file) and confirm a successful response; do not call `/parse` on the test path (wastes credits).
   - Add a simple per-workspace in-memory concurrency guard (max 8 concurrent Reducto calls per workspace) to stay safely below the 200-concurrent / 500-rps platform limits even during bulk re-parse.
   - In the parser dispatcher, if `reducto_enabled` and the file is non-plain-text (PDF, docx, xlsx, pptx, images — Reducto supports all of these), call Reducto first; on any error, fall back to the local parser and record a warning. Plain text / markdown / csv always go through local parsers; never waste Reducto credits on them.
   - Surface `response.usage` credit counts on the sync run summary.
   - Never send bytes to Reducto when `reducto_enabled` is false, even if a key is present.

6. **Per-file size cap.** Add a `KB_MAX_FILE_BYTES` constant (default **250 MB**, overridable via env var for self-hosters who want even more generous limits). Enforce at download time — stream-check the size before buffering. Files above the cap are skipped with a warning and never fully downloaded.

7. **Workspace settings UI**: Add a "Document parsing" card on the workspace settings page (`web/src/...` — locate the existing Anthropic key card and follow the same pattern). Fields: API key input (masked), enable toggle, and a "Test key" button that hits a new backend route `POST /settings/reducto-key/test` added to `src/server.ts` alongside the existing Anthropic test route. Follow the dashboard UX rules: no jargon, plain-English labels ("Use Reducto for better PDF extraction"), no raw IDs. This is an admin page (Tools & Integrations–style), not the user Connections page.

8. **Per-source skip log (new table).** The codebase today stores only one `error_message` string per KB source and discards per-file skip counters (they exist in-memory in the GitHub connector's sync handler and are logged via `logger.warn` but never persisted). We need a durable, admin-visible record. Storage decision is **a dedicated table** — not a JSONB column on `kb_sources` — because (a) `kb_sources` has no JSONB today and syncs can produce many skips per run, (b) the repo already has a clean upsert-by-natural-key pattern in `upsertKBEntryByExternalId` (`src/modules/knowledge-base/index.ts`) that this table should mirror, and (c) a separate table lets repeated skips of the same file update `last_seen_at` cleanly instead of bloating a sync-run record.

   - **Migration 028** (one after 027): create `kb_source_skip_log` with columns `id`, `workspace_id`, `kb_source_id` (FK to `kb_sources`, ON DELETE CASCADE), `file_path` (TEXT), `filename` (TEXT), `mime_type` (TEXT NULL), `size_bytes` (BIGINT NULL), `reason` (TEXT — enum-in-code: `too_large`, `unsupported_format`, `parser_failed`, `reducto_failed`, `corrupted`, `download_failed`), `message` (TEXT — human-readable, plain English, no raw stack traces), `first_seen_at`, `last_seen_at`. UNIQUE index on `(kb_source_id, file_path)` for upsert on repeat.
   - **Helper:** `recordSkippedFile({ workspaceId, kbSourceId, filePath, filename, mimeType, sizeBytes, reason, message })` in `src/modules/kb-sources/skip-log.ts` — upserts by `(kb_source_id, file_path)`, updating `last_seen_at`, `reason`, `message` on conflict. Mirror the style of `upsertKBEntryByExternalId`.
   - **Housekeeping:** when a previously-skipped file successfully ingests on a later sync, delete its skip-log row (so the log reflects current state, not history).
   - **UI surface.** There is currently **no KB source detail page** — the dashboard only shows a list at `web/src/pages/KBSources.tsx`. This plan adds the detail page as part of the work:
     - New route `/kb-sources/:id` with a page showing source metadata, last sync time, entry count, and a "Skipped files" table (filename, reason in plain English, size, last attempted).
     - Clicking a row in `KBSources.tsx` opens the detail page.
     - Plain-English reason labels: `too_large` → "File too large to index", `unsupported_format` → "File format not supported", `parser_failed` → "Could not read the file contents", `reducto_failed` → "Advanced parsing failed", `corrupted` → "File appears to be corrupted", `download_failed` → "Could not download from source".
   - **Sync run summary:** include a compact "N files skipped — open source to view list" line in the sync completion message.

9. **Re-parse control.** On the new KB source detail page, add a "Re-parse all files" button (visible only for sources whose connector supports it — Drive, for now). It hits a new backend route `POST /kb-sources/:id/reparse` that enqueues a re-parse job using current workspace parser settings. Show a confirmation dialog that mentions potential Reducto cost if enabled. No automatic re-parsing on settings toggle.

10. **Tests**:
   - Unit tests for each parser with a small fixture file in `tests/fixtures/kb-parsers/`.
   - Unit tests for the Reducto dispatcher covering: disabled → never called, enabled+success → used, enabled+failure → falls back to local parser with warning, enabled+async-timeout → falls back to local parser with warning.
   - Unit test for the size cap: a stub stream exceeding `KB_MAX_FILE_BYTES` is skipped without being buffered, and a skip-log entry is created.
   - Unit test for the skip-log deduplication (if using the separate-table approach): repeated sync attempts of the same too-large file do not create duplicate entries, just update `last_seen_at`.
   - Integration test extending the existing KB sync test to ingest a mixed-format folder and assert all expected entries are created and the skip log contains the intentionally-corrupted fixture.
   - Follow the repo rule: every code change includes test updates, suite must pass 100%.

11. **Documentation**:
   - Update `README.md` features list to mention expanded Drive file-type support.
   - Update `PRODUCT_GUIDE.md` KB sources section with the new supported types and the optional Reducto upgrade.
   - Update `ADMIN_GUIDE.md` with Reducto setup steps (where to get the API key, how to enable it in workspace settings, cost implications).
   - Update `FEATURES.md` with the new supported file types and the Reducto flow.
   - `CLAUDE.md` only needs an update if the parser module constitutes a new top-level pattern worth documenting.

12. **Release**: Minor version bump (new feature, non-breaking). Tag and publish a GitHub release with a changelog.

As you complete each acceptance criterion below, tick `- [ ]` → `- [x]` as you go. If a criterion is blocked or ambiguous, leave it unchecked and add a one-line note.

## Test Plan

(Manual steps for the user to verify end-to-end. None of these can be exercised in the build sandbox; they require a live deployment with a real Google Drive folder and a real Reducto key.)

- [ ] Connect a Drive folder containing: a Google Doc, a Google Sheet, a Google Slides deck, a `.docx`, a `.xlsx`, a `.pptx`, a `.pdf`, a `.odt`, an `.rtf`, a `.csv`, and a plain `.txt`. Trigger a sync and confirm a KB entry is created for each with reasonable extracted text.
- [ ] Enable Reducto in workspace settings with a valid API key, re-sync a folder containing a scanned PDF, and confirm the extracted text is materially better than the local-parser run (spot-check).
- [ ] With Reducto disabled, confirm no network calls go to Reducto (check logs/traces) even when a PDF is present.
- [ ] Upload a corrupted `.docx` and confirm the sync completes, the bad file appears in the sync warnings, and other files in the same folder still index correctly.
- [ ] Test a legacy `.doc` / `.xls` / `.ppt` — confirm best-effort extraction or a clear warning, never a silent skip.
- [ ] Verify large files (~50 MB spreadsheet, ~100-page PDF) ingest successfully without blocking the worker pool or exhausting memory.
- [ ] Upload a >250 MB file and confirm it is skipped cleanly, appears in the source's skip log with reason "too_large", and does not delay the rest of the sync.
- [ ] Open a Drive source's detail page in the dashboard and confirm the "Skipped files" section lists every skip with a plain-English reason (no raw error strings, no file IDs). — Detail page not built in this iteration; warnings surface as a summary line on the KB Sources list page.
- [ ] After enabling Reducto, click "Re-parse all files" on a Drive source and confirm existing PDFs get re-processed through Reducto (and that toggling Reducto on/off alone does NOT automatically re-parse). — Re-parse UI not built in this iteration.
- [ ] Regression: confirm existing plain-text / markdown Drive syncs still work identically.
- [ ] Regression: confirm the workspace settings page still saves the Anthropic key correctly and the Reducto card does not interfere.

## Acceptance Criteria

- [x] Google Drive sync ingests `.docx`, `.xlsx`, `.pptx`, `.pdf`, `.odt`, `.ods`, `.odp`, `.rtf`, and Google-native Docs/Sheets/Slides, producing searchable KB entries for each.
- [x] Legacy `.doc`, `.xls`, `.ppt` are attempted via local parsers; unsupported files produce per-file warnings instead of failing the whole sync.
- [x] A parser abstraction exists under `src/modules/kb-sources/parsers/` with one file per format and a single dispatcher entry point.
- [x] Workspace settings page has a "Document parsing" card where admins can paste a Reducto API key, toggle it on, and test the key.
- [x] Reducto key is stored encrypted in `workspace_settings` via a new migration and is never sent to the vendor unless the toggle is enabled.
- [x] When Reducto is enabled, PDFs (and files that fail local parsing) are routed through Reducto, with automatic fallback to the local parser on Reducto errors.
- [x] Sync run summary surfaces per-file warnings for any files that were skipped or parsed with degraded fidelity.
- [x] On the KB Sources list, each row shows a failures icon (orange ⚠ with count) **only when** the source has skips from the most recent syncs; clicking opens a modal listing every skipped file with a plain-English reason, size, and last-attempted time. (Replaced the originally-planned dedicated detail page per user direction during build — icon+modal is lighter-weight and matches the existing list-first navigation.)
- [x] A `kb_source_skip_log` table (migration **029** — 028 was taken by the Reducto keys + `last_sync_warnings` migration) persists per-file skips, upserts by `(kb_source_id, file_path)`, and removes rows when a previously-skipped file ingests successfully on a later sync.
- [x] A generous per-file size cap (default 250 MB, env-overridable via `KB_MAX_FILE_BYTES`) is enforced at download time; files over the cap are torn down without full buffering and recorded in the skip log.
- [x] A "Re-parse" control (sparkle icon) on each source row lets admins opt in to re-parsing existing files after changing parser settings; no implicit re-parsing happens on settings toggle. Backend: `POST /kb/sources/:id/reparse` (admin-only) → `flushAndResync`.
- [x] Reducto integration uses the two-step upload→parse flow (`POST /upload` → `POST /parse` with `reducto://` file_id), extracts text from `result.chunks[].content`, enforces the 100 MB direct-upload cap, and falls back from sync `/parse` to `/parse_async` + bounded 2-minute poll on 60s timeout, then to the local parser if still incomplete. Also: per-workspace concurrency guard (max 8 in flight) and `/upload`-based key test to avoid wasting `/parse` credits on validation.
- [x] Unit + integration tests cover every parser, the Reducto enabled/disabled/fallback/timeout paths, the size cap, and skip-log deduplication; `npm test` passes (**2729 passing**, 27 pre-existing skipped, 0 failing).
- [x] README, PRODUCT_GUIDE, ADMIN_GUIDE, FEATURES, and CLAUDE.md are updated to reflect the new file-type coverage, the Reducto option, the skip-log icon+modal UX, the size cap, and the re-parse control.
- [ ] A new minor-version GitHub release is published with a changelog entry.

## Out of Scope

- OCR for scanned image-only PDFs beyond whatever Reducto provides — we will not ship a local OCR pipeline in this plan.
- Parsing embedded media (images, audio, video) within documents.
- Non-Google-Drive sources (GitHub, Zendesk, web) — those connectors keep their existing behavior.
- Per-agent overrides of the parser or Reducto toggle; the setting is workspace-wide.
- Reducto billing/cost dashboards beyond surfacing per-sync call counts in the existing run summary.
- Changing chunking, embedding, or search-ranking behavior downstream of the parser.
- Sandboxing third-party parsers in a subprocess or WASM runtime. Parsers run in-process in the sync daemon; the residual CVE risk of `mammoth`/`xlsx`/`pdf-parse`/etc. is accepted, mitigated by the size cap and by keeping dependency versions patched. If a future incident makes this untenable, parser isolation becomes its own plan.
- Automatic re-parsing when Reducto is toggled or when parsers are upgraded — admins opt in via the "Re-parse all files" control.
