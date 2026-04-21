# Privacy and retention (stub)

This document is a placeholder for legal and compliance review. It does not constitute legal advice.

## Data we hold

- **Accounts:** email, password hash, verification timestamps, optional self-exclusion and account-closure timestamps.
- **Wallet / ledger:** balance movements and idempotency keys as implemented in `ledger_entries`.
- **Gaming:** Blue Ocean player link rows (`blueocean_player_links`), launch audit rows (`game_launches`), and dispute records (`game_disputes`) when used.
- **Integrations:** Provider webhook and payment tables as present in migrations.

## Player rights

- Admin **GDPR export** (stub) returns a JSON summary for a user id; extend with full structured export and secure delivery per your policy.
- **Account closure** and **self-exclusion** fields on `users` are enforced on login, refresh, launch, and seamless wallet paths when a link exists.

## Retention

- Define retention periods per jurisdiction and product; add scheduled purge jobs and backup policies in line with those definitions.

## Bonus data

- `user_bonus_instances` contains `user_id`, grant amounts, wagering-requirement progress, and status. Subject to the same retention policy as `ledger_entries` since bonus grants and conversions produce ledger rows.
- `bonus_risk_decisions` contains `user_id` and the risk-engine outcome for each grant evaluation. Retain alongside `user_bonus_instances`.
- `promotion_targets` links `user_id` to `promotion_version_id` for explicit bonus targeting; purge with campaign archival policy.
- `vip_point_ledger` and `player_vip_state` hold wagering-derived points and tier; align retention with ledger/game activity policies.
- `player_internal_notes`, `player_watchlist`, `player_risk_signals` are staff-only operational data; define retention and access per compliance.

## Chat data

- `chat_messages` stores `user_id`, message content, and timestamps.
- Recommended periodic purge: **90 days** from `created_at`. Soft-deleted messages (staff moderation) can be hard-deleted on the same schedule.
- `chat_mutes` and `chat_bans` reference `user_id`; retain for the duration of the moderation action plus a reasonable audit window.

## Erasure (right to be forgotten)

- `user_bonus_instances`: set `user_id` to an anonymized UUID on erasure request. The instance and ledger trail remain for financial integrity, but the link to the natural person is severed.
- `ledger_entries`: already covered by the existing anonymization policy (replace `user_id` with anonymized UUID; preserve double-entry sums).
- `chat_messages`: hard-delete or anonymize `user_id` on erasure request.
- `bonus_risk_decisions`: anonymize `user_id` in the same pass as `user_bonus_instances`.

## Legal sign-off

> **Legal review and sign-off on bonus terms & conditions, privacy retention periods, and the erasure procedure is required before enabling production real-money bonuses.**
