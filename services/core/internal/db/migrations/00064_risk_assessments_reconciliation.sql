-- +goose Up
-- Snapshots from Fingerprint Server API (sensitive flows) + ledger mismatch alerts for ops review.

CREATE TABLE risk_assessments (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    fingerprint_request_id TEXT NOT NULL DEFAULT '',
    fingerprint_visitor_id TEXT NOT NULL DEFAULT '',
    ledger_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_event JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX risk_assessments_user_created_idx ON risk_assessments (user_id, created_at DESC);
CREATE INDEX risk_assessments_created_idx ON risk_assessments (created_at DESC);

COMMENT ON TABLE risk_assessments IS 'Fingerprint Server API context captured on sensitive flows (withdraw, future verified actions)';
COMMENT ON COLUMN risk_assessments.raw_event IS 'Subset or full Get Event JSON for audit (staff-only)';
COMMENT ON COLUMN risk_assessments.ledger_snapshot IS 'LedgerMetaFromEvent-style compact keys merged onto ledger metadata';

CREATE TABLE reconciliation_alerts (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    reference_type TEXT NOT NULL DEFAULT '',
    reference_id TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by_staff UUID REFERENCES staff_users (id) ON DELETE SET NULL
);

CREATE INDEX reconciliation_alerts_created_idx ON reconciliation_alerts (created_at DESC);
CREATE INDEX reconciliation_alerts_user_idx ON reconciliation_alerts (user_id, created_at DESC) WHERE user_id IS NOT NULL;

COMMENT ON TABLE reconciliation_alerts IS 'Ledger / geo / fingerprint reconciliation flags for finance & risk review';

-- +goose Down
DROP TABLE IF EXISTS reconciliation_alerts;
DROP TABLE IF EXISTS risk_assessments;
