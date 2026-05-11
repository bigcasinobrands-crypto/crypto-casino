-- +goose Up
-- BlueOcean GameHub seamless wallet: one row per (provider, remote_id, action, transaction_id).
-- Stores exact JSON responses for operator retries (duplicate callbacks must replay byte-identical bodies).

CREATE TABLE blueocean_wallet_transactions (
    id                      BIGSERIAL PRIMARY KEY,
    provider                TEXT        NOT NULL DEFAULT 'blueocean',
    remote_id               TEXT        NOT NULL,
    user_id                 UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    username                TEXT,
    action                  TEXT        NOT NULL,
    transaction_id        TEXT        NOT NULL,
    round_id                TEXT,
    game_id                 TEXT,
    session_id              TEXT,
    gamesession_id          TEXT,
    currency                TEXT        NOT NULL DEFAULT 'EUR',
    amount_minor            BIGINT,
    amount_decimal          NUMERIC(24, 6),
    balance_before_minor    BIGINT,
    balance_after_minor     BIGINT,
    status_code             INT,
    response_json           JSONB,
    rolled_back             BOOLEAN     NOT NULL DEFAULT false,
    rollback_of_transaction_id TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT blueocean_wallet_tx_unique UNIQUE (provider, remote_id, action, transaction_id)
);

CREATE INDEX idx_blueocean_wallet_tx_user_time ON blueocean_wallet_transactions (user_id, created_at DESC);
CREATE INDEX idx_blueocean_wallet_tx_remote ON blueocean_wallet_transactions (remote_id, created_at DESC);

COMMENT ON TABLE blueocean_wallet_transactions IS 'BlueOcean seamless wallet idempotency + exact response replay (financial audit).';

-- +goose Down
DROP INDEX IF EXISTS idx_blueocean_wallet_tx_remote;
DROP INDEX IF EXISTS idx_blueocean_wallet_tx_user_time;
DROP TABLE IF EXISTS blueocean_wallet_transactions;
