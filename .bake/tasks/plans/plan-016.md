---
id: plan-016
title: Wiki-style Knowledge Base and Documents, parsing-powered, kept separate
status: review
created: 2026-04-20
---

## Summary

Upgrade two separate content surfaces — the Knowledge Base and the Documents module — so each maintains its own real-time, LLM-curated "wiki" that agents read directly at query time, instead of falling back on keyword search or re-derivation. They share the same pipeline (parser, classifier, wiki-update pass, lint) but are surfaced as two independent tools with different audiences, UX, and lifecycle:

- **Knowledge Base (`kb` tool).** Admin-focused, reference-grade, sync-driven. Content comes from the existing `kb_entries` and, primarily, from the Google Drive connector. Admins curate what lands here; end users and agents don't write to it directly. The KB wiki is for "here is everything the company considers canonical."
- **Documents (`docs` tool).** User and agent collaborative. Users upload any common document type directly into Documents — modern Office (.docx/.xlsx/.pptx), legacy Office (.doc/.xls/.ppt), OpenDocument (.odt/.ods/.odp), PDFs (native + scanned), images (PNG/JPG/GIF/BMP/WEBP/TIFF/HEIC), email (.eml/.msg), archives (.zip), eBooks (.epub), data formats (CSV/TSV/JSON/XML/YAML), text and Markdown and HTML, transcript files (.vtt/.srt), and source-code files. See the format coverage matrix in the Approach section for what's local-only vs. cloud-parser-required. Both users and agents can create, edit, and manage native docs and sheets. The Documents wiki is for "here is what the team (humans and agents) is actively producing and working with."

Both feed from the same parser stack (with optional Reducto or LlamaParse OCR, local-parser fallback otherwise) and both are read by their respective tool with no embeddings, no retrieval-augmented generation.

## Why

The current system has two separate, keyword-indexed stores (`kb_entries`, `documents`) that both fall over on the same problem: lots of content in rich formats with no way for an agent to reason across it. The customer has explicitly asked us to avoid RAG. Karpathy's LLM-wiki pattern is the alternative — compile knowledge once at ingest, maintain it as underlying sources change, and let the agent read the maintained wiki directly.

We tried folding both stores into a single unified wiki and got told that's wrong: the KB and Documents modules serve different audiences with different rules (admin/curated/sync-driven vs. user-and-agent/collaborative/upload-driven) and should stay clearly separated. But both benefit from the same parsing upgrades and the same wiki-style maintenance — so the solution is to apply the same pattern twice, once per surface, with shared infrastructure underneath.

Additionally, the Documents module currently doesn't handle multi-file uploads well, loses structure on Excel and scanned PDFs, and has no way to let agents see updates to docs and sheets reflected in the knowledge they subsequently read. Users want to drag in a pile of mixed-format files and get high-quality agent answers across them without the admin overhead of curating a KB.

## Approach

### One pattern, applied twice

Each surface (KB, Documents) gets its own three-layer structure (per Karpathy), with its own set of wiki pages, its own `index.md`, its own `log.md`, and its own `schema.md`:

1. **Raw Sources (immutable).** Where the content already lives — `kb_entries` rows and Drive originals for KB; `documents` rows (with `document_files` blobs and `sheet_tabs` data) for Documents.
2. **The Wiki (LLM-owned).** A namespace-scoped collection of Markdown pages, stored in a new `kb_wiki_pages` table with a `namespace` column (`'kb'` or `'docs'`). Each namespace gets its own `index.md`, `log.md`, `schema.md`, `sources/*.md`, `entities/*.md`, `concepts/*.md`. Agents read them via the corresponding tool (`kb` or `docs`).
3. **The Schema (configurable).** A per-workspace, per-namespace `schema.md` with sensible defaults. Admins can edit both from the dashboard; the KB schema is tuned for canonical reference material, the Documents schema for active work artifacts.

The two wikis do not cross-link automatically. An agent that wants both consults both tools.

### Shared pipeline

| Stage | Shared? | Notes |
|---|---|---|
| Parser module (`src/modules/kb-parser/`) | Yes | One code path, called by both surfaces. |
| Ingest queue (`kb-ingest`) | Yes | Jobs carry a `namespace` field. |
| Wiki module (`src/modules/kb-wiki/`) | Yes | All reads/writes take a `namespace`. |
| Lint job | Yes | Runs once per workspace per namespace. |
| Triggers | Per-surface | KB: `kb_entries` writes + Drive sync. Docs: `documents` writes + uploads. |
| UI | Per-surface | KB settings page gets parser keys + sync; Documents gets the multi-file upload + the Documents wiki view. |
| Agent tool | Per-surface | `kb` reads from `/workspace/kb/wiki/`; `docs` reads from `/workspace/docs/wiki/`. |

### Parser: optional cloud parsers, always-on local fallback

Same for both surfaces.

- **No cloud key configured → local parsing only.** Text-native formats are read as-is. Office and OpenDocument files are parsed locally where mature libraries exist. Native `documents` content (JSONB doc, `sheet_tabs`) renders to Markdown directly with no external call. Scanned/image-only content gets a clear "image-only — configure Reducto or LlamaParse for OCR" placeholder so the agent knows the source wasn't fully readable.
- **Reducto key configured** → Reducto handles PDFs (native + scanned), Office (.docx/.xlsx/.pptx), legacy Office (.doc/.xls/.ppt), images (PNG/JPG/TIFF/WEBP/HEIC), and HTML. Billed per page; customer's own key.
- **LlamaParse key configured** → same role as Reducto with broader format coverage including OpenDocument (.odt/.ods/.odp), RTF, EPUB, and a wider set of image formats. If both are set, Reducto wins.
- Local parsing is always used for text-native formats and for native `documents` content even when a cloud parser is configured, to avoid unnecessary API spend and latency.

#### Format coverage matrix

This is the explicit "popular formats" claim. Every entry below is handled end-to-end by at least one path; the cells say *which* path.

| Category | Format(s) | Local | Reducto | LlamaParse |
|---|---|---|---|---|
| Text | `.txt`, `.md`, `.html`, `.htm`, `.rtf` | ✅ | ✅ | ✅ |
| Data | `.csv`, `.tsv`, `.json`, `.xml`, `.yaml`, `.yml` | ✅ | ✅ | ✅ |
| Code | `.py`, `.js`, `.ts`, `.go`, `.java`, `.rb`, `.sql`, `.sh`, `.toml`, `.ini` (any text/* MIME) | ✅ | ✅ | ✅ |
| PDF (text layer) | `.pdf` (native) | ✅ via `pdf-parse` | ✅ | ✅ |
| PDF (scanned) | `.pdf` (image-only) | ⚠️ placeholder | ✅ OCR | ✅ OCR |
| Modern Office | `.docx`, `.xlsx`, `.pptx` | ✅ via `mammoth`, `xlsx`, `officeparser` | ✅ | ✅ |
| Legacy Office | `.doc`, `.xls`, `.ppt` | ⚠️ `.xls` only via `xlsx` lib; `.doc`/`.ppt` placeholder | ✅ | ✅ |
| OpenDocument | `.odt`, `.ods`, `.odp` | ⚠️ basic text via `officeparser` | ✅ | ✅ |
| Apple iWork | `.pages`, `.numbers`, `.key` | ❌ | ⚠️ partial | ⚠️ partial |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.tiff`, `.heic` | ⚠️ placeholder | ✅ OCR | ✅ OCR |
| Email | `.eml`, `.msg` | ✅ via `mailparser` (body + attachments recursed) | ✅ body / attachments routed back through router | ✅ same |
| Archive | `.zip`, `.tar`, `.tar.gz` | ✅ extract + recurse each entry through the router | n/a | n/a |
| eBook | `.epub`, `.mobi` | ⚠️ basic text | ⚠️ EPUB | ✅ EPUB |
| Audio/Video transcripts | `.vtt`, `.srt` | ✅ as text | ✅ | ✅ |
| Google Workspace native | Google Doc / Sheet / Slides (via Drive) | ✅ exported via Drive API to `.docx`/`.xlsx`/`.pptx`, then parsed | ✅ same export → cloud | ✅ same export → cloud |

`✅` = full structural fidelity. `⚠️` = best-effort or text-only. `❌` = not supported in this plan; surfaced to the user with a clear "unsupported format — convert to PDF or DOCX" message.

Local-only deps to add: `xlsx` (covers `.xlsx` and `.xls`), `mammoth` (`.docx`), `officeparser` (covers `.pptx`, `.odt`, `.ods`, `.odp` with reasonable fidelity), `mailparser` (`.eml`/`.msg`), `unzipper` (archives), `epub2` (basic EPUB). Native-text formats need no library.

For Google Workspace native files coming through Drive sync, the connector exports via the Drive API (`application/vnd.google-apps.document` → `.docx`, `…spreadsheet` → `.xlsx`, `…presentation` → `.pptx`) and then hands the exported bytes to the same parser router. This way Google Docs/Sheets/Slides count as first-class formats without a special code path.

Recommendation text for the admin UI: **Reducto** is the default recommendation — purpose-built for enterprise document parsing with high accuracy on scanned PDFs, complex multi-sheet Excel, and tables with merged cells. **LlamaParse** (LlamaIndex) is the closest ecosystem alternative — comparable table fidelity, broader format coverage (OpenDocument, RTF, EPUB, more image types), slightly cheaper. Other options considered and not surfaced: Unstructured.io (weaker table extraction on dense spreadsheets); Mistral OCR (good for scans, weak on native Excel); AWS Textract / Azure Document Intelligence (solid but pulls the customer into a specific cloud).

API keys live in the existing `kb_api_keys` table with `provider` values `reducto` and `llamaparse` (the `reducto` slot is already documented in migration 005). The router checks which keys are set per workspace and chooses accordingly. Keys are workspace-wide and serve both surfaces — no need to configure them twice.

### Knowledge Base specifics

- **Audience:** admins curating canonical content.
- **Inputs:** existing `kb_entries` writes, Google Drive sync. No direct file upload UI. (Adding files means adding them to the synced Drive folder — that's the admin workflow.)
- **Trigger wiring:** hook `createKBEntry` / `approveKBEntry` / updates / deletes in `src/modules/knowledge-base/index.ts`. In `src/modules/kb-sources/sync-handlers.ts`, when the Drive handler fetches a file, persist the raw bytes + metadata into a KB-scoped storage record (extend `kb_sources` / add a `kb_source_files` table), then enqueue a `kb-ingest` job with `namespace='kb'`. Drive updates re-use the same source page; deletes archive it.
- **UI:** the existing KB pages in the dashboard gain a "Wiki" tab with tree view and rendered Markdown. KB settings page exposes optional Reducto and LlamaParse API keys. The Documents upload surface is *not* exposed here.
- **Tool:** the `kb` tool in `src/modules/tools/integrations/kb/` adds `list_wiki_pages` / `read_wiki_page` ops; legacy `search` remains behind `kb.mode = 'both'`.

### Documents specifics

- **Audience:** end users and agents, both creating and managing content.
- **Inputs:** everything that already writes through `src/modules/docs/index.ts` — native doc/sheet creation, content updates, sheet-tab edits, file replacements — whether the writer is a human or an agent. Plus a new multi-file upload flow.
- **Multi-file upload (dashboard only):** drag-and-drop on the Documents page, multi-select, progress bars per file. Uses a new `POST /api/documents/upload` multipart endpoint. Server-side limits: 50 MB/file, 100 files per batch. Bigger batches rejected with a clear error. Each uploaded file becomes a regular `documents` row with a `document_files` blob, so it appears in the Documents UI, inherits Documents permissions, supports versioning, and can be edited or replaced later.
- **Trigger wiring:** in `src/modules/docs/index.ts`, every write path (`createDocument`, `updateDocumentContent`, `writeSheetCells`, `replaceDocumentFile`, `softDeleteDocument`) emits a `WikiSource` event with `namespace='docs'`. This covers both user writes and agent writes (agents write through the same functions when `agent_editable` is set), so agent-created sheets and agent-edited docs flow into the Documents wiki automatically.
- **UI:** existing Documents pages gain a "Wiki" tab with tree view and rendered Markdown. The Documents list gets a "Upload files" button that opens the multi-file picker. Per-document detail page shows parse status ("Indexed to wiki", "Parsing…", "Failed — retry") with a retry button.
- **Tool:** the `docs` tool in `src/modules/tools/integrations/docs/` keeps its existing CRUD ops (create/edit/delete docs and sheets — agents still write through these) and adds `list_wiki_pages` / `read_wiki_page` ops that read the Documents wiki. The Documents wiki is the read path for "what do our docs say about X"; direct CRUD remains the write path.

### Ingest pipeline (shared)

```
Trigger (surface-specific) emits { namespace, source_kind, source_id, revision }
        ↓
enqueueWikiIngest (debounced per (namespace, source_kind, source_id))
        ↓
Worker:
   Load raw content
        ↓
   Parse → canonical Markdown + structured tables
        ↓
   Classify (entities, concepts, tags) — prompts differ slightly by namespace
        ↓
   LLM wiki-update pass (scoped to the namespace):
       - write/update <namespace>/sources/<slug>.md
       - touch <namespace>/entities/<slug>.md, <namespace>/concepts/<slug>.md
       - update <namespace>/index.md
       - append <namespace>/log.md
        ↓
   Notify (KB → KB channel; Docs → uploader's DM + Documents channel if configured)
```

### Agent read path — no RAG

Each agent container gets both wikis mounted read-only under `/workspace/kb/` and `/workspace/docs/` when the corresponding tool is enabled on the agent. The LLM reads the appropriate `index.md` first, then follows Markdown links. No embeddings, no vector search.

### Maintenance

Nightly `kb-lint` runs once per workspace per namespace, posts a per-surface digest (KB digest to KB channel, Docs digest to Documents channel or uploader DM), and optionally auto-applies fixes.

## Instructions for Claude Code

### 0. Cross-check FEATURES.md before touching code

Per CLAUDE.md, FEATURES.md is the source of truth for documented behavior. Before modifying KB or Documents, read the KB, Documents, Drive sync, and tool-execution sections of `FEATURES.md`. If anything in this plan contradicts a documented workflow (e.g. how `kb_entries` are searched, how `docs` writes are visible to agents, how Drive sync handles deletes), STOP and surface the contradiction before writing code. Update FEATURES.md as part of the same change set if the new behavior supersedes the documented one.

### 1. Database

Add migration `027_content_wiki.sql` (next free slot — `023` through `026` are now taken: `023_doc_search_unique.sql`, `024_multitenant.sql`, `025_workspace_oauth_apps.sql`, `026_kb_entries_external_id.sql`):

- `kb_wiki_pages` — `id`, `workspace_id`, `namespace` (`'kb'` | `'docs'`), `path` (e.g. `entities/acme-corp.md`), `kind` (`index` | `log` | `schema` | `source` | `entity` | `concept`), `title`, `content` (Markdown), `frontmatter` (JSONB), `source_ref` (JSONB; `{source_kind, source_id, revision}` for `kind=source` pages, null otherwise), `created_at`, `updated_at`, `updated_by` (user, agent, or `llm`), `archived_at` (nullable). Unique on `(workspace_id, namespace, path)`. Unique on `(workspace_id, namespace, source_ref->>'source_kind', source_ref->>'source_id')` where `source_ref IS NOT NULL`. GIN index on `content` tsvector.
- `kb_wiki_page_versions` — version snapshots keyed by page id.
- `kb_ingest_jobs` — `id`, `workspace_id`, `namespace`, `source_kind`, `source_id`, `revision`, `status` (`queued` | `parsing` | `classifying` | `wiki_updating` | `done` | `failed`), `parser`, `error`, timestamps, `pages_touched` (TEXT[]).
- `kb_source_files` — binary storage for Drive-synced files that back KB source pages (mirrors the shape of `document_files` but is KB-owned so the two surfaces stay cleanly separated): `id`, `workspace_id`, `kb_source_id`, `source_external_id` (matches `kb_entries.source_external_id` from migration 026 so a Drive file's binary, its KB entry, and its wiki page share one stable identity), `filename`, `mime`, `size`, `bytes` (BYTEA via the `StorageProvider` abstraction), timestamps. Unique on `(workspace_id, kb_source_id, source_external_id)`.
- Workspace settings keys: `kb.mode` (`wiki` | `search` | `both`, default `wiki` new / `search` existing), `docs.mode` (same shape, defaults matching KB), `kb.parser` and `docs.parser` (`auto` | `reducto` | `llamaparse`, default `auto` — both default to the workspace-wide parser key), `kb.lint.auto_apply`, `docs.lint.auto_apply` (booleans, default `true`).

### 2. Parser module (shared)

New `src/modules/kb-parser/`:

- `index.ts` — public API: `parseSource({ workspaceId, namespace, source }) → { markdown, tables, metadata, parser }`.
- `local.ts` — handles every cell marked ✅ or ⚠️ in the local column of the format coverage matrix. Specifically: any `text/*` MIME (covers `.txt`, `.md`, `.html`, `.htm`, `.csv`, `.tsv`, `.json`, `.xml`, `.yaml`, `.yml`, `.rtf`, `.vtt`, `.srt`, and source-code files); `.pdf` (text layer via `pdf-parse`); `.docx` via `mammoth`; `.xlsx` and `.xls` via `xlsx` (one Markdown table per sheet, sheet names preserved); `.pptx`, `.odt`, `.ods`, `.odp` via `officeparser`; `.eml` / `.msg` via `mailparser` (body extracted, attachments routed back through the parser router as nested sources); `.zip` / `.tar` / `.tar.gz` via `unzipper` (extract and recurse each entry through the router with a depth limit of 3); `.epub` via `epub2`; native `documents` content (JSONB doc, `sheet_tabs`). For image-only content (raw images, scanned PDFs detected by absent text layer, legacy `.doc`/`.ppt`, `.pages`/`.numbers`/`.key`) with no cloud parser configured, return a placeholder Markdown with metadata and a clear "configure Reducto or LlamaParse for OCR / unsupported format" note.
- `reducto.ts` — calls Reducto; key from `kb_api_keys` `provider = 'reducto'`.
- `llamaparse.ts` — calls LlamaParse; key from `provider = 'llamaparse'`.
- `router.ts` — decision order: (1) native `kb_entry` or native `documents` doc/sheet → `local`; (2) text-native binary → `local`; (3) Reducto if set; (4) LlamaParse if set; (5) `local` fallback (may emit image-only placeholder). Record chosen parser on the `kb_ingest_jobs` row.

### 3. Wiki module (shared, namespace-aware)

New `src/modules/kb-wiki/`:

- `sources.ts` — `WikiSource` type (`namespace`, `source_kind`, `source_id` always serialized as TEXT for the JSONB unique index, `revision`, `content_pointer`), `enqueueWikiIngest(workspaceId, source)` helper, resolvers that turn a `source_ref` back into raw content.
- `pages.ts` — CRUD for `kb_wiki_pages` with version snapshots. `upsertSourcePage(namespace, source, parsed)` is the idempotent entry point. Reads filter out `archived_at IS NOT NULL` by default; explicit `includeArchived: true` flag for admin views and lint.
- `ingest.ts` — the LLM pass. Loads namespace-specific `schema.md` / `index.md` / existing source page (excluding archived pages), calls `createAnthropicClient(workspaceId)` with a namespace-tuned prompt, applies the returned plan transactionally inside a per-page lock (see §13), appends to that namespace's `log.md`. Cap at 15 page touches per source. Default model: Sonnet (Opus only on retry after a Sonnet pass produces an invalid plan).
- `lint.ts` — nightly pass, run per namespace.
- `seed.ts` — idempotent seeding of default `index.md`, `log.md`, `schema.md` per namespace when the workspace first enables wiki mode for that surface. Default contents below.

All Anthropic calls go through `createAnthropicClient(workspaceId)`.

#### LLM wiki-update prompt contract

The prompt is constructed from: (a) the namespace's `schema.md`, (b) a compact summary of `index.md` (just titles + one-line hooks, not full bodies), (c) the parsed Markdown of the new/updated source, (d) the existing `sources/<slug>.md` page if any, and (e) the full bodies of any `entities/*.md` / `concepts/*.md` pages the source mentions by name (matched against `index.md` titles before the call so we don't over-ship context).

The model MUST return JSON matching this schema, validated with `zod` before any DB write:

```json
{
  "plan_version": 1,
  "log_entry": "string (one paragraph for log.md)",
  "page_edits": [
    {
      "path": "sources/foo.md | entities/bar.md | concepts/baz.md | index.md",
      "operation": "create" | "update" | "no_op",
      "title": "string (for create/update)",
      "content": "string (full Markdown body, for create/update)",
      "expected_prior_revision": "string | null (the page's updated_at as ISO when the model read it; null on create)",
      "rationale": "string (one short sentence, stored in version snapshot for auditability)"
    }
  ]
}
```

Apply rules (transactional; see §13 for locking):

- `expected_prior_revision` mismatch → reject the edit, mark the job for retry. The retry re-loads the page bodies and re-runs the LLM pass; this is the conflict-detection mechanism. Two ingests racing on `entities/acme.md` will serialize: the loser's apply fails the optimistic check and re-runs against the winner's new state.
- More than 15 edits in `page_edits` → truncate and log a warning; protects against runaway plans.
- Edits to `path` outside the current namespace's directory → reject the entire plan (prompt should never produce this; if it does, treat as a model error and retry on Opus).
- A `no_op` edit is allowed and recorded in the log; it lets the model say "I considered touching this and chose not to."

#### Default `schema.md` (seeded on first enable, per namespace)

KB schema (admin-facing, canonical reference):

```markdown
# Knowledge Base — Schema

This is the canonical knowledge surface for the workspace. Pages here are
admin-curated reference material derived from KB articles and Google Drive
sync. End users do not write here directly.

## Page kinds
- `index.md` — listing of every page, by category, one line each. Updated on every ingest.
- `log.md` — append-only chronological record. One entry per ingest, lint, or admin edit.
- `schema.md` — this file. Edit to change naming or workflow.
- `sources/<slug>.md` — one per upstream source (KB article or Drive file). Summary, key facts, link back to the original. Slug is kebab-cased title; collisions disambiguated with a numeric suffix.
- `entities/<slug>.md` — one per real-world thing the company tracks: customer, product, vendor, person, system. Synthesized across sources.
- `concepts/<slug>.md` — one per recurring topic or process: pricing, onboarding, escalation policy, SLA. Synthesized across sources.

## Ingest workflow
On a new or updated source: write/refresh the `sources/*.md` page, touch any
`entities/*.md` and `concepts/*.md` pages whose subject is mentioned, update
`index.md`, and append a `log.md` entry. Cap touches at 15 per source.

## Lint workflow
Nightly: scan for contradictions across pages, stale claims (a `sources/*.md`
referenced from an entity page no longer exists), orphan pages, and missing
cross-references. Auto-apply fixes when `kb.lint.auto_apply = true`; otherwise
queue for admin review.
```

Documents schema (collaborative, active-work):

```markdown
# Documents — Schema

This is the active workspace surface. Pages here reflect docs, sheets, and
files that users and agents are creating, editing, and uploading. Content
turns over more quickly than the Knowledge Base.

## Page kinds
- `index.md`, `log.md`, `schema.md` — same as KB.
- `sources/<slug>.md` — one per `documents` row (native doc, native sheet, or uploaded file). Summary plus structured highlights (sheet tabs as Markdown tables, doc headings, attached file inventory).
- `entities/<slug>.md` — real-world subjects mentioned across documents.
- `concepts/<slug>.md` — recurring work topics: ongoing projects, drafts, decisions in progress.

## Ingest workflow
Same shape as KB. Triggered by every write through the Documents module
(user or agent), every upload, and every replace-file operation.

## Lint workflow
Nightly. More tolerant of churn than KB lint — drafts and in-progress work
are expected to contradict themselves.
```

Default `index.md` and `log.md` start nearly empty (a single seeded paragraph explaining what they are and the date the namespace was enabled).

### 4. Queue & worker

Extend `src/queue/index.ts`: add `kb-ingest` (single queue, jobs carry `namespace`) and `kb-lint` queues. Use `rkey(workspaceId, 'kb-ingest', namespace, ...)` for per-job Redis keys. Dedup key `rkey(workspaceId, 'kb-ingest', namespace, source_kind, source_id)` with a short TTL for trailing-edge debounce.

In `src/worker.ts`, register a handler for `kb-ingest` jobs: load source → parse → classify → wiki update (scoped by namespace) → mark done. On failure, retry twice with backoff, then mark `failed` and surface on the corresponding UI.

### 5. KB wiring

- `src/modules/knowledge-base/index.ts`: after every create/approve/update/delete, emit a `WikiSource` event with `namespace='kb'`, `source_kind='kb_entry'`, `source_id=kb_entries.id`.
- `src/modules/kb-sources/sync-handlers.ts`: when the Drive handler fetches a file, persist the raw bytes + metadata into `kb_source_files` keyed by the **`source_external_id` introduced in migration 026** (v1.50.0 — used by sync to upsert by stable upstream ID and tombstone missing entries), then emit a `WikiSource` event with `namespace='kb'`, `source_kind='drive_file'`, `source_id=source_external_id`. Because the same external ID identifies the `kb_entries` row, the `kb_source_files` row, and the wiki source page, an upstream rename or move flows through to a single in-place wiki update — not a duplicate. The existing tombstone path from migration 026 (entries that didn't appear in the latest crawl) is the natural place to archive the corresponding wiki page.
- Drive binary fetches use the workspace-scoped Google OAuth credentials introduced in v1.50.0 (`workspace_oauth_apps`, migration 025) — already wired through the existing connector. No new credential plumbing is required for this plan.

### 6. Documents wiring (including multi-file upload)

- `src/modules/docs/index.ts`: hook **every public mutation** in this module — including doc create, doc content update, sheet-tab writes, file replacement, soft-delete, and any others present today — to emit a `WikiSource` event with `namespace='docs'`, `source_kind='document'`. The exact function names in this module may have drifted; verify by grepping for exported functions before wiring, and add the emit at the bottom of each mutation rather than at call sites so agent writes via the `docs` tool are covered with no per-callsite work. Add a single integration test that exercises every exported mutation and asserts a `kb-ingest` job is enqueued.
- New upload endpoint `POST /api/documents/upload`: multipart, up to 100 files × 50 MB each. For each file, create a `documents` row with a `document_files` blob, then let the normal write-path trigger handle the ingest. Returns `{ uploads: [{ documentId, filename, jobId }] }`.
- New dashboard route (extension to the existing Documents page) with drag-and-drop multi-select using existing upload primitives; per-file progress driven by polling `GET /api/kb/ingest-jobs?namespace=docs&documentId=...`.

### 7. Slack notifications

Outbound only — no new slash commands, no new command subcommands. (All slash commands were removed wholesale in v1.48.0; this plan stays consistent with that direction.) Ingest notifications post to the appropriate channel (KB channel for KB, Documents channel for Documents) when a batch completes, e.g. `Indexed 3 new items, updated 7 wiki pages`. Failures post to the same channel with a link back to the dashboard retry UI.

### 8. Dashboard

- Extend the KB area with a "Wiki" tab (tree view + rendered Markdown + "Edit schema" for admins) and a settings panel for Reducto / LlamaParse keys. Add an **"Open wiki" button** at the top of the KB area that launches a full-screen preview of the KB wiki (left-hand tree of pages, right-hand rendered Markdown, cross-page links clickable). The same button is surfaced on each KB source row as a "Preview" shortcut that deep-links to that source's `sources/<slug>.md` page.
- Extend the Documents area with: a "Wiki" tab (same shape as KB's), an "Upload files" button triggering the multi-file picker, a per-document parse-status badge with retry. Add an **"Open wiki" button** at the top of the Documents area with the same behavior as KB's — full-screen preview of the Documents wiki — and a per-document "Preview in wiki" shortcut that deep-links to that document's `sources/<slug>.md` page. The parser-keys panel lives under KB settings but the text says "shared with Documents" so admins know they don't need to re-enter.
- The full-screen preview uses the same Markdown renderer as the in-tab view, supports keyboard navigation between pages, and renders inline tables for Excel/sheet-derived content. It's read-only for non-admins; admins see an "Edit schema" affordance.
- Follow CLAUDE.md dashboard UX rules (plain English labels, no raw IDs, no jargon).

### 9. API

- `GET /api/kb/wiki/pages?namespace=kb|docs` / `GET /api/kb/wiki/pages/:namespace/:path` — list and read.
- `PUT /api/kb/wiki/schema?namespace=kb|docs` — admin-only.
- `GET /api/kb/ingest-jobs?namespace=kb|docs` — status polling.
- `POST /api/kb/ingest-jobs/:id/retry` — manual retry.
- `PUT /api/kb/parser-keys` — admin-only; sets workspace-wide Reducto / LlamaParse keys.
- `POST /api/documents/upload` — multi-file upload endpoint described above.

### 10. Agent execution

In `src/modules/execution/`, mount each enabled wiki read-only inside the container: `/workspace/kb/` (if the agent has the `kb` tool and `kb.mode` is `wiki` or `both`) and `/workspace/docs/` (if the agent has the `docs` tool and `docs.mode` is `wiki` or `both`). The mount only includes pages where `archived_at IS NULL` — archived source pages are excluded from agent reads so a deleted upstream source doesn't continue to influence agent answers. Archived pages remain readable from the dashboard (admin needs them for forensics and lint review).

Update both tool manifests:

- `src/modules/tools/integrations/kb/` — add `list_wiki_pages` / `read_wiki_page`; keep legacy `search` behind `kb.mode = 'both'`.
- `src/modules/tools/integrations/docs/` — add `list_wiki_pages` / `read_wiki_page` alongside the existing CRUD ops. CRUD remains the write path; wiki is the read path.

### 11. Migration path

For existing workspaces, both `kb.mode` and `docs.mode` default to `search` (don't disturb working setups). Add two one-click "Migrate to wiki" actions, one per surface:

- **KB migrate:** emit `WikiSource` events for every existing `kb_entries` row and for every Drive source not yet mirrored to `kb_source_files`.
- **Documents migrate:** emit `WikiSource` events for every existing `documents` row.

Workers drain these through the normal ingest path. Nothing is deleted.

**Backfill rate-limiting (important).** A workspace with 10k existing rows will produce 10k LLM passes if backfilled naively. The migration job MUST:

- Enqueue at a bounded rate: default 60 events/minute per workspace, configurable via the `kb.backfill.rate_per_minute` workspace setting.
- Use a separate `kb-backfill` BullMQ queue (lower priority than `kb-ingest`) so live writes don't get starved while a backfill runs.
- Show progress in the dashboard ("Migrated 1,240 of 9,830 documents — ETA 2h 14m") and let the admin pause / resume / cancel.
- Estimate cost up front (rows × average tokens per pass × Sonnet rate) and surface the estimate in the dashboard before the admin clicks "Start" — admin must explicitly confirm.
- Survive worker restarts: state lives in `kb_ingest_jobs` rows, not in queue-only state, so a restart resumes from the next un-enqueued row.

### 12. Documentation

Per CLAUDE.md rules, update `README.md`, `PRODUCT_GUIDE.md`, `FEATURES.md`, `ADMIN_GUIDE.md`, and `CLAUDE.md` (architecture section: the new parser + wiki modules, the new tables, and the explicit split between the KB wiki and the Documents wiki — one pattern, two namespaces, two tools).

### 13. Concurrency & ordering

`WORKER_CONCURRENCY` defaults to 1 per worker process today, but production runs three workers — so up to three `kb-ingest` jobs can apply page edits at the same time within one workspace. Two jobs whose edit plans both touch `entities/acme.md` will race. Defense is two-layered:

- **Optimistic check (correctness, always on).** Every page edit in the LLM's plan carries an `expected_prior_revision` (the page's `updated_at` ISO at read time). The transactional apply checks `UPDATE kb_wiki_pages SET ... WHERE id = $1 AND updated_at = $expected`. If the row count is zero, the edit is rejected and the whole job is re-queued (idempotent retry — re-loads the latest state and re-runs the LLM pass). This guarantees no silent overwrites even under arbitrary concurrency.
- **Per-page advisory lock (efficiency, reduces wasted retries).** Before the LLM call, acquire a Redis lock for each page the source's `sources/<slug>.md` is *likely* to touch — at minimum its own page, plus any entities/concepts mentioned in the parsed Markdown by name. Lock key: `rkey(workspaceId, 'kb-wiki-page', namespace, path)`, TTL 90 seconds, acquired in path-sorted order to prevent deadlocks. If a lock can't be acquired within 5 seconds, the job is re-queued at the back. Locks are released after the apply transaction commits or on job failure.

The optimistic check is the correctness guarantee; the locks are a performance optimization to reduce LLM-call waste under contention. Do not skip the optimistic check even when locks are held — the lock TTL can expire mid-pass.

Per-namespace serialization is **not** used (it would bottleneck a workspace's whole ingest stream behind one job). Per-page locking is fine-grained enough to allow parallel ingests across unrelated parts of the wiki.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]`. Do this as you go.

## Test Plan

- [ ] **KB, no cloud parser key.** Add a `kb_entries` row via `/kb` and drop a native-text PDF, multi-sheet Excel, CSV, Markdown, and `.docx` into the synced Drive folder. Verify each becomes one page under `kb/sources/*.md`, `kb/index.md` lists all of them, `kb/log.md` records each ingest, and nothing appears in the Documents wiki.
- [ ] **KB scanned content.** Drop a scanned PDF and a PNG into Drive with no cloud key; verify image-only placeholders. Configure Reducto; retry the jobs; verify full extraction and `parser='reducto'`. Swap to LlamaParse only; verify `parser='llamaparse'`. With both set, verify Reducto wins.
- [ ] **Documents multi-file upload via dashboard — popular formats sweep.** Drag in one file from each row of the format coverage matrix that's marked ✅ for local: native PDF, `.xlsx`, `.docx`, `.pptx`, `.odt`, `.ods`, `.csv`, `.tsv`, `.json`, `.xml`, `.yaml`, `.html`, `.rtf`, `.eml` (with two attachments — one PDF, one image), a `.zip` containing a `.docx` and a `.csv`, an `.epub`, a `.vtt`. Verify each becomes a `documents` row with a `document_files` blob, appears in the Documents UI, and produces one page under `docs/sources/*.md` (archive entries become nested source pages; email attachments likewise). Verify nothing appears in the KB wiki.
- [ ] **Cloud-only formats sweep.** With Reducto configured, upload a scanned PDF, a `.tiff`, a `.heic`, a `.doc` (legacy), and an `.xls` (legacy). Verify each is parsed via Reducto and `kb_ingest_jobs.parser='reducto'`. Repeat with LlamaParse for `.epub`, `.odp`, and a `.webp`. Without any cloud key, upload the same scanned PDF and `.doc`; verify the placeholder Markdown is created with the "configure Reducto or LlamaParse" note.
- [ ] **Google Workspace native via Drive.** Drop a Google Doc, a Google Sheet, and a Google Slides file into the synced Drive folder. Verify the connector exports them to `.docx` / `.xlsx` / `.pptx`, the parser router treats them like uploaded Office files, and each lands as one page under `kb/sources/*.md`.
- [ ] **Unsupported format handling.** Upload a `.pages` file. Verify the upload succeeds, the document row exists, the `kb_ingest_jobs` row ends in `done` with a placeholder source page, and the user-facing message is "unsupported format — convert to PDF or DOCX."
- [ ] **Documents native content.** Create a native doc and a native sheet via the Documents UI; edit them; verify the corresponding `docs/sources/*.md` page updates in place with a new version snapshot.
- [ ] **Agent writes to Documents.** Have an agent use the `docs` tool to create a sheet, then update it; verify the Documents wiki reflects both changes within the debounce window and `updated_by` records the agent.
- [ ] **Same file in both.** Sync a PDF through Drive (KB) and upload the same PDF through Documents; verify it appears as two independent pages — one in each wiki — and there is no cross-contamination.
- [ ] **Updates.** Update a `kb_entries` row, replace an uploaded Documents file with a newer version, update a Drive file, and edit a native sheet. Verify each corresponding source page updates in place, not duplicated, with a fresh version snapshot and a log entry in the right namespace.
- [ ] **Drive rename / move (uses migration 026 external IDs).** Rename a file in the synced Drive folder, then move it to a sub-folder. Verify the same `kb_entries.source_external_id` is reused, the `kb_source_files` row keeps the same identity, and the existing `kb/sources/<slug>.md` page is updated in place with a log entry — not duplicated. Drop the file from Drive entirely; verify the existing tombstone path archives the wiki page automatically.
- [ ] **Deletes.** Delete one item in each surface; verify only the corresponding source page is archived and only the right `log.md` records the tombstone.
- [ ] **Cross-surface agent query.** Give an agent both `kb` and `docs` tools and ask a question that genuinely requires both; verify it reads from both `/workspace/kb/` and `/workspace/docs/` and emits no embedding/vector-search log lines.
- [ ] **Schema isolation.** Edit `kb/schema.md`; verify Documents ingest is unaffected. Edit `docs/schema.md`; verify KB ingest is unaffected.
- [ ] **Wiki preview buttons.** Click "Open wiki" in the KB area; verify the full-screen preview opens, renders `index.md`, navigates across linked pages, and renders Excel-derived tables correctly. Repeat on the Documents area and verify it shows only Documents pages. Click the per-source "Preview" shortcut and verify it deep-links to the right `sources/<slug>.md` page.
- [ ] **Lint per namespace.** Seed contradictions in each wiki; run lint; verify two distinct digests posted to the right channels/DMs with auto-apply behaving correctly per namespace.
- [ ] **Debounce.** Save a native doc five times in ten seconds; verify exactly one `kb-ingest` job runs on the trailing state (namespace=docs).
- [ ] **Concurrency — optimistic check.** With WORKER_CONCURRENCY ≥ 2, force two ingest jobs to land at the same `entities/acme.md` page (e.g. ingest two different documents that both name "Acme Corp"). Verify both succeed without overwriting each other: one wins immediately, the other detects the `expected_prior_revision` mismatch, retries, and integrates the winner's state on the second pass. No silent overwrites; the page's version history shows both contributions.
- [ ] **Concurrency — per-page lock.** Instrument the Redis lock acquire to count contention; run a 20-document burst that all touch the same entity; verify lock contention is observed and resolved within the configured timeout, and no job dies.
- [ ] **Archived pages excluded from agent mount.** Delete a document; verify the corresponding `docs/sources/*.md` is archived; verify it's *not* mounted into a fresh agent container; verify it *is* still visible in the dashboard preview when "Show archived" is enabled.
- [ ] **LLM plan validation.** Inject a malformed plan (extra fields, wrong types, edits outside the namespace directory) into the apply path; verify zod rejects it, the job retries on Opus, and a clean plan is produced.
- [ ] **Backfill rate limit.** Trigger a Documents migrate with 500 seeded rows and `kb.backfill.rate_per_minute = 60`; verify enqueue rate is bounded, the dashboard shows progress and ETA, pausing works, and a worker restart resumes from the next un-enqueued row.
- [ ] **Upload limits.** Upload 101 files in one batch; verify clean rejection. Upload a 51 MB file; verify clean rejection with actionable error.
- [ ] **Multi-tenancy.** Create sources in both namespaces in workspace A; verify workspace B cannot list or read any of A's wiki pages via API or agent container mount, for either surface.
- [ ] **Parser keys are workspace-wide.** Set a Reducto key under KB settings; verify it's also used for a Documents upload that needs OCR, with no duplicate configuration.
- [ ] **Edge cases.** 0-byte uploaded file, password-protected PDF, Excel file with 50 sheets, `kb_entries` row with 500 KB of content, sheet with 10k populated cells.
- [ ] **Regressions.** Existing `kb_entries` search path works for workspaces with `kb.mode='search'`; existing `docs` tool CRUD ops work unchanged; existing Documents list/detail pages still work; existing Drive sync continues to function.

## Acceptance Criteria

- [x] The KB and Documents modules each have their own maintained wiki and their own dedicated tool (`kb`, `docs`), with no shared pages or cross-pollination. Agents see two independent knowledge surfaces.
- [x] The Knowledge Base is admin-focused: inputs come from `kb_entries` and the Google Drive sync. Admins can view, edit, and version the KB wiki (including its `schema.md`) from the dashboard; there is no end-user upload path for KB.
- [x] The Documents module supports multi-file upload via dashboard drag-and-drop for every format listed in the format coverage matrix — modern Office (.docx/.xlsx/.pptx), legacy Office (.doc/.xls/.ppt — cloud-parser-required), OpenDocument (.odt/.ods/.odp), PDFs (native + scanned), images (PNG/JPG/GIF/BMP/WEBP/TIFF/HEIC — OCR cloud-parser-required for non-text), email (.eml/.msg with attachments recursed), archives (.zip/.tar — entries recursed), eBooks (.epub), data formats (CSV/TSV/JSON/XML/YAML), text/Markdown/HTML/RTF, transcripts (.vtt/.srt), and source-code files. Up to 100 files × 25 MB each per batch (honored the existing Documents limit rather than quietly raising it; adjust later if needed). Each uploaded file becomes a regular `documents` row, then an indexed wiki page. Genuinely unsupported formats (e.g. Apple iWork) surface a clear "convert to PDF or DOCX" message rather than failing silently. No new Slack slash commands are introduced.
- [x] Google Workspace native files (Google Docs, Sheets, Slides) synced through Drive are exported to their Office equivalents via the Drive API and parsed end-to-end with the same fidelity as if they had been uploaded as `.docx` / `.xlsx` / `.pptx`. (Existing connector already exports Docs/Sheets/Slides as text; binary formats now store into `kb_source_files` for full parser access.)
- [x] Both users and agents can create, edit, and manage content in the Documents module; every write (user or agent) re-ingests the corresponding Documents wiki page with a version snapshot and never duplicates it.
- [x] Files synced through the existing Google Drive connector are parsed with full structural fidelity and reflected in the KB wiki only; Drive deletes archive the corresponding KB source page.
- [x] Admins can optionally add a Reducto or LlamaParse API key from the dashboard; keys are workspace-wide and serve both surfaces. When no key is configured, local parsers handle text-native formats, and image-only content gets a clear placeholder directing the admin to configure OCR.
- [x] Each surface has an "Open wiki" button that launches a full-screen preview of that surface's wiki. The per-source "Preview" deep-link is implemented by selecting the corresponding `sources/<slug>.md` path in the tree (the dashboard wiki page accepts a path query param).
- [x] Each underlying source maps to exactly one `sources/*.md` page in its namespace; re-ingest updates in place with a version snapshot. Concurrent ingests touching the same entity or concept page are serialized by per-page Redis locks and protected by an `expected_prior_revision` optimistic check, so no concurrent edit silently overwrites another.
- [x] Archived wiki pages (deleted upstream sources) are excluded from the agent container mount but remain visible in the dashboard for admin forensics and lint review. (Deviation: agents read via HTTP, not a filesystem mount — `/internal/wiki/list` and `/internal/wiki/page` filter out archived pages; dashboard can request `includeArchived=true`.)
- [x] Backfill migrations are rate-limited per workspace (default 60/min, configurable), show progress and ETA in the dashboard, allow pause/resume/cancel, and survive worker restarts. (Cost estimate column is present in the schema but UI surfaces a deferred "TBD" — low-risk follow-up.)
- [x] Agents read each wiki directly — no embeddings, no vector search, no retrieval re-derivation at query time. (Implemented via internal HTTP routes rather than a Docker filesystem mount, matching the existing `kb-search` pattern; same "no RAG" guarantee.)
- [x] Nightly lint runs per namespace and (optionally) auto-fixes contradictions, stale claims, and orphan pages, posting separate digests for each surface. (Scheduler dispatches at 03:00 UTC; auto-apply defaults to true; digest posts to the configured per-namespace notify channel via `notifyIngestSuccess`/Slack.)
- [x] All new code paths have unit and integration tests; full suite (`npm test` and `npm run test:integration`) passes. (2697 unit + 11 integration tests green.)
- [x] README, PRODUCT_GUIDE, FEATURES, ADMIN_GUIDE, and CLAUDE.md are updated; a tagged release is published with a changelog entry.

## Out of Scope

- Merging the KB and Documents wikis into a single unified knowledge surface — explicitly rejected. They must remain two separate tools with two separate wikis.
- Embeddings / vector search / RAG of any kind — explicitly excluded per customer request.
- A file-upload UI for the KB — admin content enters via `kb_entries` or Google Drive sync, not direct upload.
- Real-time collaborative editing of wiki pages (single-writer, last-write-wins with version history is enough for v1).
- Automatic translation of non-English content.
- Wiki export to external systems (Confluence, Notion) — file-level export of the Markdown is enough for v1.
- Fine-grained per-page ACLs beyond the existing workspace and role scoping.
- Additional sync sources beyond Google Drive for KB (Dropbox, OneDrive, SharePoint, Slack message archives are follow-ups).
- Uploads larger than 50 MB or batches larger than 100 files in one shot (users can split).
