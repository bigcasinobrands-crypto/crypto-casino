# Vault AWS KMS auto-unseal

Creates a **customer-managed KMS key** for [Vault seal / auto-unseal](https://developer.hashicorp.com/vault/docs/configuration/seal/awskms).

## Prereqs

- AWS credentials with `kms:CreateKey`, `kms:CreateAlias`, `iam` if attaching IAM policies separately
- **Terraform** >= 1.5 (or OpenTofu)

## Usage

```bash
cd security/terraform/aws/vault-kms
terraform init
terraform plan
```

## State

Use a **remote backend** (S3 + DynamoDB lock or Terraform Cloud). Do not commit `terraform.tfstate`.

## Vault config snippet (after key exists)

```hcl
seal "awskms" {
  region     = "us-east-1"
  kms_key_id = "<kms_key_arn from output>"
}
```

Grant the Vault server IAM role `kms:Encrypt`, `kms:Decrypt`, `kms:DescribeKey` on this key.
