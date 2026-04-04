-- +goose Up
CREATE TABLE provider_lobby_settings (
    provider TEXT PRIMARY KEY,
    lobby_hidden BOOLEAN NOT NULL DEFAULT false,
    hidden_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX provider_lobby_settings_lobby_hidden_idx ON provider_lobby_settings (lobby_hidden)
    WHERE lobby_hidden = true;

-- Dev seed account: promote to superadmin so catalog controls work after RBAC change.
UPDATE staff_users SET role = 'superadmin' WHERE lower(email) = lower('admin@twox.gg');

-- +goose Down
DROP TABLE IF EXISTS provider_lobby_settings;
