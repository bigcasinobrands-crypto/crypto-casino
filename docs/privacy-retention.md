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
