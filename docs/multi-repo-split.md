# Multi-repository split (operations vs player)

This monorepo matches **Pattern A** from the enterprise security plan. Use this checklist when you **physically split** into `casino-operations` and `casino-player` remotes.

## Repositories

| Remote | Contains |
|--------|----------|
| **casino-operations** | `services/core`, `frontend/admin-console`, `packages/*`, `scripts`, `security`, `docker-compose*.yml`, `.github/workflows` (API + admin) |
| **casino-player** | `frontend/player-ui` only, own `package.json`, staging/production API URL via env |

## Local development

1. Clone both repos as siblings, e.g. `~/work/casino-operations` and `~/work/casino-player`.
2. Open [`casino-dev.code-workspace`](../casino-dev.code-workspace) from either location (adjust `folders[].path` if your layout differs).
3. **Shared UI packages:** publish `@repo/design-tokens` / `@repo/cross-app` from operations to **GitHub Packages**; player pins semver versions.

## Migration checklist

- [ ] Choose Pattern A vs B (API-only third repo later).
- [ ] `git filter-repo` or new repos + copy; update CI.
- [ ] Operations CI: `go test`, admin build; Player CI: `vite build`, lint, no staff secrets.
- [ ] GitHub Environments: `production-admin` vs `production-player` secrets.
- [ ] Dependabot + branch protection **per repo**; stricter on operations.
- [ ] Document shared package release (changelog, semver).

## CI secrets policy

- **Player repo** must **not** receive `JWT_SECRET`, staff signing keys, or Vault root tokens.
- Player needs only public URLs, Turnstile **site** key, and optional staging credentials for E2E.
