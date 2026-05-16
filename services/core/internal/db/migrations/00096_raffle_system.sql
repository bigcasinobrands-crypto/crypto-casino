-- +goose Up
-- Weekly raffle: campaigns, tickets, draws, winners, audit, settings.

CREATE TABLE raffle_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    visibility TEXT NOT NULL DEFAULT 'public',
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    draw_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    eligible_products JSONB NOT NULL DEFAULT '["casino"]'::jsonb,
    eligible_currencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    included_provider_ids JSONB,
    excluded_provider_ids JSONB,
    included_game_ids JSONB,
    excluded_game_ids JSONB,
    include_bonus_wagers BOOLEAN NOT NULL DEFAULT false,
    min_wager_amount_minor BIGINT NOT NULL DEFAULT 0,
    ticket_rate_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    purchase_enabled BOOLEAN NOT NULL DEFAULT false,
    purchase_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    max_tickets_per_user BIGINT,
    max_tickets_global BIGINT,
    max_wins_per_user INT NOT NULL DEFAULT 1,
    terms_text TEXT NOT NULL DEFAULT '',
    responsible_notice TEXT NOT NULL DEFAULT '',
    created_by_staff_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    updated_by_staff_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT raffle_campaigns_status_check CHECK (
        status IN ('draft', 'scheduled', 'active', 'drawing', 'completed', 'cancelled')
    ),
    CONSTRAINT raffle_campaigns_visibility_check CHECK (visibility IN ('hidden', 'public')),
    CONSTRAINT raffle_campaigns_time_order CHECK (end_at >= start_at)
);

CREATE UNIQUE INDEX raffle_campaigns_slug_lower_idx ON raffle_campaigns (lower(slug));
CREATE INDEX raffle_campaigns_status_idx ON raffle_campaigns (status);
CREATE INDEX raffle_campaigns_schedule_idx ON raffle_campaigns (start_at, end_at);
-- At most one campaign in live states (active wagering + draw in progress).
CREATE UNIQUE INDEX raffle_campaigns_one_live_idx ON raffle_campaigns ((1))
    WHERE status IN ('active', 'drawing');

CREATE TABLE raffle_prizes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES raffle_campaigns (id) ON DELETE CASCADE,
    rank_order INT NOT NULL,
    prize_type TEXT NOT NULL,
    amount_minor BIGINT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USDT',
    winner_slots INT NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    auto_payout BOOLEAN NOT NULL DEFAULT true,
    requires_approval BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, rank_order),
    CONSTRAINT raffle_prizes_type_check CHECK (
        prize_type IN ('cash', 'bonus', 'free_spins', 'points', 'manual')
    ),
    CONSTRAINT raffle_prizes_slots_positive CHECK (winner_slots >= 1)
);

CREATE INDEX raffle_prizes_campaign_idx ON raffle_prizes (campaign_id);

CREATE TABLE raffle_tickets (
    id BIGSERIAL PRIMARY KEY,
    campaign_id UUID NOT NULL REFERENCES raffle_campaigns (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    ticket_count BIGINT NOT NULL,
    source TEXT NOT NULL,
    source_ref_type TEXT NOT NULL DEFAULT '',
    source_ref_id TEXT NOT NULL DEFAULT '',
    wager_amount_minor BIGINT,
    currency TEXT,
    product TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'posted',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reversed_at TIMESTAMPTZ,
    CONSTRAINT raffle_tickets_source_check CHECK (
        source IN ('wager', 'purchase', 'adjustment', 'reversal')
    ),
    CONSTRAINT raffle_tickets_status_check CHECK (status IN ('posted', 'reversed'))
);

CREATE INDEX raffle_tickets_campaign_user_idx ON raffle_tickets (campaign_id, user_id);
CREATE INDEX raffle_tickets_campaign_created_idx ON raffle_tickets (campaign_id, created_at DESC);
CREATE INDEX raffle_tickets_source_ref_idx ON raffle_tickets (source_ref_type, source_ref_id);

CREATE TABLE raffle_user_totals (
    campaign_id UUID NOT NULL REFERENCES raffle_campaigns (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    total_tickets BIGINT NOT NULL DEFAULT 0,
    wager_tickets BIGINT NOT NULL DEFAULT 0,
    purchased_tickets BIGINT NOT NULL DEFAULT 0,
    adjustment_tickets BIGINT NOT NULL DEFAULT 0,
    eligible_wager_amount_minor BIGINT NOT NULL DEFAULT 0,
    last_ticket_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, user_id),
    CONSTRAINT raffle_user_totals_nonneg CHECK (
        total_tickets >= 0 AND wager_tickets >= 0 AND purchased_tickets >= 0 AND adjustment_tickets >= 0
    )
);

CREATE INDEX raffle_user_totals_campaign_tickets_idx ON raffle_user_totals (campaign_id, total_tickets DESC);

CREATE TABLE raffle_draws (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES raffle_campaigns (id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    locked_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    total_tickets BIGINT NOT NULL DEFAULT 0,
    total_participants INT NOT NULL DEFAULT 0,
    seed_source TEXT NOT NULL DEFAULT 'server_csprng',
    server_seed_hash TEXT NOT NULL DEFAULT '',
    server_seed_revealed TEXT NOT NULL DEFAULT '',
    external_entropy TEXT NOT NULL DEFAULT '',
    final_seed_hash TEXT NOT NULL DEFAULT '',
    algorithm_version TEXT NOT NULL DEFAULT 'v1',
    executed_by_staff_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    failure_reason TEXT NOT NULL DEFAULT '',
    proof_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT raffle_draws_status_check CHECK (
        status IN ('pending', 'running', 'completed', 'failed', 'published')
    )
);

CREATE UNIQUE INDEX raffle_draws_one_completed_per_campaign_idx ON raffle_draws (campaign_id)
    WHERE status IN ('completed', 'published');
CREATE INDEX raffle_draws_campaign_idx ON raffle_draws (campaign_id);

CREATE TABLE raffle_winners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES raffle_campaigns (id) ON DELETE CASCADE,
    draw_id UUID NOT NULL REFERENCES raffle_draws (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    rank_slot INT NOT NULL,
    prize_id UUID REFERENCES raffle_prizes (id) ON DELETE SET NULL,
    prize_type TEXT NOT NULL,
    prize_amount_minor BIGINT NOT NULL DEFAULT 0,
    prize_currency TEXT NOT NULL DEFAULT 'USDT',
    payout_status TEXT NOT NULL DEFAULT 'pending',
    ledger_idempotency_key TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT raffle_winners_payout_check CHECK (
        payout_status IN ('pending', 'processing', 'paid', 'failed', 'skipped', 'manual')
    ),
    UNIQUE (draw_id, rank_slot)
);

CREATE INDEX raffle_winners_campaign_idx ON raffle_winners (campaign_id);
CREATE INDEX raffle_winners_user_idx ON raffle_winners (user_id);

CREATE TABLE raffle_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES raffle_campaigns (id) ON DELETE SET NULL,
    staff_user_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    player_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    before_data JSONB,
    after_data JSONB,
    reason TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX raffle_audit_logs_campaign_idx ON raffle_audit_logs (campaign_id, created_at DESC);

CREATE TABLE raffle_settings (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by_staff_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO raffle_settings (key, value) VALUES ('system_enabled', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS raffle_audit_logs;
DROP TABLE IF EXISTS raffle_winners;
DROP TABLE IF EXISTS raffle_draws;
DROP TABLE IF EXISTS raffle_user_totals;
DROP TABLE IF EXISTS raffle_tickets;
DROP TABLE IF EXISTS raffle_prizes;
DROP TABLE IF EXISTS raffle_campaigns;
DROP TABLE IF EXISTS raffle_settings;
