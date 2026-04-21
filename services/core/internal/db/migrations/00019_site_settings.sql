-- +goose Up
CREATE TABLE IF NOT EXISTS site_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS site_content (
    key        TEXT PRIMARY KEY,
    content    JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES staff_users(id)
);

-- +goose Down
DROP TABLE IF EXISTS site_content;
DROP TABLE IF EXISTS site_settings;
