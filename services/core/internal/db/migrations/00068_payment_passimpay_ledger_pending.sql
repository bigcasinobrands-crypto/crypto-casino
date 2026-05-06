-- +goose Up
-- PassimPay payment orchestration tables + ledger pocket for withdrawals pending settlement.

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_pocket_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_pocket_check
    CHECK (pocket IN ('cash', 'bonus_locked', 'pending_withdrawal'));

COMMENT ON COLUMN ledger_entries.pocket IS 'cash + bonus_locked = playable pending_withdrawal = locked for outbound crypto settlement';

CREATE TABLE payment_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_currencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_payment_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    network TEXT NULL,
    decimals INT NOT NULL DEFAULT 18,
    min_deposit_minor BIGINT NULL,
    min_withdraw_minor BIGINT NULL,
    withdraw_enabled BOOLEAN NOT NULL DEFAULT false,
    deposit_enabled BOOLEAN NOT NULL DEFAULT true,
    requires_tag BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_payment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_currencies_provider_symbol_net_idx
    ON payment_currencies (provider, symbol, COALESCE(network, ''));

CREATE TABLE payment_deposit_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'h2h',
    provider_order_id TEXT NOT NULL UNIQUE,
    provider_payment_id TEXT NULL,
    requested_amount_minor BIGINT NULL,
    credited_amount_minor BIGINT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL,
    network TEXT NULL,
    deposit_address TEXT NULL,
    deposit_tag TEXT NULL,
    invoice_url TEXT NULL,
    invoice_expires_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'CREATED',
    ledger_transaction_marker TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payment_deposit_intents_user_idx ON payment_deposit_intents (user_id, created_at DESC);

CREATE TABLE payment_deposit_callbacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_event_id TEXT NULL,
    provider_order_id TEXT NULL,
    tx_hash TEXT NULL,
    payment_id TEXT NULL,
    currency TEXT NULL,
    amount_raw TEXT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    signature_valid BOOLEAN NOT NULL DEFAULT false,
    processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
    error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX payment_deposit_callbacks_provider_event_uidx ON payment_deposit_callbacks (provider, provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE UNIQUE INDEX payment_deposit_callbacks_provider_tx_uidx ON payment_deposit_callbacks (provider, tx_hash) WHERE tx_hash IS NOT NULL;

CREATE TABLE payment_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    withdrawal_id UUID NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_order_id TEXT NOT NULL UNIQUE,
    provider_transaction_id TEXT NULL UNIQUE,
    provider_payment_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    network TEXT NULL,
    amount_minor BIGINT NOT NULL,
    destination_address TEXT NOT NULL,
    destination_tag TEXT NULL,
    status TEXT NOT NULL,
    ledger_lock_idem_suffix TEXT NOT NULL,
    ledger_final_idem_suffix TEXT NULL,
    tx_hash TEXT NULL,
    confirmations INT NULL,
    failure_reason TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payment_withdrawals_user_idx ON payment_withdrawals (user_id, created_at DESC);

CREATE TABLE payment_provider_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    request_body JSONB NOT NULL,
    response_body JSONB NULL,
    status_code INT NULL,
    success BOOLEAN NOT NULL DEFAULT false,
    error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE processed_callbacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    callback_type TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_body JSONB NULL,
    status TEXT NOT NULL,
    processed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, callback_type, provider_event_id)
);

INSERT INTO payment_providers (provider, status, is_default, config)
VALUES ('passimpay', 'active', true, '{}'::jsonb)
ON CONFLICT (provider) DO NOTHING;

INSERT INTO payment_providers (provider, status, is_default, config)
VALUES ('fystack', 'legacy_readonly', false, '{"legacy":true}'::jsonb)
ON CONFLICT (provider) DO NOTHING;

-- +goose Down
DROP INDEX IF EXISTS payment_currencies_provider_symbol_net_idx;
DROP TABLE IF EXISTS processed_callbacks;
DROP TABLE IF EXISTS payment_provider_requests;
DROP TABLE IF EXISTS payment_withdrawals;
DROP TABLE IF EXISTS payment_deposit_callbacks;
DROP TABLE IF EXISTS payment_deposit_intents;
DROP TABLE IF EXISTS payment_currencies;
DELETE FROM payment_providers WHERE provider IN ('passimpay', 'fystack');
DROP TABLE IF EXISTS payment_providers;

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_pocket_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_pocket_check
    CHECK (pocket IN ('cash', 'bonus_locked'));
