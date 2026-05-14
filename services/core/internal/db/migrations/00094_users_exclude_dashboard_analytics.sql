-- +goose Up
-- Exclude specific accounts (BlueOcean API sandboxes, internal testers) from
-- production dashboard NGR/GGR and related ledger-backed KPI aggregates.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS exclude_from_dashboard_analytics BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.exclude_from_dashboard_analytics IS
    'When true, ledger rows for this user are omitted from admin NGR/GGR, active-wager counts, and GGR charts (except house provider.fee lines must never be flagged).';

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS exclude_from_dashboard_analytics;
