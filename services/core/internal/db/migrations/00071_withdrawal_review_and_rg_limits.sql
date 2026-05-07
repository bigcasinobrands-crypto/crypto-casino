-- +goose Up
-- Withdrawal admin review fields (P5) and player responsible-gambling limits (E-3).

-- P5: Track admin approve/reject decisions on payment_withdrawals. Approve sets
-- reviewed_at + approved_by_staff_user_id and locks the row from being rejected
-- afterwards. Reject sets reviewed_at + admin_decision='rejected' and unlocks the
-- ledger lock via the standard compensation path.
ALTER TABLE payment_withdrawals
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS reviewed_by_staff_user_id UUID NULL,
    ADD COLUMN IF NOT EXISTS admin_decision TEXT NULL;

CREATE INDEX IF NOT EXISTS payment_withdrawals_reviewed_at_idx
    ON payment_withdrawals (reviewed_at)
    WHERE reviewed_at IS NOT NULL;

-- E-3: Player Responsible Gambling (RG) limits. Players (and admins) can set
-- daily/weekly/monthly deposit caps, daily/weekly loss caps, session duration
-- caps, and cooling-off periods. Enforced at deposit webhook, withdrawal request,
-- and (loss limits) by the worker.
CREATE TABLE IF NOT EXISTS player_rg_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'deposit_daily','deposit_weekly','deposit_monthly',
    -- 'loss_daily','loss_weekly','loss_monthly',
    -- 'session_duration_minutes','cooling_off_until'
    limit_type TEXT NOT NULL,
    amount_minor BIGINT NULL,        -- monetary limits (minor units)
    duration_minutes INT NULL,        -- session duration in minutes
    cooling_off_until TIMESTAMPTZ NULL, -- cooling-off period end
    active_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_until TIMESTAMPTZ NULL,    -- NULL = permanent
    set_by TEXT NOT NULL DEFAULT 'player', -- 'player' or 'admin'
    set_by_staff_user_id UUID NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_rg_limits_user_idx ON player_rg_limits (user_id, limit_type, active_from DESC);

-- One active limit per (user, limit_type). Newer rows shadow older ones via active_from.
CREATE UNIQUE INDEX IF NOT EXISTS player_rg_limits_active_unique
    ON player_rg_limits (user_id, limit_type)
    WHERE active_until IS NULL;

-- E-9: Financial DLQ for multi-step financial workflows that can leave partial state.
CREATE TABLE IF NOT EXISTS financial_failed_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | failed | resolved
    resolved_at TIMESTAMPTZ NULL,
    resolved_by_staff_user_id UUID NULL,
    related_id TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_failed_jobs_status_idx
    ON financial_failed_jobs (status, next_retry_at)
    WHERE status IN ('pending','in_progress');

-- E-4: KYC status field on users. Required before large withdrawals.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS kyc_reviewed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS kyc_reviewed_by_staff_user_id UUID NULL,
    ADD COLUMN IF NOT EXISTS kyc_reject_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS users_kyc_status_idx ON users (kyc_status);
