-- One-shot fix for player login "session_failed" on Supabase when player_sessions is missing
-- client/geo columns (migration 00063). Run in Supabase → SQL → New query, then try login again.
-- Use the same project/DB that your Core API DATABASE_URL points to.

ALTER TABLE public.player_sessions
    ADD COLUMN IF NOT EXISTS client_ip TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS fingerprint_visitor_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS fingerprint_request_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS country_iso2 TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS geo_source TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS player_sessions_fp_visitor_idx ON public.player_sessions (fingerprint_visitor_id)
    WHERE fingerprint_visitor_id IS NOT NULL AND fingerprint_visitor_id <> '';

-- If risk/reconciliation tables exist, enable RLS (see migration 00065)
ALTER TABLE IF EXISTS public.risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reconciliation_alerts ENABLE ROW LEVEL SECURITY;
