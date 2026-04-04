# SDLC: CI & branch protection

- **CI:** `.github/workflows/ci.yml` — builds admin/player, `go vet` + `go build` for `api`, `bootstrap`, `worker`, `playerbootstrap`.
- **Dependabot:** `.github/dependabot.yml` for npm + Go modules.
- **GitHub settings (manual):** enable branch protection on `main` — require PR, required status checks, block force-push.
- **Secrets:** never commit `.env`; use repository Actions secrets for CI if needed.
- **govulncheck:** add to CI when stabilised (`go install golang.org/x/vuln/cmd/govulncheck@latest`).
