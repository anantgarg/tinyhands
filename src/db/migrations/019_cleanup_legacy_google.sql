-- Remove legacy Google Workspace connection and tools
-- These have been replaced by google-drive, google-sheets, google-docs, gmail

-- Delete any connections for the legacy 'google' integration
DELETE FROM connections WHERE integration_id = 'google';

-- Remove legacy google-read/google-write from agents' tools arrays
UPDATE agents
SET tools = COALESCE(
  (SELECT json_agg(t)::text
   FROM json_array_elements_text(tools::json) AS t
   WHERE t::text NOT IN ('"google-read"', '"google-write"')),
  '[]'
)
WHERE tools::text LIKE '%google-read%' OR tools::text LIKE '%google-write%';

-- Delete the legacy custom tool records
DELETE FROM custom_tools WHERE name IN ('google-read', 'google-write');
