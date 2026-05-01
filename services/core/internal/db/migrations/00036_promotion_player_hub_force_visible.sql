-- +goose Up
-- When true, /v1/rewards/hub lists this offer for all players (ignores schedule, segment, trigger-type gates).
-- Still requires a published version and grants not paused. Set by admin "Player hub" ON; cleared on OFF or pause.
ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS player_hub_force_visible BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN promotions.player_hub_force_visible IS 'Admin hub boost: list in available_offers despite schedule/segment/trigger filters.';

-- +goose Down
ALTER TABLE promotions DROP COLUMN IF EXISTS player_hub_force_visible;
