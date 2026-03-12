-- Drop agent-level permission_level column
-- Access control is now handled per-tool via integration access levels
ALTER TABLE agents DROP COLUMN IF EXISTS permission_level;
