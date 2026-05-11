-- +goose Up
ALTER TABLE blueocean_wallet_transactions
    ADD COLUMN IF NOT EXISTS rollback_target_action TEXT;

COMMENT ON COLUMN blueocean_wallet_transactions.rollback_target_action IS
    'When action=rollback: whether the financial row reversed was debit or credit.';

-- +goose Down
ALTER TABLE blueocean_wallet_transactions DROP COLUMN IF EXISTS rollback_target_action;
