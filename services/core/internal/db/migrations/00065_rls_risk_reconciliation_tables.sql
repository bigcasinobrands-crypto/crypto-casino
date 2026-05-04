-- +goose Up
-- risk_assessments / reconciliation_alerts were added in 00064 after 00061 (which enabled RLS on all
-- existing public tables). Enable RLS here so Supabase Advisor is satisfied.
-- Go API uses the DB owner role which bypasses RLS (same as 00061); PostgREST anon/authenticated see no rows without policies.

ALTER TABLE risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_alerts ENABLE ROW LEVEL SECURITY;

-- +goose Down
ALTER TABLE risk_assessments DISABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_alerts DISABLE ROW LEVEL SECURITY;
