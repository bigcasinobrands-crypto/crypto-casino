-- +goose Up
-- Idempotency key is (provider, remote_id, action, transaction_id): BlueOcean scopes financial
-- transaction_id per player remote_id; different players at the same table may share the same
-- transaction_id with different remote_id values.
-- Also ensures concurrent duplicate callbacks always see a completed row: response_json is written
-- in the same DB transaction as ledger effects (see applyBOSeamless); uniqueness must match lookup.
ALTER TABLE blueocean_wallet_transactions DROP CONSTRAINT IF EXISTS blueocean_wallet_tx_unique;
ALTER TABLE blueocean_wallet_transactions ADD CONSTRAINT blueocean_wallet_tx_unique UNIQUE (provider, remote_id, action, transaction_id);

-- +goose Down
ALTER TABLE blueocean_wallet_transactions DROP CONSTRAINT IF EXISTS blueocean_wallet_tx_unique;
ALTER TABLE blueocean_wallet_transactions ADD CONSTRAINT blueocean_wallet_tx_unique UNIQUE (provider, user_id, action, transaction_id);
