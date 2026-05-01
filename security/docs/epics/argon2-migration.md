# Project plan: Argon2id migration (off bcrypt)

## Outcome

Password hashes for players and staff use **Argon2id** for new credentials. **bcrypt** continues to verify legacy hashes; successful login **re-hashes** to Argon2id (`internal/passhash`).

## Phases

1. **Library & parameters** — Tune memory/time cost for target hardware; document in security review.
2. **Rollout** — Deploy core; monitor login latency and error rates; optional shadow verification in staging.
3. **Forced rotation** — For high-risk cohorts, require password reset (out-of-band process).
4. **Deprecation** — After metrics show negligible bcrypt traffic, plan removal of bcrypt verify path (major version).

## Acceptance

- New `staff_users` / player hashes are Argon2id-prefixed strings.
- Login with old bcrypt still works once; next login uses Argon2id.
- No regression on bootstrap / reset CLIs.

Operational notes: [`../../runbooks/argon2-credentials.md`](../../runbooks/argon2-credentials.md).
