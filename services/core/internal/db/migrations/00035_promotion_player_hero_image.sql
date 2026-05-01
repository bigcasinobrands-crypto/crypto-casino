-- +goose Up
-- Player-facing bonus card image (URL or path, e.g. /v1/uploads/... after staff upload).
ALTER TABLE promotion_versions
    ADD COLUMN IF NOT EXISTS player_hero_image_url TEXT;

COMMENT ON COLUMN promotion_versions.player_hero_image_url IS 'Shown on player My Bonuses cards; optional absolute URL or API-relative path.';

-- +goose Down
ALTER TABLE promotion_versions
    DROP COLUMN IF EXISTS player_hero_image_url;
