-- Native Documents, Sheets & Files
-- Adds documents table (unified for doc/sheet/file types), version history,
-- sheet tabs, file storage, and full-text search indexing.

-- ── Core documents table ──
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  type TEXT NOT NULL CHECK (type IN ('doc', 'sheet', 'file')),
  title TEXT NOT NULL,
  description TEXT,
  -- For docs: Slate/Plate JSON (ProseMirror-style document tree)
  -- For sheets/files: NULL (data lives in sheet_tabs / document_files)
  content JSONB,
  mime_type TEXT,                    -- files only (e.g. 'application/pdf')
  file_size INTEGER,                -- files only (bytes)
  tags JSONB NOT NULL DEFAULT '[]', -- string array for organization
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES run_history(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL,
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('user', 'agent')),
  updated_by TEXT,
  agent_editable BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1, -- optimistic locking counter
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_workspace_type ON documents(workspace_id, type);
CREATE INDEX IF NOT EXISTS idx_documents_agent ON documents(agent_id);
CREATE INDEX IF NOT EXISTS idx_documents_workspace_created ON documents(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_workspace_archived ON documents(workspace_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_documents_title_search ON documents USING GIN (to_tsvector('english', title));

-- ── Version history (auto-populated by trigger) ──
CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content JSONB NOT NULL,             -- snapshot of doc content or serialized sheet data
  changed_by TEXT NOT NULL,
  change_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, version)
);

CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(document_id, version DESC);

-- ── Sheet tabs (sparse cell storage) ──
CREATE TABLE IF NOT EXISTS sheet_tabs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Sheet1',
  position INTEGER NOT NULL DEFAULT 0,
  -- Column definitions: [{id, name, type, width}]
  columns JSONB NOT NULL DEFAULT '[]',
  -- Sparse cell data: {"A1": {"v": "hello", "f": "=SUM(B1:B5)"}, "B2": {"v": 42}}
  data JSONB NOT NULL DEFAULT '{}',
  -- Metadata: column widths, frozen rows/cols, formatting
  metadata JSONB NOT NULL DEFAULT '{}',
  row_count INTEGER NOT NULL DEFAULT 0,
  col_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sheet_tabs_doc ON sheet_tabs(document_id, position);

-- ── File binary storage (separated for future S3 swapability) ──
CREATE TABLE IF NOT EXISTS document_files (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_files_doc ON document_files(document_id);

-- ── Full-text search index (covers doc content, sheet cells, extracted file text) ──
CREATE TABLE IF NOT EXISTS document_search (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content_text TEXT NOT NULL DEFAULT '',
  search_vector TSVECTOR
);

CREATE INDEX IF NOT EXISTS idx_document_search_vector ON document_search USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_document_search_doc ON document_search(document_id);

-- Auto-update search_vector when content_text changes
CREATE OR REPLACE FUNCTION document_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.content_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_search_vector ON document_search;
CREATE TRIGGER trg_document_search_vector
  BEFORE INSERT OR UPDATE OF content_text ON document_search
  FOR EACH ROW EXECUTE FUNCTION document_search_vector_update();
