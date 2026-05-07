-- +goose Up
-- 00075: encrypt destination addresses at rest (SEC-7).
--
-- Crypto destination addresses are PII-adjacent: an attacker with read
-- access to the database (e.g. backup theft, RLS bypass) could correlate
-- a player to an on-chain identity even without the rest of the row. To
-- mitigate we encrypt the destination address at rest using AES-GCM with
-- a key managed in the application config (or Vault Transit if
-- WALLET_ADDRESS_KEK_VAULT_PATH is configured).
--
-- Schema change:
--   - destination_address_encrypted: ciphertext bytes, nonce-prefixed.
--   - destination_address_hash:      sha256 of normalized lowercase
--                                    address; used for sanctions list
--                                    matching and dup-detection without
--                                    decrypting.
--   - destination_address_last4:     last four chars of the address; safe
--                                    to display in UI ("...abc1") so the
--                                    player can verify intent without
--                                    forcing a decrypt round-trip.
--   - destination_address remains for legacy/backfill compatibility but
--     is dropped in a follow-up migration once all rows have ciphertext.

ALTER TABLE payment_withdrawals
    ADD COLUMN IF NOT EXISTS destination_address_encrypted BYTEA NULL,
    ADD COLUMN IF NOT EXISTS destination_address_hash TEXT NULL,
    ADD COLUMN IF NOT EXISTS destination_address_last4 TEXT NULL;

CREATE INDEX IF NOT EXISTS payment_withdrawals_addr_hash_idx
    ON payment_withdrawals (destination_address_hash)
    WHERE destination_address_hash IS NOT NULL;
