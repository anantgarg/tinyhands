-- Add channel_ids array column to support agents in multiple channels
ALTER TABLE agents ADD COLUMN IF NOT EXISTS channel_ids TEXT[] DEFAULT '{}';

-- Backfill channel_ids from existing channel_id
UPDATE agents SET channel_ids = ARRAY[channel_id] WHERE channel_ids = '{}' AND channel_id IS NOT NULL;

-- Create index for efficient channel lookup
CREATE INDEX IF NOT EXISTS idx_agents_channel_ids ON agents USING GIN (channel_ids);
