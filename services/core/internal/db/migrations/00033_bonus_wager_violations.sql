-- +goose Up
ALTER TABLE user_bonus_instances
    ADD COLUMN IF NOT EXISTS max_bet_violations_count INT NOT NULL DEFAULT 0;

CREATE TABLE bonus_wager_violations (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    bonus_instance_id UUID NOT NULL REFERENCES user_bonus_instances (id) ON DELETE CASCADE,
    game_id TEXT NOT NULL DEFAULT '',
    stake_minor BIGINT NOT NULL,
    max_bet_minor BIGINT NOT NULL DEFAULT 0,
    violation_type TEXT NOT NULL CHECK (violation_type IN ('max_bet', 'excluded_game')),
    source_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bonus_wager_violations_user_created_idx ON bonus_wager_violations (user_id, created_at DESC);
CREATE INDEX bonus_wager_violations_instance_idx ON bonus_wager_violations (bonus_instance_id, created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS bonus_wager_violations_instance_idx;
DROP INDEX IF EXISTS bonus_wager_violations_user_created_idx;
DROP TABLE IF EXISTS bonus_wager_violations;
ALTER TABLE user_bonus_instances DROP COLUMN IF EXISTS max_bet_violations_count;
