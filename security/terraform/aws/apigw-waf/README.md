# AWS API Gateway + WAF (stub)

Production uses **Terraform** to provision:

- Regional or edge API Gateway in front of the Go service
- **AWS WAFv2** WebACL with OWASP **managed rule groups** (count vs block per environment)
- Optional geo match rules (legal review before block lists)

This folder is intentionally minimal—expand with your account IDs, ARNs, and CloudWatch alarms.
