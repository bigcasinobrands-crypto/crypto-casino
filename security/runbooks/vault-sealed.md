# Runbook: Vault sealed

1. Confirm seal status (`vault status`) and identify cause (restart, KMS, quorum loss).
2. Unseal per organization key ceremony — never share vault unseal keys in Slack.
3. If using AWS KMS auto-unseal, verify IAM + KMS key policies and CloudTrail.
4. Once unsealed, verify API pods reload secrets and `/health/ready` is green.
