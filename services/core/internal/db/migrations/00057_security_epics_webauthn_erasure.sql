-- +goose Up
-- Staff MFA (WebAuthn) + compliance erasure job ledger.
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS mfa_webauthn_enforced BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS staff_webauthn_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_user_id UUID NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL,
    credential_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT staff_webauthn_credentials_cred_id_uniq UNIQUE (credential_id)
);

CREATE INDEX IF NOT EXISTS staff_webauthn_credentials_staff_idx ON staff_webauthn_credentials (staff_user_id);

CREATE TABLE IF NOT EXISTS compliance_erasure_jobs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    requested_by_staff_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    worker_note TEXT,
    error_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS compliance_erasure_jobs_status_idx ON compliance_erasure_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS compliance_erasure_jobs_user_idx ON compliance_erasure_jobs (user_id);

-- +goose Down
DROP TABLE IF EXISTS compliance_erasure_jobs;
DROP TABLE IF EXISTS staff_webauthn_credentials;
ALTER TABLE staff_users DROP COLUMN IF EXISTS mfa_webauthn_enforced;
