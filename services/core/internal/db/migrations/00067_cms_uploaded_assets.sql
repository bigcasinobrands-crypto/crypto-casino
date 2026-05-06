-- +goose Up
CREATE TABLE IF NOT EXISTS cms_uploaded_assets (
    id           TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    data         BYTEA NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID REFERENCES staff_users(id)
);

CREATE INDEX IF NOT EXISTS cms_uploaded_assets_created_at_idx
    ON cms_uploaded_assets (created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS cms_uploaded_assets_created_at_idx;
DROP TABLE IF EXISTS cms_uploaded_assets;
