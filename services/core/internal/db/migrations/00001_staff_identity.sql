-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE staff_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE staff_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_user_id UUID NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX staff_sessions_refresh_token_hash_idx ON staff_sessions (refresh_token_hash);
CREATE INDEX staff_sessions_staff_user_id_idx ON staff_sessions (staff_user_id);

CREATE TABLE admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    staff_user_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_log_created_at_idx ON admin_audit_log (created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS admin_audit_log;
DROP TABLE IF EXISTS staff_sessions;
DROP TABLE IF EXISTS staff_users;
