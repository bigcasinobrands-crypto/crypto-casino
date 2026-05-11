-- +goose Up
-- Normalize stored player emails so uniqueness matches real mailboxes (case + surrounding space).
UPDATE users SET email = lower(trim(both from email)) WHERE email IS NOT NULL;

-- Defense in depth: block two rows whose trimmed-lowercase emails are equal even if application regressed.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_uidx ON users ((lower(trim(both from email))));

-- +goose Down
DROP INDEX IF EXISTS users_email_normalized_uidx;
