-- +goose Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx ON users (lower(username)) WHERE username IS NOT NULL AND username <> '';

-- +goose Down
DROP INDEX IF EXISTS users_username_unique_idx;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE users DROP COLUMN IF EXISTS username;
