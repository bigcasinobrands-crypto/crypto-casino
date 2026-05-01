# Runbook: JSON logs and alerting

## Baseline

- Set `LOG_FORMAT=json` on **API** and **worker** in an environment.
- Log shipper tails container stdout; verify JSON parses (no broken multi-line unless using newline delimited JSON correctly).

## Common alert rules

| Signal | Suggestion |
|--------|------------|
| Spike in `level=ERROR` | Page on-call; sample by `request_id`. |
| Worker no progress | Alert on queue depth / stale heartbeat. |
| Vault/Redis connection errors | Page platform; may impact MFA and sessions. |
| 401/403 ratio on `/v1/admin/auth/*` | Possible attack or misconfigured WebAuthn origins. |

## Redaction

- Confirm no plaintext passwords, full JWTs, or Vault tokens in log fields.
- Scrub email/phone in debug traces before enabling verbose logging in prod.

## Playbook

1. Identify service + time window.
2. Filter logs by `request_id` from client or edge.
3. If logs inadequate: temporarily raise sampling (not full body dumps) with change ticket.
