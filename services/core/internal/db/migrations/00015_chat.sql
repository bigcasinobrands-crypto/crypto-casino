-- +goose Up
CREATE TABLE chat_messages (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id),
    username    TEXT NOT NULL,
    body        TEXT NOT NULL,
    msg_type    TEXT NOT NULL DEFAULT 'user',
    vip_rank    TEXT,
    deleted     BOOLEAN NOT NULL DEFAULT false,
    deleted_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_created ON chat_messages (created_at DESC);
CREATE INDEX idx_chat_messages_user    ON chat_messages (user_id, created_at DESC);

CREATE TABLE chat_bans (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) UNIQUE,
    banned_by   UUID NOT NULL REFERENCES users(id),
    reason      TEXT NOT NULL DEFAULT '',
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_mutes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id),
    muted_by    UUID NOT NULL REFERENCES users(id),
    reason      TEXT NOT NULL DEFAULT '',
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_mutes_user_expires ON chat_mutes (user_id, expires_at DESC);

-- +goose Down
DROP TABLE IF EXISTS chat_mutes;
DROP TABLE IF EXISTS chat_bans;
DROP TABLE IF EXISTS chat_messages;
