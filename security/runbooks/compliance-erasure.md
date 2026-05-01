# Runbook: Compliance erasure jobs

## When to use

- After legal approves a data subject erasure; when a job is stuck or failed.

## Operator flow

1. Superadmin enqueues erasure for `player_id` via admin API / console.
2. Monitor job row: status transitions, `error` column if present.
3. Worker logs (`job_type=compliance_erasure`) should show start/finish; use `request_id` / job id correlation.

## Stuck job

1. Confirm worker deployment and DB connectivity.
2. Check for row locks on hot tables; retry job only if idempotent (designed to be).
3. If partial completion: **do not** re-run blindly — consult engineering + legal; may need manual cleanup script.

## Verification

- Player profile returns 404 or tombstone state per product spec.
- Search indices and caches invalidated (if applicable in your deployment).

## Audit

- Preserve `admin_audit_log` entries and job history per retention policy.
