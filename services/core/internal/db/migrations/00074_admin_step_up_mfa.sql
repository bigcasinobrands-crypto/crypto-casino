-- +goose Up
-- 00074: enterprise step-up MFA for high-value admin actions.
--
-- Some admin actions (deposit reversal, large manual bonus grants, KYC
-- approval over a threshold, withdrawal force-completion) require a fresh
-- proof-of-presence even when the staff user already has an active session
-- and a valid WebAuthn credential. Rather than re-prompt for password on
-- every such action, we record a "step-up" assertion in this table whenever
-- the staff user completes a fresh MFA challenge. The middleware then
-- accepts the action if the staff user has any unexpired row.

CREATE TABLE IF NOT EXISTS staff_step_up_assertions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_user_id   UUID NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
    -- Bound to an IP / fingerprint pair so a stolen JWT cannot ride a
    -- step-up record forever from a different machine.
    ip_at_assertion INET NULL,
    user_agent      TEXT NULL,
    -- Method tells the audit log whether this was a WebAuthn assertion,
    -- a TOTP code, or a recovery code. Drives policy ("recovery codes
    -- never satisfy step-up for fund-movement actions").
    method          TEXT NOT NULL CHECK (method IN ('webauthn','totp','recovery')),
    asserted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    -- Reason captured at assertion time so the audit log shows what the
    -- staff user was about to do when they re-MFA'd.
    purpose         TEXT NOT NULL DEFAULT '',
    consumed_at     TIMESTAMPTZ NULL,
    consumed_action TEXT NULL
);

CREATE INDEX IF NOT EXISTS staff_step_up_assertions_staff_idx
    ON staff_step_up_assertions (staff_user_id, expires_at DESC)
    WHERE consumed_at IS NULL;
