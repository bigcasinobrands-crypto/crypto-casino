-- +goose Up
-- Bonus Engine: optional classifier for promotion versions (wizard / registry).
ALTER TABLE promotion_versions
    ADD COLUMN IF NOT EXISTS bonus_type TEXT;

COMMENT ON COLUMN promotion_versions.bonus_type IS 'Logical bonus family id (e.g. deposit_match, free_spins_only); drives operator forms and evaluators.';

-- +goose Down
ALTER TABLE promotion_versions DROP COLUMN IF EXISTS bonus_type;
