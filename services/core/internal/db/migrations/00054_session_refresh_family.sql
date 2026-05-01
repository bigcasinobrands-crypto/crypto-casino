-- +goose Up
ALTER TABLE player_sessions ADD COLUMN IF NOT EXISTS family_id UUID;
UPDATE player_sessions SET family_id = gen_random_uuid() WHERE family_id IS NULL;
ALTER TABLE player_sessions ALTER COLUMN family_id SET NOT NULL;

ALTER TABLE staff_sessions ADD COLUMN IF NOT EXISTS family_id UUID;
UPDATE staff_sessions SET family_id = gen_random_uuid() WHERE family_id IS NULL;
ALTER TABLE staff_sessions ALTER COLUMN family_id SET NOT NULL;

-- +goose Down
ALTER TABLE player_sessions DROP COLUMN IF EXISTS family_id;
ALTER TABLE staff_sessions DROP COLUMN IF EXISTS family_id;
