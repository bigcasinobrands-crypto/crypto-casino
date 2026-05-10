-- +goose Up
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS kycaid_applicant_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS kycaid_last_verification_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS kyc_required_reason TEXT NULL,
    ADD COLUMN IF NOT EXISTS kyc_required_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS kycaid_last_webhook_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS kycaid_verification_events (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NULL,
    callback_type TEXT NOT NULL,
    applicant_id TEXT NULL,
    verification_id TEXT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kycaid_verification_events_user_idx
    ON kycaid_verification_events(user_id, received_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS kycaid_verification_events_request_id_uidx
    ON kycaid_verification_events(request_id)
    WHERE request_id IS NOT NULL AND btrim(request_id) <> '';

-- Risk knobs + KYCAID form wiring (JSON merges with defaults in app code).
INSERT INTO site_settings (key, value, updated_at)
VALUES (
           'withdraw_kyc_policy',
           jsonb_build_object(
                   'risk_rules_enabled', true,
                   'first_withdraw_risk_within_hours', 72,
                   'first_withdraw_risk_amount_min_cents', 25000,
                   'daily_withdraw_count_threshold', 5,
                   'daily_withdraw_total_trigger_cents', 50000
           ),
           now()
       )
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_settings (key, value, updated_at)
VALUES (
           'kycaid.settings',
           jsonb_build_object(
                   'test_mode', false,
                   'form_id', '',
                   'redirect_path_after_form', '/profile?settings=verify'
           ),
           now()
       )
ON CONFLICT (key) DO NOTHING;

-- +goose Down
DROP INDEX IF EXISTS kycaid_verification_events_request_id_uidx;
DROP INDEX IF EXISTS kycaid_verification_events_user_idx;
DROP TABLE IF EXISTS kycaid_verification_events;

ALTER TABLE users
    DROP COLUMN IF EXISTS kycaid_last_webhook_at,
    DROP COLUMN IF EXISTS kyc_required_at,
    DROP COLUMN IF EXISTS kyc_required_reason,
    DROP COLUMN IF EXISTS kycaid_last_verification_id,
    DROP COLUMN IF EXISTS kycaid_applicant_id;

DELETE FROM site_settings WHERE key IN ('withdraw_kyc_policy', 'kycaid.settings');
