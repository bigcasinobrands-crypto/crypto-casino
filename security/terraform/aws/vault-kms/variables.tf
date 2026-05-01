variable "region" {
  type        = string
  description = "AWS region for the KMS key used by Vault auto-unseal"
  default     = "us-east-1"
}

variable "key_alias" {
  type        = string
  description = "KMS alias name (without alias/ prefix)"
  default     = "casino-vault-unseal"
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to the KMS key"
  default     = {}
}
