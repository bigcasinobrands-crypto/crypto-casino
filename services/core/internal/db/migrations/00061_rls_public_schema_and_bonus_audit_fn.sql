-- +goose Up
-- 1) Supabase / security advisors: enable RLS on every ordinary table in public.
--    The Go API connects as the DB owner (e.g. local `casino` superuser) which bypasses RLS, so runtime behavior stays the same.
--    If you use a pooled non-owner role without BYPASSRLS, add explicit policies before applying this in production.
-- 2) Pin search_path on forbid_bonus_audit_mutation (Supabase "function search_path mutable").

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION forbid_bonus_audit_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'bonus_audit_log is append-only';
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_catalog;
-- +goose StatementEnd

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
      AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tbl);
  END LOOP;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION forbid_bonus_audit_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'bonus_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
