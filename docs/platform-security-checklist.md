# Platform security checklist (production)

Maps to plan **security-day1-platform**. Edge controls are enforced outside this repo (CDN/WAF/managed DB).

| Control | Production expectation |
|---------|------------------------|
| **TLS** | Terminate TLS at CDN/LB; HTTP→HTTPS redirect; **HSTS** with `max-age` ≥ 6 months. |
| **WAF** | OWASP ruleset on `api.*`; stricter rules on `/v1/webhooks/*` and `/v1/admin/auth/*`. |
| **Secrets** | No secrets in git; use cloud **secrets manager**; inject as env at runtime; rotate documented. |
| **Postgres** | Managed instance with **encryption at rest**; **no public** `0.0.0.0/0`; app uses **non-superuser** role with least privilege (see `docs/db-least-privilege.sql`). |
| **Redis** | **requirepass** (see `docker-compose.yml` pattern); TLS where provider supports; private network only. |
| **API headers** | `X-Content-Type-Options`, `Referrer-Policy`; tune **CSP** on static admin/player hosts. |
| **Player browser sessions** | Prefer **httpOnly** access/refresh cookies (`PLAYER_COOKIE_AUTH`), **SameSite** appropriate to your CDN origins (`PLAYER_COOKIE_SAMESITE`), **CORS `Allow-Credentials`** only on allowlisted player origins, **double-submit CSRF** on mutating `/v1`, and optional **omit JSON tokens** (`PLAYER_COOKIE_OMIT_JSON_TOKENS`) with a credentialed SPA. |

Local Docker does not replace managed encryption/WAF—use this checklist when deploying.
