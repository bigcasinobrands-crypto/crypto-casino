-- Reference: create a dedicated DB user for the application (run once per environment).
-- Replace passwords and execute as a superuser, then set DATABASE_URL to use casino_app.

-- CREATE ROLE casino_app LOGIN PASSWORD 'change-me-strong';
-- GRANT CONNECT ON DATABASE casino TO casino_app;
-- GRANT USAGE ON SCHEMA public TO casino_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO casino_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO casino_app;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO casino_app;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO casino_app;

-- Migrations should run under a migration role or CI job; app runtime uses casino_app only.
