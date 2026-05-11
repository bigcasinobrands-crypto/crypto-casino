-- +goose Up
-- Persist the exact ledger idempotency segment and pocket split at debit time so rollbacks
-- always reverse the real posted debits without relying on heuristic key scans.

ALTER TABLE blueocean_wallet_transactions
    ADD COLUMN IF NOT EXISTS debit_ledger_idem_suffix TEXT,
    ADD COLUMN IF NOT EXISTS debit_from_cash_minor BIGINT,
    ADD COLUMN IF NOT EXISTS debit_from_bonus_minor BIGINT;

COMMENT ON COLUMN blueocean_wallet_transactions.debit_ledger_idem_suffix IS
    'Ledger idempotency segment used for game.debit (same string embedded in blueocean:{user}:{remote}:debit:{suffix}:{pocket}).';

-- +goose Down
ALTER TABLE blueocean_wallet_transactions
    DROP COLUMN IF EXISTS debit_from_bonus_minor,
    DROP COLUMN IF EXISTS debit_from_cash_minor,
    DROP COLUMN IF EXISTS debit_ledger_idem_suffix;
