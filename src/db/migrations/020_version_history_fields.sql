-- Expand agent_versions to track all config changes, not just system_prompt
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS tools TEXT; -- JSON array
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS max_turns INTEGER;
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS memory_enabled BOOLEAN;
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS mentions_only BOOLEAN;
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS respond_to_all BOOLEAN;
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS default_access TEXT;
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS write_policy TEXT;
