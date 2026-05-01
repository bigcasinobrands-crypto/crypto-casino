-- +goose Up
-- Phase 3 PII stub: deterministic lookup for email (no plaintext index on email in future migrations).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hmac BYTEA;
COMMENT ON COLUMN users.email_hmac IS 'HMAC-SHA256(email) for lookup; backfill in dedicated migration.';

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS email_hmac;
