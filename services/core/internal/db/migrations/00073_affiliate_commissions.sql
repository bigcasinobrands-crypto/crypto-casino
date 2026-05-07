-- +goose Up
-- 00073: enterprise affiliate commission ledger.
--
-- The casino tracks affiliate referrals via traffic_sessions (referrer_host /
-- utm fields) but historically there was no first-class "affiliate" entity,
-- no commission accrual record, and no payout state. This migration adds:
--
--   1. affiliate_partners — one row per partner, with a unique referral_code
--      that links inbound traffic. Owned by an existing user record.
--   2. affiliate_commission_grants — one row per accrued commission event
--      (typically one per day per (partner, currency) bucket). Idempotency
--      key prevents the worker from double-accruing on retry.
--
-- All payouts are recorded against the central ledger using
-- entry_type='affiliate.commission' (debit on house, credit to partner cash)
-- when the operator actually pays the partner. Until then the grant sits in
-- 'pending' status and shows up as outstanding liability in the affiliate
-- admin dashboard.

CREATE TABLE IF NOT EXISTS affiliate_partners (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    referral_code       TEXT NOT NULL UNIQUE,
    display_name        TEXT NOT NULL DEFAULT '',
    -- revenue_share_bps: basis points of NGR (10000 = 100%). Default 0 means
    -- the partner exists in our system but earns nothing until configured.
    revenue_share_bps   INTEGER NOT NULL DEFAULT 0
        CHECK (revenue_share_bps >= 0 AND revenue_share_bps <= 5000),
    status              TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','suspended','terminated')),
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliate_partners_status_idx
    ON affiliate_partners (status);

CREATE TABLE IF NOT EXISTS affiliate_commission_grants (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id               UUID NOT NULL REFERENCES affiliate_partners(id) ON DELETE RESTRICT,
    -- Bucket key — typically 'YYYY-MM-DD' for daily accrual but kept generic
    -- so monthly or per-deposit accrual modes can use the same table.
    accrual_period           TEXT NOT NULL,
    currency                 TEXT NOT NULL,
    referred_user_count      INTEGER NOT NULL DEFAULT 0,
    referred_ngr_minor       BIGINT NOT NULL DEFAULT 0,
    commission_minor         BIGINT NOT NULL DEFAULT 0,
    -- pending: accrued, not yet paid out via ledger.
    -- paid:    ledger entry posted; commission_minor credited to partner cash.
    -- voided:  manually voided by operator; commission never paid.
    status                   TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','paid','voided')),
    paid_at                  TIMESTAMPTZ NULL,
    paid_idempotency_key     TEXT NULL UNIQUE,
    metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (partner_id, accrual_period, currency)
);

CREATE INDEX IF NOT EXISTS affiliate_commission_grants_status_idx
    ON affiliate_commission_grants (status, created_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_commission_grants_partner_idx
    ON affiliate_commission_grants (partner_id, created_at DESC);

-- Tracks which user was referred by which partner. We pin this at the moment
-- of registration (or first deposit, whichever the orchestrator chooses),
-- not on every login, so the attribution is stable across the player's life.
CREATE TABLE IF NOT EXISTS affiliate_referrals (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    partner_id   UUID NOT NULL REFERENCES affiliate_partners(id) ON DELETE RESTRICT,
    code         TEXT NOT NULL,
    attributed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliate_referrals_partner_idx
    ON affiliate_referrals (partner_id);
