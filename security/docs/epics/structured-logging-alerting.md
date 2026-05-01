# Project plan: Structured logging + alerting

## Outcome

Services emit **structured logs** (JSON when `LOG_FORMAT=json`), suitable for aggregation (Loki, CloudWatch, Datadog, etc.) and **alert routing** on severity / error codes.

## Phases

1. **Baseline** — Ensure API and worker initialize shared `slog` (`internal/obs`); document canonical fields: `time`, `level`, `msg`, `request_id`, `error`, `job_type`, etc.
2. **Drain** — Agent / DaemonSet ships stdout to SIEM; redaction rules for known sensitive keys.
3. **Alerts** — Define SLO alerts (5xx rate, worker lag, Vault errors, Redis unavailable, MFA spikes). Wire PagerDuty/Slack per env.
4. **Dashboards** — Request volume, p99 latency, job backlog.

Runbook: [`../../runbooks/log-json-alerting.md`](../../runbooks/log-json-alerting.md).

## Out of repo

Log storage, alert manager, on-call rotations.
