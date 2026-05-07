-- +goose Up
-- Migration 00061 enabled RLS on every public table that existed at apply time.
-- Later migrations added new public tables (00066 Oddin, 00067 CMS assets, 00068 payments)
-- without RLS, which Supabase security advisors flag and which weakens PostgREST isolation
-- if `anon`/`authenticated` retain `SELECT` grants on public (default in many projects).
-- Go core connects as a role that bypasses RLS (DB owner / BYPASSRLS); behavior unchanged for the API.
-- +goose StatementBegin
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
-- Re-disable RLS only on tables introduced after 00061 that had no follow-up migration before 00070.
-- Other tables may have had RLS off before 00070 in odd states; review before running Down in production.
ALTER TABLE IF EXISTS public.sportsbook_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sportsbook_iframe_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sportsbook_provider_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cms_uploaded_assets DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_providers DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_currencies DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_deposit_intents DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_deposit_callbacks DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_withdrawals DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_provider_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.processed_callbacks DISABLE ROW LEVEL SECURITY;
