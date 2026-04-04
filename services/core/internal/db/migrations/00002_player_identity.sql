-- +goose Up
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE player_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX player_sessions_refresh_token_hash_idx ON player_sessions (refresh_token_hash);
CREATE INDEX player_sessions_user_id_idx ON player_sessions (user_id);

-- +goose Down
DROP TABLE IF EXISTS player_sessions;
DROP TABLE IF EXISTS users;
