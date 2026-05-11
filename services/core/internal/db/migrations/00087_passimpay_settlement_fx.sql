-- +goose Up
-- PassimPay rail: internal settlement currency (EUR/USD minor) is the ledger truth;
-- crypto is the external rail. Rational FX rates map crypto minor <-> internal minor.

CREATE TABLE IF NOT EXISTS passimpay_settlement_fx (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'passimpay',
    crypto_symbol TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT '',
    internal_currency TEXT NOT NULL,
    internal_minor_per_crypto_minor_num BIGINT NOT NULL CHECK (internal_minor_per_crypto_minor_num > 0),
    internal_minor_per_crypto_minor_den BIGINT NOT NULL CHECK (internal_minor_per_crypto_minor_den > 0),
    rate_source TEXT NOT NULL DEFAULT 'manual',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, crypto_symbol, network, internal_currency)
);

CREATE INDEX IF NOT EXISTS passimpay_settlement_fx_lookup_idx
    ON passimpay_settlement_fx (provider, internal_currency, crypto_symbol, network);

ALTER TABLE payment_deposit_intents
    ADD COLUMN IF NOT EXISTS internal_ledger_currency TEXT,
    ADD COLUMN IF NOT EXISTS internal_credited_minor BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fx_internal_per_crypto_num BIGINT,
    ADD COLUMN IF NOT EXISTS fx_internal_per_crypto_den BIGINT,
    ADD COLUMN IF NOT EXISTS fx_rate_source TEXT,
    ADD COLUMN IF NOT EXISTS fx_locked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS duplicate_callback_count INT NOT NULL DEFAULT 0;

ALTER TABLE payment_deposit_callbacks
    ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE payment_withdrawals
    ADD COLUMN IF NOT EXISTS internal_ledger_currency TEXT,
    ADD COLUMN IF NOT EXISTS internal_amount_minor BIGINT,
    ADD COLUMN IF NOT EXISTS crypto_payout_minor BIGINT,
    ADD COLUMN IF NOT EXISTS fx_internal_per_crypto_num BIGINT,
    ADD COLUMN IF NOT EXISTS fx_internal_per_crypto_den BIGINT,
    ADD COLUMN IF NOT EXISTS fx_rate_source TEXT,
    ADD COLUMN IF NOT EXISTS fx_locked_at TIMESTAMPTZ;

COMMENT ON TABLE passimpay_settlement_fx IS 'Rational rates: internal_minor = floor(crypto_minor * num / den). Ops must seed rows per crypto/network/internal_ccy.';
COMMENT ON COLUMN payment_deposit_intents.internal_credited_minor IS 'Total settlement-currency minor credited to the player ledger for this intent.';
COMMENT ON COLUMN payment_withdrawals.internal_amount_minor IS 'Withdrawal amount debited from player cash in internal_ledger_currency minor units.';
COMMENT ON COLUMN payment_withdrawals.currency IS 'Crypto payout asset (PassimPay), not the ledger settlement currency.';

-- +goose Down
ALTER TABLE payment_withdrawals
    DROP COLUMN IF EXISTS fx_locked_at,
    DROP COLUMN IF EXISTS fx_rate_source,
    DROP COLUMN IF EXISTS fx_internal_per_crypto_den,
    DROP COLUMN IF EXISTS fx_internal_per_crypto_num,
    DROP COLUMN IF EXISTS crypto_payout_minor,
    DROP COLUMN IF EXISTS internal_amount_minor,
    DROP COLUMN IF EXISTS internal_ledger_currency;

ALTER TABLE payment_deposit_callbacks DROP COLUMN IF EXISTS is_duplicate;

ALTER TABLE payment_deposit_intents
    DROP COLUMN IF EXISTS duplicate_callback_count,
    DROP COLUMN IF EXISTS fx_locked_at,
    DROP COLUMN IF EXISTS fx_rate_source,
    DROP COLUMN IF EXISTS fx_internal_per_crypto_den,
    DROP COLUMN IF EXISTS fx_internal_per_crypto_num,
    DROP COLUMN IF EXISTS internal_credited_minor,
    DROP COLUMN IF EXISTS internal_ledger_currency;

DROP TABLE IF EXISTS passimpay_settlement_fx;
