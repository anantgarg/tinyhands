-- ── Migration 027: LLM-curated content wiki for KB and Documents ──
--
-- Plan 016. Two parallel "wikis" (one per content surface — knowledge base
-- and documents), each maintained by an LLM ingest pass that runs on every
-- write to the underlying source. Pages are namespaced by surface so the
-- two never cross-pollinate, but storage and the parser/ingest pipeline
-- are shared.
--
-- See .bake/tasks/plans/plan-016.md for the full design.

-- Wiki pages ─────────────────────────────────────────────────────────────
-- One row per Markdown page. `kind` distinguishes the structural pages
-- (index/log/schema) from synthesized pages (sources/entities/concepts).
-- `source_ref` is non-null only for kind='source' pages and links the page
-- back to the originating record (kb_entry, document, or drive_file). The
-- partial unique index on source_ref guarantees one wiki page per
-- underlying source per namespace.
CREATE TABLE IF NOT EXISTS kb_wiki_pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  namespace TEXT NOT NULL,                      -- 'kb' | 'docs'
  path TEXT NOT NULL,                           -- e.g. 'entities/acme-corp.md'
  kind TEXT NOT NULL,                           -- 'index' | 'log' | 'schema' | 'source' | 'entity' | 'concept'
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  frontmatter JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_ref JSONB,                             -- {source_kind, source_id, revision} for kind='source'
  updated_by TEXT NOT NULL DEFAULT 'llm',       -- user id, agent id, or 'llm'
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_wiki_pages_path_uniq
  ON kb_wiki_pages (workspace_id, namespace, path);

-- Partial unique on source identity. JSONB extraction casts to text so the
-- index is deterministic even when the JSON contains numeric source_ids.
CREATE UNIQUE INDEX IF NOT EXISTS kb_wiki_pages_source_uniq
  ON kb_wiki_pages (workspace_id, namespace, (source_ref->>'source_kind'), (source_ref->>'source_id'))
  WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS kb_wiki_pages_namespace_kind
  ON kb_wiki_pages (workspace_id, namespace, kind)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS kb_wiki_pages_search
  ON kb_wiki_pages USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

-- Page versions ──────────────────────────────────────────────────────────
-- Snapshot of the page on every write. Mirrors document_versions/kb_chunks.
CREATE TABLE IF NOT EXISTS kb_wiki_page_versions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES kb_wiki_pages(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  frontmatter JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT,                               -- one-sentence "why" the LLM gave for the edit
  changed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_wiki_page_versions_uniq
  ON kb_wiki_page_versions (page_id, version);

-- Ingest jobs ────────────────────────────────────────────────────────────
-- Tracks the lifecycle of a single source's pass through the wiki pipeline.
-- Survives restarts so the dashboard can show progress and the worker can
-- resume backfills.
CREATE TABLE IF NOT EXISTS kb_ingest_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  source_kind TEXT NOT NULL,                    -- 'kb_entry' | 'document' | 'drive_file'
  source_id TEXT NOT NULL,                      -- always TEXT for the JSONB unique check to match
  revision TEXT,                                -- monotonic per-source token (e.g. updated_at iso)
  status TEXT NOT NULL DEFAULT 'queued',        -- queued|parsing|classifying|wiki_updating|done|failed
  parser TEXT,                                  -- 'local' | 'reducto' | 'llamaparse'
  pages_touched TEXT[] NOT NULL DEFAULT '{}',
  error TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  triggered_by TEXT,                            -- user/agent id or 'system'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kb_ingest_jobs_workspace_status
  ON kb_ingest_jobs (workspace_id, namespace, status, created_at DESC);

CREATE INDEX IF NOT EXISTS kb_ingest_jobs_source
  ON kb_ingest_jobs (workspace_id, namespace, source_kind, source_id, created_at DESC);

-- Drive-source binary cache ──────────────────────────────────────────────
-- Holds the raw bytes for KB-side Drive files so re-parsing doesn't have
-- to round-trip Google every time. Keyed by source_external_id (the same
-- ID kb_entries.source_external_id and the wiki source page reference)
-- so a Drive rename, move, or content change reuses one row.
CREATE TABLE IF NOT EXISTS kb_source_files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kb_source_id TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_source_files_uniq
  ON kb_source_files (workspace_id, kb_source_id, source_external_id);

-- Backfill progress ──────────────────────────────────────────────────────
-- Lets the dashboard show ETA and survives restarts so a long-running
-- migration resumes from where it left off.
CREATE TABLE IF NOT EXISTS kb_wiki_backfills (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending|running|paused|completed|cancelled
  total INTEGER NOT NULL DEFAULT 0,
  enqueued INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  rate_per_minute INTEGER NOT NULL DEFAULT 60,
  estimated_cost_usd NUMERIC(10, 4),
  cursor TEXT,                                  -- next source id to enqueue
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_wiki_backfills_active
  ON kb_wiki_backfills (workspace_id, namespace)
  WHERE status IN ('pending', 'running', 'paused');
