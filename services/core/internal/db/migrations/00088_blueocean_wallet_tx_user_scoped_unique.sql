-- +goose Up
-- Idempotency for seamless wallet must be per player (internal user), not per remote_id alone:
-- BlueOcean may reuse transaction_id across players at the same live table; duplicate remote_player_id
-- rows were also possible, which caused the second player to replay the first player's wallet response.
ALTER TABLE blueocean_wallet_transactions DROP CONSTRAINT IF EXISTS blueocean_wallet_tx_unique;
ALTER TABLE blueocean_wallet_transactions ADD CONSTRAINT blueocean_wallet_tx_unique UNIQUE (provider, user_id, action, transaction_id);

-- +goose Down
ALTER TABLE blueocean_wallet_transactions DROP CONSTRAINT IF EXISTS blueocean_wallet_tx_unique;
ALTER TABLE blueocean_wallet_transactions ADD CONSTRAINT blueocean_wallet_tx_unique UNIQUE (provider, remote_id, action, transaction_id);
