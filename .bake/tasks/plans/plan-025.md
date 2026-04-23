---
id: plan-025
title: OCR for images (jpg, png) in Google Drive KB sync
status: complete
created: 2026-04-23
completed: 2026-04-23T11:03:20.000Z
---

## Summary

When the Google Drive knowledge-base connector encounters image files (JPG, PNG), extract the text inside them via OCR and index it like any other document, instead of silently skipping the file as "unsupported".

## Why

The Google Drive connector description in the dashboard already promises that "PDFs and images are automatically OCR-processed" (`src/modules/kb-sources/connectors.ts:30`), but the sync code at `src/modules/kb-sources/sync-handlers.ts:1009` explicitly skips anything with a `image/*` MIME type. So the UI is lying, and users uploading screenshots, scanned receipts, whiteboard photos, or screenshotted slide decks see them silently dropped from the KB. Workspaces that already pay for Reducto (used for scanned-PDF OCR) get image OCR essentially for free, since Reducto's parse endpoint accepts image inputs the same way it accepts PDFs.

## Approach

Reuse the existing Reducto integration rather than introducing a second OCR engine. Concretely:

- Add a new `image` parser family in `src/modules/kb-sources/parsers/index.ts`, mapped from `image/jpeg`, `image/png`, `image/jpg`, and the matching extensions (`jpg`, `jpeg`, `png`).
- The `image` family has no local parser — it goes straight to Reducto via the existing `parseWithReducto` path. Add `image` to `REDUCTO_PREFERRED_FAMILIES`.
- If a workspace does not have Reducto enabled, the parser returns a clear skip (`reducto_required`) so the admin sees an actionable message in the KB skip log instead of generic "unsupported".
- In `src/modules/kb-sources/sync-handlers.ts`, narrow the blanket `image/*` skip so JPG/PNG fall through to the binary-parse path; everything else (`gif`, `webp`, `svg`, `tiff`, `heic`, etc.) continues to skip with the existing message. Add the two image MIME types to `BINARY_PARSER_MIMES`.
- Verify `parseWithReducto` in `src/modules/reducto/index.ts` already passes the file's MIME type through to Reducto. If it currently hard-codes a PDF assumption, generalize it (Reducto's `/parse` endpoint takes the original MIME).
- Per-file size cap (`KB_MAX_FILE_BYTES`) continues to apply unchanged — large camera originals will still be skipped with `too_large`, which is the right behavior.
- Cost note: Reducto bills per page, and an image counts as one page, so the marginal cost per image is the same as a single PDF page. This is acceptable; we don't need a separate budget gate.

Out of scope below covers the formats and engines we deliberately did not include.

## Instructions for Claude Code

1. **Parser dispatcher** — `src/modules/kb-sources/parsers/index.ts`:
   - Add `'image'` to the `ParserFamily` union (line 87–91).
   - Add to `REDUCTO_PREFERRED_FAMILIES` (line 32–37): `'image'`.
   - Add to `EXT_TO_FAMILY` (line 42–64): `jpg: 'image'`, `jpeg: 'image'`, `png: 'image'`.
   - Add to `MIME_TO_FAMILY` (line 66–85): `'image/jpeg': 'image'`, `'image/jpg': 'image'`, `'image/png': 'image'`.
   - In `runLocalParser` (line 100–120), add a `case 'image'` that returns a `ParseResult` with empty text and a single warning like `${input.filename}: image OCR requires Reducto to be enabled for this workspace` and `metadata: { parser: 'image-no-reducto' }`. This is the path taken when Reducto is not enabled — we cannot extract text without it.
   - In `parseDocument` (line 122+), after `resolveFamily`, when `family === 'image'` and Reducto is not enabled, route to a `recordSkip`-friendly skip reason: return the empty result above; `sync-handlers.ts` should then map `parser === 'image-no-reducto'` to a new skip reason `reducto_required` (see step 3).

2. **Reducto client** — `src/modules/reducto/index.ts`:
   - Confirm `parseWithReducto` forwards `input.mimeType` to Reducto's upload/parse call. If it currently sets `Content-Type: application/pdf` or similar, change it to use `input.mimeType` (defaulting to `application/octet-stream`).
   - No new methods needed; Reducto's `/parse` accepts images natively.

3. **Sync handler** — `src/modules/kb-sources/sync-handlers.ts`:
   - Around line 1009, change the image-skip branch so that `image/jpeg`, `image/jpg`, and `image/png` fall through to the binary-parse path. Keep skipping all other `image/*`, plus `video/*` and `audio/*`. The skip message for those should remain `${mime} is not indexed (image/audio/video)` but the image clause should now read along the lines of `${mime} is not indexed (only jpg/png images are OCR'd)`.
   - Add `image/jpeg`, `image/jpg`, `image/png` to `BINARY_PARSER_MIMES` so the `canParseBinary` check (line 1019) accepts them.
   - After `parseDocument` returns, when `(parsed.metadata as any)?.parser === 'image-no-reducto'`, call `recordSkip('reducto_required', 'image OCR requires Reducto — enable it in Settings → Integrations')` and `return null` instead of the generic `empty_extraction` path.

4. **Skip log reason** — `src/modules/kb-sources/skip-log.ts`:
   - Add `'reducto_required'` to the union of allowed skip reasons (alongside `too_large`, `parser_failed`, `unsupported_format`, `reducto_failed`, `corrupted`, `empty_extraction`, `download_failed`).
   - Update any `kb_source_skip_log` migration / constraint if reasons are constrained at the DB level. If the column is a free-text varchar, only the TS type needs updating.

5. **Connector description** — `src/modules/kb-sources/connectors.ts:30`: the existing copy is now accurate; leave it. Do not edit unless wording needs sharpening to clarify that only JPG/PNG are supported (e.g. "PDFs and JPG/PNG images are automatically OCR-processed when Reducto is enabled.").

6. **Tests** — add to `tests/unit/kb-sources/`:
   - Parser dispatcher: a test that `parseDocument({ mimeType: 'image/png', ... })` resolves to family `image`, calls `parseWithReducto` when Reducto is enabled, and returns a `parser: 'image-no-reducto'` empty result when it isn't.
   - Sync handler: a test that a Drive file with `mimeType: 'image/png'` is downloaded and parsed (no longer hits the `unsupported_format` skip), and a test that `mimeType: 'image/gif'` still skips with `unsupported_format`.
   - Skip log: a test that `reducto_required` is a recognized reason and round-trips through `recordSkip` / read.

7. **Docs** — update:
   - `README.md` and `PRODUCT_GUIDE.md` knowledge base sections to mention JPG/PNG OCR (Reducto required).
   - `FEATURES.md` to record the new behavior and the Reducto dependency.
   - `ADMIN_GUIDE.md` to mention that workspaces wanting image OCR must enable Reducto.
   - No CLAUDE.md change — no new module, no new architecture.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]`. Leave a one-line note under any criterion you cannot satisfy.

## Test Plan

- [ ] Manual: in a workspace with Reducto enabled, drop a JPG and a PNG (each containing readable text — e.g. a screenshot of a Notion page) into a synced Drive folder, run sync, and confirm both appear in the KB with extracted text searchable.
- [ ] Manual: in a workspace without Reducto, repeat the above and confirm the files are listed in the KB skip log with reason "Reducto required" and an actionable message — not silently dropped.
- [ ] Edge case: a 25 MB camera-original JPG should be skipped with `too_large`, not attempted.
- [ ] Edge case: a corrupt / zero-byte PNG should produce a `parser_failed` or `reducto_failed` skip, not crash the sync run.
- [ ] Edge case: a `.gif`, `.webp`, `.svg`, `.tiff`, and `.heic` file should each still be skipped with the existing `unsupported_format` reason (not OCR'd).
- [ ] Regression: sync a folder containing a mix of PDFs, docx, xlsx, and JPGs and confirm none of the existing formats regress (counts and content match a pre-change baseline).
- [ ] Regression: PDF Reducto path still works unchanged (no MIME-type leakage from the image path).

## Acceptance Criteria

- [x] JPG (`image/jpeg`, `image/jpg`) and PNG (`image/png`) files in a Google Drive KB source are downloaded and routed to Reducto for OCR when the workspace has Reducto enabled, and the extracted text is indexed as a normal KB entry.
- [x] When a workspace does not have Reducto enabled, JPG/PNG files are recorded in the skip log with reason `reducto_required` and an admin-readable message pointing to Settings → Integrations.
- [x] Other image types (`gif`, `webp`, `svg`, `tiff`, `heic`, etc.), audio, and video continue to be skipped with the existing `unsupported_format` reason — no behavior change for them.
- [x] Unit tests cover: image-MIME dispatch in the parser, Reducto-enabled vs Reducto-disabled paths, the new `reducto_required` skip reason, and the sync handler's narrowed image-skip branch.
- [x] `README.md`, `PRODUCT_GUIDE.md`, `FEATURES.md`, and `ADMIN_GUIDE.md` are updated to reflect that JPG/PNG OCR is supported (with the Reducto requirement called out).
- [x] `npm test`, `npm run typecheck`, and `npm run lint` all pass.

## Out of Scope

- Other image formats: GIF, WebP, SVG, TIFF, HEIC, BMP, AVIF. (TIFF is the most plausible follow-up for scanned-document workflows; defer until asked.)
- A non-Reducto OCR fallback (e.g. bundling Tesseract). Image OCR strictly requires Reducto for now; workspaces without it get a clear skip message rather than a degraded local OCR.
- OCR for images embedded inside other documents (e.g. a JPG pasted into a docx, a screenshot inside a PDF). Reducto already handles those as part of the parent document; nothing to do here.
- Image-OCR for non-Drive KB sources (uploaded files via Slack, GitHub, Zendesk, web crawl). The same parser change will benefit them automatically once their connectors stop pre-filtering images, but that's a separate plan.
- Storing the image binary or thumbnails alongside the extracted text. We index the OCR'd text only, the same way PDFs are handled today.
- Cost gating / per-workspace OCR budgets specific to images. Existing Reducto cost tracking applies unchanged.
