---
id: plan-024
title: Recursive sub-folder support for Google Drive knowledge base sync
status: complete
created: 2026-04-23
completed: 2026-04-23T09:59:51.000Z
---

## Summary

Let a Google Drive knowledge base source optionally pull in files from every sub-folder beneath the configured root folder — at any depth — instead of only files directly inside the root. The admin controls this with a single checkbox on the source's configuration screen.

## Why

Today, a Google Drive KB source only indexes files whose direct parent is the configured folder. Anything in a sub-folder is silently ignored (sub-folders show up in the Drive listing but are skipped by the file extractor). Admins who point a source at a "Handbook" or "Customer docs" folder with nested structure end up with a KB that looks empty or, worse, half-populated — and there's no signal in the UI that anything was skipped. Most real Drive folders people want to index are hierarchical, so flat-only scoping is the wrong default.

The ask is to make recursion an explicit option: a checkbox labelled "Include sub-folders" that, when ticked, walks the entire tree with no depth limit.

## Approach

Two layers of change:

**1. Sync logic (backend)** — `src/modules/kb-sources/sync-handlers.ts:syncGoogleDrive`. Replace the single flat query with a BFS walk over the folder tree. At each folder, run the existing paginated `files.list` query (unchanged file-type filter, unchanged extraction path, unchanged skip-log + upsert), but also collect folder children (`mimeType = 'application/vnd.google-apps.folder'`) into a queue of folders to visit next. Accumulate `seenFileIds` across the whole walk so the existing `deleteStaleKBEntries` tombstoning naturally handles files that were moved or deleted anywhere in the tree. Guard against cycles (shortcuts / shared folders referenced twice) with a `visitedFolderIds: Set<string>`. No depth limit — the user explicitly asked for unlimited.

When the toggle is off, behaviour is identical to today (flat query on the root only). The toggle defaults to off for existing sources so nothing changes silently on the next sync.

**2. Config field type (shared schema + UI)** — a new `type` discriminant on connector config fields so we can render a checkbox. Currently `ConnectorDef.configFields` only supports text inputs (everything round-trips as a string). Add `type?: 'text' | 'checkbox'` (default `'text'`) to the field shape in `src/modules/kb-sources/connectors.ts` and the mirrored `SOURCE_CONFIG_FIELDS` in `web/src/pages/KBSources.tsx`. Render `<Switch>` (shadcn/ui, already imported elsewhere in the dashboard) when `type === 'checkbox'`. Store the boolean as the string `'true'`/`'false'` inside `config_json` — matching the existing `linear_docs` precedent (`config.include_issues === 'true'` at sync-handlers.ts:1122) — so we don't have to touch the JSON-string storage contract.

Naming: config key `include_subfolders`, label "Include sub-folders", help text "Also sync files inside nested folders at any depth."

**Placement in the Edit Source modal.** The checkbox lives in the "Folder" section of the modal — directly below the folder picker's helper line ("Browse and pick a folder to sync into the knowledge base.") and above the horizontal separator that divides Folder from Auto-sync. It reuses the same `Switch + label + muted helper text` pattern already used by the Auto-sync toggle further down the modal, so the two toggles look consistent. Default state: off (switch in the left position). Same placement in the new-source wizard's Step 2.

**Trade-offs.**
- Recursion is done as a runtime walk, not by rewriting the query to `('id1' in parents or 'id2' in parents …)`. A single mega-query is fewer round-trips, but the OR-query has length limits and no way to tombstone unseen folders cleanly. The walk is simpler, respects pagination per folder, and its cost is one `files.list` call per folder — acceptable, because the same call already happens for the root today.
- Unlimited depth means a pathological tree (e.g. someone's entire Drive root) could issue hundreds of API calls. Acceptable per the ask; Drive's quota is generous and the existing 30-second timeout is per-request, not per-sync. If this bites later we can add a soft warning, not a hard cap.
- Not introducing a `boolean`-typed field in `config_json` — keeping the string encoding is less churn and matches what the codebase already does.

## Instructions for Claude Code

Work in the current worktree. Follow the repo's testing rule: every change gets a matching test update.

### Step 1 — Extend the config field schema

Edit `src/modules/kb-sources/connectors.ts`:

1. Widen the inline field type in `ConnectorDef.configFields` (around line 14) from
   `Array<{ key: string; label: string; placeholder: string; optional?: boolean }>`
   to
   `Array<{ key: string; label: string; placeholder?: string; optional?: boolean; type?: 'text' | 'checkbox'; helpText?: string }>`.
   `placeholder` becomes optional because a checkbox doesn't have one.
2. In the `google_drive` connector definition (lines 18–43), append a third config field:
   ```ts
   { key: 'include_subfolders', label: 'Include sub-folders', type: 'checkbox', optional: true, helpText: 'Also sync files inside nested folders at any depth.' }
   ```

### Step 2 — Make the sync recursive

Edit `src/modules/kb-sources/sync-handlers.ts`, function `syncGoogleDrive` (lines 809–922):

1. Just after `const folderId = config.folder_id || config.folderId;` (around line 836), read the toggle:
   ```ts
   const includeSubfolders = config.include_subfolders === 'true';
   ```
2. Refactor the crawl. Pull the single-folder body (lines 849–914 — query construction, paginated loop, upsert, skip-log, `seenFileIds.push`) into an inner function `async function crawlFolder(currentFolderId: string): Promise<string[]>` that returns the list of **child folder IDs** discovered while listing that folder.
   - Keep `driveQuery` construction the same, but parameterize on `currentFolderId`.
   - In the `files.list` field mask, we already request `mimeType`, so no change there.
   - Inside the `for (const file of files)` loop, before the try/extract block, check `if (file.mimeType === 'application/vnd.google-apps.folder')` — if so, push its id onto a local `childFolderIds` array and `continue` (do not upsert, do not extract, do not count). Folders are not KB entries.
   - Everything else in the loop stays identical (upsert, `clearSkippedFile`, `seenFileIds.push`, `count++`, skip-log on failure).
3. Replace the outer `do { … } while (pageToken)` with a BFS walk:
   ```ts
   const visitedFolderIds = new Set<string>();
   const queue: string[] = [folderId];
   while (queue.length > 0) {
     const current = queue.shift()!;
     if (visitedFolderIds.has(current)) continue;
     visitedFolderIds.add(current);
     const children = await crawlFolder(current);
     if (includeSubfolders) {
       for (const child of children) {
         if (!visitedFolderIds.has(child)) queue.push(child);
       }
     }
   }
   ```
   When `includeSubfolders` is false, the queue drains after the root folder — behaviour matches today exactly.
4. `seenFileIds` and `count` stay function-scoped (declared once at the top of `syncGoogleDrive`, mutated inside `crawlFolder`). The call to `deleteStaleKBEntries(workspaceId, source.id, seenFileIds)` at line 919 is unchanged — it now tombstones across the whole tree, which is what we want.
5. Do **not** change `extractDriveFileText`. Folders no longer reach it (we filter them in the loop); its existing folder-returns-null branch (line 983) becomes defensive only.

Edge cases to preserve:
- The `file_types` filter still applies to files (not folders). Folders must always be enumerated regardless of the filter — otherwise recursion breaks. **Important:** when `file_types` is set, the current query adds `and (mimeType = 'X' or mimeType = 'Y')`. That would exclude folders. Fix: when building `driveQuery` inside `crawlFolder` and `includeSubfolders` is true, the MIME filter must be `and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'X' or … )` so folders are still returned. When `includeSubfolders` is false, keep the current filter (no folder listing needed).
- Cycles via shortcuts or re-parented folders are handled by `visitedFolderIds`.
- Skip-log (`recordSkippedFile` / `clearSkippedFile`) keys on `file.id`, which is globally unique in Drive, so the log works unchanged across folders.

### Step 3 — Render the checkbox

Edit `web/src/pages/KBSources.tsx`:

1. Update the local `SOURCE_CONFIG_FIELDS` map (lines 49–70) — add the `include_subfolders` field to the `google_drive` entry with `type: 'checkbox'`. Mirror the backend shape; keep the widened field type `{ key; label; placeholder?; required?; type?: 'text' | 'checkbox'; helpText? }`.
2. In the edit dialog renderer (lines 428–454) and the wizard Step 2 renderer (lines 598–632), branch on `field.type`:
   - `type === 'checkbox'` → render a `<Switch>` (import from `@/components/ui/switch`, used elsewhere in the dashboard) bound to `editConfig[field.key] === 'true'` / `wizardConfig[field.key] === 'true'`. On change, write the string `'true'` or `'false'` back (not a boolean). Render `field.helpText` next to the switch in muted text, matching the Auto-sync row further down the same modal.
   - `type === 'text'` (or undefined) → current `<Input>` path, unchanged.
   - Keep the existing `google_drive.folderId` special case for the `DriveFolderPicker` — that branch is independent.
3. **Position the "Include sub-folders" switch inside the Folder section** of the modal, immediately after the `DriveFolderPicker` and its helper line, and before the horizontal `<Separator />` that precedes Auto-sync (see screenshot reference). Because `include_subfolders` is only meaningful for `google_drive`, this specific field is rendered inline in the Folder block rather than in the generic `configFields.map(...)` loop — otherwise it would appear above the folder picker with the other Drive text fields. Do the same in the wizard's Step 2. The generic `configFields.map` renderer still handles `include_subfolders` for any future connector that opts in, but for Drive the Folder section owns its placement explicitly.
3. The save path that serialises `editConfig`/`wizardConfig` to `config_json` needs no change — everything is already strings.

### Step 4 — Tests

Edit `tests/unit/sync-handlers.test.ts`. Add a new `describe('syncGoogleDrive recursion', …)` block (or extend the existing Drive describe) with these cases. Reuse `setupHttpsMock`, `makeFakeSource`, `setupProviderCredentials`.

1. **Recursion disabled** — `config_json: '{"folder_id":"root","include_subfolders":"false"}'`. Mock `files.list` once returning two files and one folder child. Assert: only the two top-level files are upserted; the folder child is not visited (only one `files.list` call). `deleteStaleKBEntries` called with the two file ids.
2. **Recursion enabled, one level deep** — same config with `"true"`. Mock list for root (1 file + 1 folder child `sub1`), then list for `sub1` (2 files, no children). Assert: three files upserted in total; `files.list` called twice; `seenFileIds` contains all three.
3. **Recursion enabled, multi-level** — root → sub1 → sub2, each sub with one file. Assert: three `files.list` calls, three files upserted.
4. **Cycle protection** — mock a folder that lists itself as a child. Assert: no infinite loop; each folder visited exactly once.
5. **MIME filter + recursion** — `file_types: 'pdf'`, `include_subfolders: 'true'`, folder has one PDF and one sub-folder. Assert: sub-folder is still traversed despite the MIME filter (the filter query includes the folder MIME when recursion is on).

Do not add integration tests — this is all mockable.

### Step 5 — Docs

Per `CLAUDE.md`, update the docs that describe Drive KB behaviour:

- `FEATURES.md` — the KB source connector table (~line 984) and the Drive file-type-coverage section (~line 989): note the new checkbox and that sub-folders are indexed at any depth when enabled.
- `PRODUCT_GUIDE.md` — the "Google Drive File Type Coverage" section (~line 116): one line about recursive sub-folder ingest.
- `ADMIN_GUIDE.md` — the KB wizard flow description (~line 208) and the Drive section (~line 227): document the "Include sub-folders" toggle, default off, unlimited depth, and note that deep trees mean more API calls.
- `README.md` — only if a feature bullet is obviously incomplete without it. Skip otherwise.

`CLAUDE.md` itself needs no change (no architectural/module shift).

### Step 6 — Release

Run `npm test`, `npm run typecheck`, `npm run lint`. Bump `package.json` version (minor bump — new feature, non-breaking). Commit, tag, `gh release create` with a short changelog entry: "Google Drive KB sources can now recursively index nested sub-folders (toggle in source config, unlimited depth)."

### Do-not-touch zones

- `extractDriveFileText` — the folder-returns-null branch is now defensive; don't rework the extraction pipeline.
- `config_json` storage shape (string-encoded JSON in a TEXT column) — do not migrate to JSONB for this.
- `kb-wizard/` module — unrelated to source config; don't touch.
- The Drive folder picker (`DriveFolderPicker` component) — unchanged.
- Other connectors' config fields — don't retroactively add `type: 'text'` to them; the default handles it.

## Test Plan

- [ ] **Flat sync still works (regression).** Create a Drive KB source pointing at a folder with files and sub-folders. Leave "Include sub-folders" unticked. Sync. Only top-level files appear in the KB; nothing inside sub-folders is imported. Skip log doesn't grow.
- [ ] **Recursive sync imports nested files.** Edit the same source, tick "Include sub-folders", sync again. All files across every sub-folder (including multiple levels deep) are imported. Re-syncing is idempotent (same count, no duplicates).
- [ ] **Toggling off tombstones sub-folder files.** With recursion on and synced, untick it and sync again. Files that live inside sub-folders are removed from the KB; top-level files remain. (This is `deleteStaleKBEntries` doing its job — worth explicitly verifying.)
- [ ] **File-type filter + recursion.** Set `file_types: pdf`, recursion on. Only PDFs are imported, but the walk still descends into sub-folders containing PDFs.
- [ ] **Edge case — empty sub-folders.** A sub-folder with no files (or only more empty sub-folders) doesn't error and doesn't create spurious entries.
- [ ] **Edge case — shared / shortcut folder cycles.** If Drive returns a folder that circularly references itself via a shortcut, sync completes without hanging. (Hard to reproduce naturally; rely on unit test coverage for this.)
- [ ] **Edge case — large tree performance.** On a folder with 50+ nested sub-folders, sync completes without timing out and without exhausting Drive API quota. Not a hard SLA — observe and log if concerning.
- [ ] **UI — checkbox round-trips.** Tick the box, save, close the dialog, reopen — it's still ticked. Untick, save, reopen — still unticked. Same for the new-source wizard.
- [ ] **UI — no regression on other connector forms.** GitHub, Zendesk, Linear, HubSpot, website KB sources render their existing text fields identically (the new field-type discriminant defaults correctly).
- [ ] **Regression — skip log.** Files that fail extraction inside a sub-folder show up in the per-source skip log with the correct filename, and clear themselves once the underlying issue is fixed and the file re-syncs.

## Acceptance Criteria

- [x] `syncGoogleDrive` recursively walks sub-folders when `config.include_subfolders === 'true'`, at unlimited depth, with cycle protection — and is byte-for-byte equivalent to the current flat behaviour when the flag is off or absent.
- [x] The source config form (both the new-source wizard Step 2 and the Edit Source modal) shows an "Include sub-folders" switch for Google Drive sources, placed inside the Folder section — directly below the folder picker's helper text and above the separator preceding Auto-sync — rendered with the same visual pattern as the Auto-sync toggle, persisted into `config_json` as the string `'true'` or `'false'`, and **defaulted to off** (untoggled) for both existing and newly-created sources.
- [x] Unit tests cover: recursion off, recursion on one level, recursion on multi-level, cycle protection, and MIME-filter + recursion interaction. All pass under `npm test` with coverage maintained.
- [x] `FEATURES.md`, `PRODUCT_GUIDE.md`, and `ADMIN_GUIDE.md` document the new toggle (default off, unlimited depth, where it lives in the UI).
- [x] A release is tagged with a minor version bump and a changelog line describing the feature.

## Out of Scope

- A depth-limit control. The ask is explicitly unlimited; no "max depth" field, no UI for it.
- Retroactively turning recursion on for existing Drive sources. They stay flat until an admin ticks the box.
- Applying the same pattern to other connectors (GitHub, Zendesk, etc.) — they either already recurse or have no folder concept.
- Surfacing per-folder skip/error counts in the UI. The existing per-source skip log already receives nested failures; a folder-level breakdown is a separate feature.
- Changing `config_json` to JSONB or introducing first-class boolean field storage. String-encoded booleans match existing precedent; a storage migration is a separate, larger change.
- Batching multiple folder IDs into a single `files.list` query (the "OR-query" optimisation). Walk-based recursion is simpler and tombstones cleanly; revisit only if API-call volume becomes a real problem.
- Parallelising the folder walk. Sequential is fine at current scales and keeps ordering/logging predictable.
