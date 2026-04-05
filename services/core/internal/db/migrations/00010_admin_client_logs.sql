-- +goose Up
-- Client-reported admin UI diagnostics; retained 90 days (purge job + list filter).
CREATE TABLE admin_client_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_user_id UUID NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    severity TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
    code TEXT NOT NULL DEFAULT '',
    http_status INT NOT NULL DEFAULT 0,
    message TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    request_id TEXT,
    detail TEXT,
    user_agent TEXT,
    client_build TEXT
);

CREATE INDEX admin_client_logs_created_at_idx ON admin_client_logs (created_at DESC);
CREATE INDEX admin_client_logs_staff_created_idx ON admin_client_logs (staff_user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS admin_client_logs;
