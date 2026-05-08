-- +goose Up
-- Sportsbook session hygiene: country-of-issue + uniqueness + indexes for cleanup.
--
-- Why each change:
--   country (ISO 3166-1 alpha-2): UserDetails currently hard-codes 'US' as the
--     country in the Bifrost user payload, which is wrong for a global crypto
--     casino and leaks no signal to KYC/AML. Persist the country resolved at
--     session-issue time so userDetails can return the player's actual country.
--   ip_at_issue (inet): retention for incident response — if a sportsbook
--     session is later flagged for fraud we need to know which network it was
--     issued from without joining against traffic_sessions on a fuzzy timestamp.
--   one ACTIVE session per (user, provider): prevents iframe-spawned tokens
--     from accumulating. The previous schema only deduped by token_hash, so a
--     misbehaving client could create dozens of valid tokens for one player.
--     We enforce single-active by partial UNIQUE index instead of a transition
--     trigger because partial-unique is atomic with the INSERT, has zero
--     additional code path, and stays correct under concurrent issuances.
--   sportsbook_sessions_expiry_idx: lets the cleanup worker scan expired
--     sessions cheaply.

-- Pre-migration cleanup: older builds allowed multiple ACTIVE rows per user
-- (e.g. iframe token churn). The partial unique index below cannot be created
-- until at most one ACTIVE row remains per (user_id, provider).
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, provider
               ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM sportsbook_sessions
    WHERE status = 'ACTIVE'
)
UPDATE sportsbook_sessions s
SET status = 'REVOKED'
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;

ALTER TABLE sportsbook_sessions
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS ip_at_issue INET;

CREATE UNIQUE INDEX IF NOT EXISTS sportsbook_sessions_one_active_per_user_idx
    ON sportsbook_sessions (user_id, provider)
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS sportsbook_sessions_expiry_idx
    ON sportsbook_sessions (expires_at)
    WHERE status = 'ACTIVE';

-- +goose Down
DROP INDEX IF EXISTS sportsbook_sessions_expiry_idx;
DROP INDEX IF EXISTS sportsbook_sessions_one_active_per_user_idx;
ALTER TABLE sportsbook_sessions
    DROP COLUMN IF EXISTS ip_at_issue,
    DROP COLUMN IF EXISTS country;
