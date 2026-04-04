-- +goose Up
-- If admin@twox.gg was created earlier (e.g. cmd/bootstrap with another password), align hash to testadmin123.
UPDATE staff_users
SET password_hash = '$2a$10$hSHumS8Eh4A5qL3LfpTRheQwBJPU3jOeo8hJIM6P6Kg8waxdSNt5C'
WHERE lower(email) = lower('admin@twox.gg');

-- +goose Down
SELECT 1;
