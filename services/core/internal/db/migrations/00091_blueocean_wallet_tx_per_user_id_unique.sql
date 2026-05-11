-- +goose Up
-- Idempotency for seamless wallet must be scoped to internal user_id, not remote_id alone:
-- BlueOcean may reuse transaction_id across different players at the same table; remote_id alone
-- is not a stable global key if links are mis-typed or legacy rows diverge. (provider, user_id, action, transaction_id)
-- matches ledger idempotency keys which already embed user UUID.
ALTER TABLE blueocean_wallet_transactions DROP CONSTRAINT IF EXISTS blueocean_wallet_tx_unique;
ALTER TABLE blueocean_wallet_transactions ADD CONSTRAINT blueocean_wallet_tx_unique UNIQUE (provider, user_id, action, transaction_id);

-- Prevent two internal players from sharing the same BlueOcean remote_id (financial identity collision).
CREATE UNIQUE INDEX IF NOT EXISTS blueocean_player_links_remote_player_id_norm_uidx
    ON blueocean_player_links (lower(replace(remote_player_id, '-', '')));

-- +goose Down
DROP INDEX IF EXISTS blueocean_player_links_remote_player_id_norm_uidx;
ALTER TABLE blueocean_wallet_transactions DROP CONSTRAINT IF EXISTS blueocean_wallet_tx_unique;
ALTER TABLE blueocean_wallet_transactions ADD CONSTRAINT blueocean_wallet_tx_unique UNIQUE (provider, remote_id, action, transaction_id);
