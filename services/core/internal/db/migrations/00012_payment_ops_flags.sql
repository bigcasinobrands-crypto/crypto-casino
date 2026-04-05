-- +goose Up
CREATE TABLE payment_ops_flags (
    id INT PRIMARY KEY DEFAULT 1,
    deposits_enabled BOOLEAN NOT NULL DEFAULT true,
    withdrawals_enabled BOOLEAN NOT NULL DEFAULT true,
    real_play_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_ops_flags_singleton CHECK (id = 1)
);

INSERT INTO payment_ops_flags (id) VALUES (1);

-- +goose Down
DROP TABLE IF EXISTS payment_ops_flags;
