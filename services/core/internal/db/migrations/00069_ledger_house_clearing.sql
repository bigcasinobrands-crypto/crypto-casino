-- +goose Up
-- Synthetic house ledger identity + clearing pockets for paired settlement accounting (deposit inbound / withdrawal outbound).
-- Player-facing balances remain sum of player user_id rows; house rows reconcile custody vs liabilities.

INSERT INTO users (
    id,
    email,
    password_hash,
    terms_accepted_at,
    terms_version,
    privacy_version,
    email_verified_at,
    public_participant_id
)
SELECT
    '00000000-0000-4000-a000-000000000001'::uuid,
    'ledger-house@system.internal',
    '$2a$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31wq',
    now(),
    '0',
    '0',
    now(),
    'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '00000000-0000-4000-a000-000000000001'::uuid);

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_pocket_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_pocket_check
    CHECK (pocket IN (
        'cash',
        'bonus_locked',
        'pending_withdrawal',
        'clearing_deposit',
        'clearing_withdrawal_out'
    ));

COMMENT ON COLUMN ledger_entries.pocket IS
    'Player: cash, bonus_locked, pending_withdrawal. House (ledger-house user): clearing_deposit (inbound custody mirror), clearing_withdrawal_out (outbound settlement mirror).';

-- +goose Down
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_pocket_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_pocket_check
    CHECK (pocket IN ('cash', 'bonus_locked', 'pending_withdrawal'));

DELETE FROM users WHERE id = '00000000-0000-4000-a000-000000000001'::uuid AND email = 'ledger-house@system.internal';
