-- +goose Up
-- Challenge prizes: bonus_locked + WR reuse; free-spin prize fields; optional link from bonus instances to challenge entries.

ALTER TABLE challenges
    ADD COLUMN IF NOT EXISTS prize_wagering_multiplier INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS prize_max_bet_minor BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS prize_withdraw_policy TEXT,
    ADD COLUMN IF NOT EXISTS prize_free_spin_game_id TEXT,
    ADD COLUMN IF NOT EXISTS prize_bet_per_round_minor BIGINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN challenges.prize_wagering_multiplier IS 'Bonus prize: WR multiplier × prize_amount_minor → wr_required_minor on instance; 0 = unset.';
COMMENT ON COLUMN challenges.prize_max_bet_minor IS 'Bonus prize: snapshot max bet cap (0 = use profile defaults only).';
COMMENT ON COLUMN challenges.prize_withdraw_policy IS 'Bonus prize: withdraw_policy in instance snapshot (block/default).';
COMMENT ON COLUMN challenges.prize_free_spin_game_id IS 'Free-spin prize: internal games.id / id_hash with bog_game_id.';
COMMENT ON COLUMN challenges.prize_bet_per_round_minor IS 'Free-spin prize: per-round stake minor units (default 1).';

ALTER TABLE user_bonus_instances
    ALTER COLUMN promotion_version_id DROP NOT NULL;

ALTER TABLE user_bonus_instances
    ADD COLUMN IF NOT EXISTS challenge_entry_id UUID REFERENCES challenge_entries (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_bonus_instances_challenge_entry_uidx
    ON user_bonus_instances (challenge_entry_id)
    WHERE challenge_entry_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS user_bonus_instances_challenge_entry_uidx;

ALTER TABLE user_bonus_instances
    DROP COLUMN IF EXISTS challenge_entry_id;

-- Cannot safely restore NOT NULL if NULLs were inserted; leave nullable in Down.
ALTER TABLE challenges
    DROP COLUMN IF EXISTS prize_bet_per_round_minor,
    DROP COLUMN IF EXISTS prize_free_spin_game_id,
    DROP COLUMN IF EXISTS prize_withdraw_policy,
    DROP COLUMN IF EXISTS prize_max_bet_minor,
    DROP COLUMN IF EXISTS prize_wagering_multiplier;
