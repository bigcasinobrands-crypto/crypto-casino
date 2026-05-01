-- +goose Up
-- VIP delivery runs (weekly/monthly batches, future pipelines) + rakeback burst ledger + rain scaffold.

CREATE TABLE vip_delivery_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline VARCHAR(64) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'running',
    stats JSONB NOT NULL DEFAULT '{}',
    trigger_kind VARCHAR(32) NOT NULL DEFAULT 'cron',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE INDEX vip_delivery_runs_pipeline_started_idx ON vip_delivery_runs (pipeline, started_at DESC);

CREATE TABLE vip_delivery_run_items (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES vip_delivery_runs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    pipeline VARCHAR(64) NOT NULL,
    idempotency_key TEXT NOT NULL,
    amount_minor BIGINT,
    bonus_instance_id UUID,
    result VARCHAR(32) NOT NULL,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vip_delivery_run_items_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX vip_delivery_run_items_run_idx ON vip_delivery_run_items (run_id);
CREATE INDEX vip_delivery_run_items_user_idx ON vip_delivery_run_items (user_id);

CREATE TABLE vip_delivery_schedules (
    id SERIAL PRIMARY KEY,
    pipeline VARCHAR(64) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    config JSONB NOT NULL DEFAULT '{}',
    next_run_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO vip_delivery_schedules (pipeline, enabled, config)
VALUES
    ('weekly_bonus', false, '{}'),
    ('monthly_bonus', false, '{}')
ON CONFLICT (pipeline) DO NOTHING;

-- Rakeback burst consumption (idempotent per user per UTC window slot).
CREATE TABLE vip_rakeback_burst_ledger (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    burst_window_key TEXT NOT NULL,
    tier_id INT REFERENCES vip_tiers (id),
    rebate_delta_minor BIGINT NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vip_rakeback_burst_ledger_idem UNIQUE (idempotency_key)
);

CREATE INDEX vip_rakeback_burst_ledger_user_idx ON vip_rakeback_burst_ledger (user_id, created_at DESC);

-- Rain (operator-seeded pool + fan-out payouts).
CREATE TABLE rain_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_amount_minor BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    meta JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE rain_payouts (
    id BIGSERIAL PRIMARY KEY,
    round_id UUID NOT NULL REFERENCES rain_rounds (id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    amount_minor BIGINT NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rain_payouts_idem UNIQUE (idempotency_key)
);

CREATE INDEX rain_payouts_round_idx ON rain_payouts (round_id);

-- +goose Down
DROP INDEX IF EXISTS rain_payouts_round_idx;
DROP TABLE IF EXISTS rain_payouts;
DROP TABLE IF EXISTS rain_rounds;
DROP INDEX IF EXISTS vip_rakeback_burst_ledger_user_idx;
DROP TABLE IF EXISTS vip_rakeback_burst_ledger;
DROP TABLE IF EXISTS vip_delivery_schedules;
DROP INDEX IF EXISTS vip_delivery_run_items_user_idx;
DROP INDEX IF EXISTS vip_delivery_run_items_run_idx;
DROP TABLE IF EXISTS vip_delivery_run_items;
DROP INDEX IF EXISTS vip_delivery_runs_pipeline_started_idx;
DROP TABLE IF EXISTS vip_delivery_runs;
