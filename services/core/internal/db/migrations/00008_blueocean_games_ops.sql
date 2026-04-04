-- +goose Up
ALTER TABLE games ADD COLUMN IF NOT EXISTS bog_game_id INT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS id_hash TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_type TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS provider_system TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS is_new BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS featurebuy_supported BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS play_for_fun_supported BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS lobby_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE games ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS games_id_hash_unique_idx ON games (id_hash) WHERE id_hash IS NOT NULL AND id_hash <> '';
CREATE INDEX IF NOT EXISTS games_game_type_idx ON games (game_type);
CREATE INDEX IF NOT EXISTS games_provider_system_idx ON games (provider_system);
CREATE INDEX IF NOT EXISTS games_hidden_idx ON games (hidden);

CREATE TABLE blueocean_integration_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_sync_at TIMESTAMPTZ,
    last_sync_error TEXT,
    last_sync_upserted INT,
    last_sync_currency TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO blueocean_integration_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE blueocean_player_links (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    remote_player_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_launches (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    game_id TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX game_launches_user_created_idx ON game_launches (user_id, created_at DESC);

CREATE TABLE game_disputes (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    game_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX game_disputes_status_idx ON game_disputes (status, created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS self_excluded_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_closed_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS account_closed_at;
ALTER TABLE users DROP COLUMN IF EXISTS self_excluded_until;
DROP TABLE IF EXISTS game_disputes;
DROP TABLE IF EXISTS game_launches;
DROP TABLE IF EXISTS blueocean_player_links;
DROP TABLE IF EXISTS blueocean_integration_state;
DROP INDEX IF EXISTS games_hidden_idx;
DROP INDEX IF EXISTS games_provider_system_idx;
DROP INDEX IF EXISTS games_game_type_idx;
DROP INDEX IF EXISTS games_id_hash_unique_idx;
ALTER TABLE games DROP COLUMN IF EXISTS hidden_reason;
ALTER TABLE games DROP COLUMN IF EXISTS hidden;
ALTER TABLE games DROP COLUMN IF EXISTS lobby_tags;
ALTER TABLE games DROP COLUMN IF EXISTS play_for_fun_supported;
ALTER TABLE games DROP COLUMN IF EXISTS featurebuy_supported;
ALTER TABLE games DROP COLUMN IF EXISTS is_new;
ALTER TABLE games DROP COLUMN IF EXISTS provider_system;
ALTER TABLE games DROP COLUMN IF EXISTS game_type;
ALTER TABLE games DROP COLUMN IF EXISTS id_hash;
ALTER TABLE games DROP COLUMN IF EXISTS bog_game_id;
