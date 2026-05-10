-- +goose Up
CREATE TABLE IF NOT EXISTS maintenance_notify_subscribers (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    CONSTRAINT maintenance_notify_email_nonempty CHECK (length(trim(email)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_notify_pending ON maintenance_notify_subscribers (sent_at) WHERE sent_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS maintenance_notify_subscribers;
