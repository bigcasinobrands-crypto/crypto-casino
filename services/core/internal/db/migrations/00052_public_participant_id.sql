-- +goose Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_participant_id UUID;
UPDATE users SET public_participant_id = gen_random_uuid() WHERE public_participant_id IS NULL;
ALTER TABLE users ALTER COLUMN public_participant_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN public_participant_id SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS users_public_participant_id_idx ON users (public_participant_id);

-- +goose Down
DROP INDEX IF EXISTS users_public_participant_id_idx;
ALTER TABLE users DROP COLUMN IF EXISTS public_participant_id;
