# Terraform remote state

**Never commit** `terraform.tfstate` or `*.tfstate.*`.

## AWS (recommended sketch)

```hcl
terraform {
  backend "s3" {
    bucket         = "your-org-tf-state"
    key            = "casino/security/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}
```

Use a **dedicated** state bucket with versioning + MFA delete protection.

## Alternatives

- **Terraform Cloud** workspace per stack (`vault-kms`, `apigw-waf`).
- **GCP** GCS backend with bucket uniform access.

CI should run `terraform plan` read-only against staging credentials on pull requests that touch `*.tf`.
