-- Add mentions_only column to agents
-- When true, the agent only responds to @mentions and thread replies (no relevance check)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mentions_only BOOLEAN DEFAULT FALSE;
