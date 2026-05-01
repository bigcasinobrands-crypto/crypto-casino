-- +goose Up
-- R3/R4+ scaffolding: free rounds ledger, config knob store, gamification (stub), referral (stub).

CREATE TABLE IF NOT EXISTS bonus_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO bonus_config (key, value) VALUES ('free_spins_v1', '{"api_enabled": false, "outbound_enabled": false}'::jsonb)
    ON CONFLICT (key) DO NOTHING;

-- Issued free-spin packages (on-platform tracking; provider grant is async)
CREATE TABLE IF NOT EXISTS free_spin_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    promotion_version_id BIGINT REFERENCES promotion_versions (id) ON DELETE SET NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'granted', 'in_progress', 'completed', 'void', 'error'
    )),
    game_id TEXT,
    bet_minor BIGINT NOT NULL DEFAULT 0,
    rounds_total INT NOT NULL DEFAULT 0,
    rounds_remaining INT NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'blueocean',
    provider_ref TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS free_spin_grants_user_idx ON free_spin_grants (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS free_spin_grants_status_idx ON free_spin_grants (status);

CREATE TABLE IF NOT EXISTS races (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'settled', 'cancelled')),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS race_entries (
    race_id BIGINT NOT NULL REFERENCES races (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    score_minor BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (race_id, user_id)
);
CREATE INDEX IF NOT EXISTS race_entries_race_idx ON race_entries (race_id, score_minor DESC);

CREATE TABLE IF NOT EXISTS missions (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'off' CHECK (status IN ('off', 'on')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_missions (
    mission_id BIGINT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    progress_minor BIGINT NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'completed', 'expired')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (mission_id, user_id)
);
CREATE INDEX IF NOT EXISTS player_missions_user_idx ON player_missions (user_id, state);

CREATE TABLE IF NOT EXISTS referral_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_links_user_idx ON referral_links (user_id);

CREATE TABLE IF NOT EXISTS referral_events (
    id BIGSERIAL PRIMARY KEY,
    link_id UUID NOT NULL REFERENCES referral_links (id) ON DELETE CASCADE,
    referee_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    stage TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_events_link_idx ON referral_events (link_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS referral_events;
DROP TABLE IF EXISTS referral_links;
DROP TABLE IF EXISTS player_missions;
DROP TABLE IF EXISTS missions;
DROP TABLE IF EXISTS race_entries;
DROP TABLE IF EXISTS races;
DROP TABLE IF EXISTS free_spin_grants;
DROP TABLE IF EXISTS bonus_config;
