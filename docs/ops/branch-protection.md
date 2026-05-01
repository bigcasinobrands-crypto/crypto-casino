# Branch protection (GitHub)

Configure in **Settings → Branches → Branch protection rule** for `main` / `master`.

## Recommended

- Require a pull request before merging
- Require status checks to pass (before merge):
  - `js`
  - `go`
  - `go-integration` (when enabled)
  - `terraform`
  - `security-scan` (optional; see workflow)
- Require branches to be up to date before merging
- Restrict who can push to matching branches
- Do **not** allow force pushes

## Environments

Use **GitHub Environments** `staging` and `production` with required reviewers for deployment workflows.

Document secrets per environment; player-facing repo must not include staff JWT or Vault root.
