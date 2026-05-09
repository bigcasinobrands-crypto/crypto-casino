-- +goose Up
-- user_username sent to createPlayer (BO XAPI). loginPlayer / playerExists require this string, not the numeric BO response id.
ALTER TABLE blueocean_player_links ADD COLUMN IF NOT EXISTS xapi_user_username TEXT;

-- +goose Down
ALTER TABLE blueocean_player_links DROP COLUMN IF EXISTS xapi_user_username;
