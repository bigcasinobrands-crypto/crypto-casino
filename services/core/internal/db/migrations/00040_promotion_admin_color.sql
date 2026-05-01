-- +goose Up
ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS admin_color TEXT;

ALTER TABLE promotions
    DROP CONSTRAINT IF EXISTS promotions_admin_color_hex_chk;

ALTER TABLE promotions
    ADD CONSTRAINT promotions_admin_color_hex_chk
    CHECK (admin_color IS NULL OR admin_color ~ '^#[0-9A-Fa-f]{6}$');

-- +goose Down
ALTER TABLE promotions
    DROP CONSTRAINT IF EXISTS promotions_admin_color_hex_chk;

ALTER TABLE promotions
    DROP COLUMN IF EXISTS admin_color;
