# Post–Phase 1: harden & scale toward 10k+ users

- Load test API + worker under webhook burst; tune Redis pool + Postgres connections (PgBouncer).
- Read replica for heavy admin reporting; cursor pagination on all list endpoints.
- Observability: structured JSON logs, metrics (RPS, queue depth, 5xx), tracing (OTel).
- Soft-launch cohort + support runbooks; affiliate/VIP engines per product roadmap.
- Growth: marketing domain, SEO, retention campaigns — out of core repo scope.
