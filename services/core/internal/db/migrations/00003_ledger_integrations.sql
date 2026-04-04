-- +goose Up
CREATE TABLE ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT',
    entry_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ledger_entries_user_created_idx ON ledger_entries (user_id, created_at DESC);

CREATE TABLE blueocean_events (
    id BIGSERIAL PRIMARY KEY,
    provider_event_id TEXT NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'pending',
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX blueocean_events_status_idx ON blueocean_events (status, created_at DESC);

CREATE TABLE games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'blueocean',
    category TEXT,
    thumbnail_url TEXT,
    metadata JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fystack_checkouts (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    amount_minor BIGINT,
    currency TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    raw JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fystack_payments (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    checkout_id TEXT REFERENCES fystack_checkouts (id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    raw JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fystack_withdrawals (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL,
    destination TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    raw JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS fystack_withdrawals;
DROP TABLE IF EXISTS fystack_payments;
DROP TABLE IF EXISTS fystack_checkouts;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS blueocean_events;
DROP TABLE IF EXISTS ledger_entries;
