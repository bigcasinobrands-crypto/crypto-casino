-- +goose Up
-- Staff-only image URL; when set, overrides catalog thumbnail_url from sync for player/admin display.
ALTER TABLE games ADD COLUMN IF NOT EXISTS thumbnail_url_override TEXT;

-- +goose Down
ALTER TABLE games DROP COLUMN IF EXISTS thumbnail_url_override;
