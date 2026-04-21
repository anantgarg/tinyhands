-- Migration 027: remove stale agent_tool_connections rows for auto-configured tools.
--
-- KB (kb-search) and Documents (docs-read, docs-write) are platform-backed
-- tools with no user-supplied credentials. Earlier versions of the dashboard
-- forced a credential-mode picker for every tool, which created rows in
-- agent_tool_connections with connection_id = NULL for these tools. The
-- runtime then gated tool provisioning on those rows, breaking KB search for
-- any agent that was created before the auto-configured path was introduced.
--
-- This one-off cleanup deletes those rows. Going forward,
-- setAgentToolConnection rejects auto-configured tool names, so this state
-- cannot recur.

DELETE FROM agent_tool_connections
WHERE tool_name IN ('kb-search', 'docs-read', 'docs-write');
