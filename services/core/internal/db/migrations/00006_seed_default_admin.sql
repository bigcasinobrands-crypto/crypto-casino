-- +goose Up
-- Canonical dev staff row (password: testadmin123). Runs after player tables; skipped if email exists.
INSERT INTO staff_users (email, password_hash, role)
SELECT
    'admin@twox.gg',
    '$2a$10$hSHumS8Eh4A5qL3LfpTRheQwBJPU3jOeo8hJIM6P6Kg8waxdSNt5C',
    'admin'
WHERE NOT EXISTS (
    SELECT 1 FROM staff_users WHERE lower(email) = lower('admin@twox.gg')
);

-- +goose Down
DELETE FROM staff_users WHERE lower(email) = lower('admin@twox.gg');
