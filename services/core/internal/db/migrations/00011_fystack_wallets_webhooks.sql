-- +goose Up
CREATE TABLE fystack_wallets (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    provider_wallet_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    raw JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX fystack_wallets_provider_idx ON fystack_wallets (provider_wallet_id);

CREATE TABLE fystack_webhook_deliveries (
    id BIGSERIAL PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    resource_id TEXT,
    processed BOOLEAN NOT NULL DEFAULT false,
    raw JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX fystack_webhook_deliveries_created_idx ON fystack_webhook_deliveries (created_at DESC);

ALTER TABLE fystack_checkouts ADD COLUMN IF NOT EXISTS provider_checkout_id TEXT;
ALTER TABLE fystack_checkouts ADD COLUMN IF NOT EXISTS checkout_url TEXT;
ALTER TABLE fystack_checkouts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS fystack_checkouts_user_created_idx ON fystack_checkouts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fystack_payments_status_created_idx ON fystack_payments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS fystack_withdrawals_status_created_idx ON fystack_withdrawals (status, created_at DESC);

-- Treasury wallet id for outbound withdrawals (optional env-driven)
ALTER TABLE fystack_withdrawals ADD COLUMN IF NOT EXISTS provider_withdrawal_id TEXT;
ALTER TABLE fystack_withdrawals ADD COLUMN IF NOT EXISTS fystack_asset_id TEXT;

-- +goose Down
ALTER TABLE fystack_withdrawals DROP COLUMN IF EXISTS fystack_asset_id;
ALTER TABLE fystack_withdrawals DROP COLUMN IF EXISTS provider_withdrawal_id;
ALTER TABLE fystack_checkouts DROP COLUMN IF EXISTS expires_at;
ALTER TABLE fystack_checkouts DROP COLUMN IF EXISTS checkout_url;
ALTER TABLE fystack_checkouts DROP COLUMN IF EXISTS provider_checkout_id;
DROP TABLE IF EXISTS fystack_webhook_deliveries;
DROP TABLE IF EXISTS fystack_wallets;
