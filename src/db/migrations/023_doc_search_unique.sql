-- Add unique constraint on document_id for ON CONFLICT upsert support
ALTER TABLE document_search ADD CONSTRAINT uq_document_search_document_id UNIQUE (document_id);

-- Drop the now-redundant regular index since the unique constraint creates its own index
DROP INDEX IF EXISTS idx_document_search_doc;
