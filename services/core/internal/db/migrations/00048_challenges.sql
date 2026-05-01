-- +goose Up
-- Casino challenges: multiplier / wager_volume / win_streak / race (schema ready; MVP uses multiplier + wager_volume).

CREATE TABLE challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    rules TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    hero_image_url TEXT,
    badge_label TEXT,
    challenge_type TEXT NOT NULL CHECK (challenge_type IN ('multiplier', 'wager_volume', 'win_streak', 'race')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled')),

    game_ids TEXT[],
    game_provider TEXT,

    target_multiplier NUMERIC(20, 6),
    target_wager_amount_minor BIGINT,
    target_win_streak INT,
    min_bet_amount_minor BIGINT NOT NULL DEFAULT 1,
    max_bet_amount_minor BIGINT,

    prize_type TEXT NOT NULL CHECK (prize_type IN ('cash', 'bonus', 'free_spins', 'pool')),
    prize_amount_minor BIGINT,
    prize_currency TEXT NOT NULL DEFAULT 'USDT',
    prize_free_spins INT,
    prize_pool_total_minor BIGINT,
    prize_pool_splits JSONB,
    max_winners INT NOT NULL DEFAULT 1,
    winners_count INT NOT NULL DEFAULT 0,

    vip_only BOOLEAN NOT NULL DEFAULT false,
    vip_tier_minimum TEXT,
    min_account_age_days INT NOT NULL DEFAULT 0,
    min_lifetime_deposits_minor BIGINT NOT NULL DEFAULT 0,
    eligible_countries TEXT[],
    excluded_countries TEXT[],
    requires_deposit_in_window BOOLEAN NOT NULL DEFAULT false,
    deposit_window_hours INT,

    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    entry_deadline TIMESTAMPTZ,
    timezone TEXT NOT NULL DEFAULT 'UTC',

    max_participants INT,
    one_per_player BOOLEAN NOT NULL DEFAULT true,
    cooldown_hours INT,

    display_order INT NOT NULL DEFAULT 0,
    is_featured BOOLEAN NOT NULL DEFAULT false,

    auto_flag_risk_threshold NUMERIC(5, 2) NOT NULL DEFAULT 50,
    auto_block_risk_threshold NUMERIC(5, 2) NOT NULL DEFAULT 80,
    prize_manual_review BOOLEAN NOT NULL DEFAULT false,

    created_by UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    updated_by UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX challenges_status_starts_idx ON challenges (status, starts_at DESC);
CREATE INDEX challenges_type_idx ON challenges (challenge_type);

CREATE TABLE challenge_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'disqualified', 'cancelled')),

    progress_value NUMERIC(20, 6) NOT NULL DEFAULT 0,
    best_multiplier NUMERIC(20, 6),
    qualifying_bets INT NOT NULL DEFAULT 0,
    total_wagered_minor BIGINT NOT NULL DEFAULT 0,
    current_streak INT NOT NULL DEFAULT 0,

    completed_at TIMESTAMPTZ,
    winning_bet_id TEXT,
    winning_multiplier NUMERIC(20, 6),
    rank INT,
    prize_awarded_minor BIGINT,
    prize_awarded_at TIMESTAMPTZ,

    risk_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
    flagged_for_review BOOLEAN NOT NULL DEFAULT false,
    flag_reasons TEXT[],
    reviewed_by UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,

    ip_address TEXT,
    device_fingerprint TEXT,
    entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (challenge_id, user_id)
);

CREATE INDEX idx_entries_challenge_status ON challenge_entries (challenge_id, status);
CREATE INDEX idx_entries_user_status ON challenge_entries (user_id, status);
CREATE INDEX idx_entries_flagged ON challenge_entries (flagged_for_review, risk_score DESC);

CREATE TABLE challenge_bet_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES challenge_entries (id) ON DELETE CASCADE,
    challenge_id UUID NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    provider_bet_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    game_name TEXT,
    bet_amount_minor BIGINT NOT NULL,
    win_amount_minor BIGINT NOT NULL DEFAULT 0,
    multiplier NUMERIC(20, 6) NOT NULL DEFAULT 0,
    round_result TEXT NOT NULL CHECK (round_result IN ('win', 'loss', 'void', 'cancelled')),

    settled_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (entry_id, provider_bet_id)
);

CREATE INDEX idx_bet_events_entry ON challenge_bet_events (entry_id);
CREATE INDEX idx_bet_events_user_challenge ON challenge_bet_events (user_id, challenge_id);
CREATE INDEX idx_bet_events_challenge_settled ON challenge_bet_events (challenge_id, settled_at DESC);

CREATE TABLE challenge_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID REFERENCES challenges (id) ON DELETE SET NULL,
    entry_id UUID REFERENCES challenge_entries (id) ON DELETE SET NULL,
    actor_id UUID,
    actor_type TEXT CHECK (actor_type IN ('admin', 'system', 'player')),
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX challenge_audit_log_challenge_idx ON challenge_audit_log (challenge_id, created_at DESC);

CREATE TABLE challenge_round_processing (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    remote_id TEXT NOT NULL,
    txn_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('debit', 'credit')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, remote_id, txn_id, phase)
);

-- +goose Down
DROP TABLE IF EXISTS challenge_round_processing;
DROP TABLE IF EXISTS challenge_audit_log;
DROP TABLE IF EXISTS challenge_bet_events;
DROP TABLE IF EXISTS challenge_entries;
DROP TABLE IF EXISTS challenges;
