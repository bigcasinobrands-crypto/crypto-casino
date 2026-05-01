provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "vault_unseal" {
  description             = "Encrypt Vault seal / auto-unseal material for crypto-casino operations"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name = "vault-unseal-${var.region}"
  })
}

resource "aws_kms_alias" "vault_unseal" {
  name          = "alias/${var.key_alias}"
  target_key_id = aws_kms_key.vault_unseal.key_id
}

output "kms_key_arn" {
  description = "Pass to Vault seal stanza (AWS KMS auto-unseal)"
  value       = aws_kms_key.vault_unseal.arn
}

output "kms_key_id" {
  value = aws_kms_key.vault_unseal.key_id
}

output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}
