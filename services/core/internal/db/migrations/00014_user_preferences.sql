-- +goose Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS promo_redemptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    code        TEXT NOT NULL,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, code)
);

-- +goose Down
DROP TABLE IF EXISTS promo_redemptions;
ALTER TABLE users DROP COLUMN IF EXISTS preferences;
