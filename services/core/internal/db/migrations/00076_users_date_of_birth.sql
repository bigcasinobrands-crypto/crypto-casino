-- +goose Up
-- Optional player DOB for third-party integrations (e.g. Oddin userDetails) and compliance.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL;

COMMENT ON COLUMN users.date_of_birth IS 'Optional ISO date of birth; included in Oddin userDetails when set.';

-- +goose Down

ALTER TABLE users
    DROP COLUMN IF EXISTS date_of_birth;
