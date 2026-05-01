-- +goose Up
CREATE UNIQUE INDEX IF NOT EXISTS users_email_hmac_unique ON users (email_hmac) WHERE email_hmac IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS users_email_hmac_unique;
