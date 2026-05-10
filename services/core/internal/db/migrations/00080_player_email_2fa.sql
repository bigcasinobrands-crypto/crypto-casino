-- +goose Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_2fa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_2fa_admin_locked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS player_email_otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('login', 'enable')),
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts_remaining SMALLINT NOT NULL DEFAULT 5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_email_otp_challenges_user_purpose_idx
    ON player_email_otp_challenges (user_id, purpose);

-- +goose Down
DROP TABLE IF EXISTS player_email_otp_challenges;
ALTER TABLE users DROP COLUMN IF EXISTS email_2fa_admin_locked;
ALTER TABLE users DROP COLUMN IF EXISTS email_2fa_enabled;
