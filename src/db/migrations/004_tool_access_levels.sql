-- Add access_level column to custom_tools
-- 'read-only' = safe for any user-created agent
-- 'read-write' = requires admin approval to attach to an agent
ALTER TABLE custom_tools ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'read-only';

-- Add config_json for storing tool-specific configuration (API keys, base URLs, etc.)
-- Stored in DB alongside tool code — no environment variables needed.
ALTER TABLE custom_tools ADD COLUMN IF NOT EXISTS config_json TEXT NOT NULL DEFAULT '{}';
