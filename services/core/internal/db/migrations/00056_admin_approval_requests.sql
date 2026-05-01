-- +goose Up
CREATE TABLE admin_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_staff_id UUID NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    before_state JSONB,
    after_state JSONB,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approver_staff_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX admin_approval_requests_status_idx ON admin_approval_requests (status, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS admin_approval_requests;
