-- Favourite games per authenticated user — synced across devices (localStorage alone was device-local).

-- +goose Up
CREATE TABLE IF NOT EXISTS player_favourite_games (
    user_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    game_id   TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS player_favourite_games_user_created_idx
    ON player_favourite_games (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS player_favourite_games;
