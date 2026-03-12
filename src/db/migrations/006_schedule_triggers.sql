-- Schedule triggers: add last_fired_at column and index for schedule trigger queries
ALTER TABLE triggers ADD COLUMN IF NOT EXISTS last_fired_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_triggers_schedule ON triggers(trigger_type) WHERE trigger_type = 'schedule';
