# Branch protection (GitHub)

GitHub **does not** block pushes only from workflow files — you turn enforcement on in **repository settings**. After the full monorepo is pushed, configure rules so `main` cannot advance unless CI and security workflows succeed.

## Why the repo looked empty on GitHub

Only the initial README appeared because **`git push` must succeed** from a machine logged into an account with **write access** to `bigcasinobrands-crypto/crypto-casino`. Until the push completes, Actions workflows under `.github/workflows/` are not on GitHub either.

## Recommended rule for `main`

**Settings → Rules → Rulesets** (or **Settings → Branches → Branch protection rule**).

Target: branch `main`.

- **Require a pull request before merging** (optional but recommended for teams).
- **Require status checks to pass before merging**
  - Add these checks once they appear after the first successful workflow run on the repo (open the **Checks** tab on any PR or commit and copy the **exact** names GitHub shows):

| Workflow file              | Required job id (typical UI label) |
|----------------------------|------------------------------------|
| `CI`                       | `ci-passed` (often **CI / ci-passed**) — runs JS, Go, integration DB tests, **Terraform** (`security/terraform/...` including Vault KMS + WAF modules). |
| `Security scan`            | `security-passed` (often **Security scan / security-passed**) — gates Gitleaks, Trivy, gosec, Semgrep; depends on job `scan`. |

You can alternatively require the individual jobs (`js`, `go`, `terraform`, `scan`, …), but two aggregate gates (`ci-passed`, `security-passed`) are simpler to maintain.

- **Require branches to be up to date before merging** (recommended with teams).
- **Do not** allow force pushes (unless you have a documented exception process).

### Terraform & Vault in CI

The **`terraform`** job in `.github/workflows/ci.yml` runs `terraform fmt -check`, `validate`, and **tflint** on:

- `security/terraform/aws/vault-kms`
- `security/terraform/aws/apigw-waf`
- `security/terraform/gcp`

No live Vault cluster is contacted — only static validation of infra-as-code.

### Manual runs

Both **CI** and **Security scan** workflows support **workflow_dispatch** (Actions tab → workflow → **Run workflow**) for on-demand runs.

## Environments

Use **GitHub Environments** `staging` and `production` with required reviewers for deployment workflows (secrets per env).

Document secrets per environment; player-facing repo must not include staff JWT or Vault root.
