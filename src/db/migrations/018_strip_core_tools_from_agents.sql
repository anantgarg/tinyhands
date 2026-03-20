-- Remove core/builtin tool names from agents.tools arrays
-- Core tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch) are always
-- available and don't need to be listed. Also remove fake tools that never worked
-- (NotebookEdit, TodoWrite, Agent, Mcp).
UPDATE agents SET tools = COALESCE(
  (SELECT json_agg(tool)::text
   FROM json_array_elements_text(tools::json) AS tool
   WHERE tool NOT IN ('Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
                      'WebSearch', 'WebFetch', 'NotebookEdit', 'TodoWrite', 'Agent', 'Mcp')
  ),
  '[]'
)
WHERE tools IS NOT NULL AND tools != '[]' AND tools != '';

-- Set empty arrays for agents that only had core tools
UPDATE agents SET tools = '[]' WHERE tools IS NULL OR tools = 'null';
