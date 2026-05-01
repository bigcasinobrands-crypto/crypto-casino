# Runbook: Argon2 credentials

## Symptoms

- Login latency spikes after Argon2 rollout.
- Hash verification errors for a subset of users.

## Checks

1. Confirm `internal/passhash` logs no panics; DB `password_hash` prefix distinguishes Argon2 vs bcrypt.
2. Sample: bcrypt user login should succeed; second login should show Argon2 prefix if rehash path ran.

## Mitigation

- If Argon2 parameters are too heavy for current CPU: lower cost in **staging**, redeploy, re-measure p99 login.
- If a user cannot login after migration bug: reset password via controlled admin/bootstrap path; audit the action.

## Communications

- Document parameter choice in postmortem if tuning changes production security posture.
