-- +goose Up
CREATE TABLE break_glass_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_key TEXT NOT NULL,
    justification TEXT NOT NULL,
    requester_staff_id UUID NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
    approver_staff_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'consumed')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    reject_reason TEXT,
    meta JSONB,
    CONSTRAINT break_glass_grants_resource_key_len CHECK (char_length(resource_key) BETWEEN 1 AND 512),
    CONSTRAINT break_glass_grants_justification_len CHECK (char_length(trim(both from justification)) >= 10)
);

CREATE INDEX break_glass_grants_list_idx ON break_glass_grants (requested_at DESC);
CREATE INDEX break_glass_grants_status_idx ON break_glass_grants (status, requested_at DESC);

-- +goose Down
DROP TABLE IF EXISTS break_glass_grants;
