# Stub: Cloud KMS for Vault auto-unseal on GCP. Uncomment resources when targeting GCP.
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Example (enable when ready):
#
# resource "google_kms_key_ring" "vault" {
#   name     = "vault-unseal"
#   location = var.region
# }
#
# resource "google_kms_crypto_key" "vault_unseal" {
#   name            = "vault-auto-unseal"
#   key_ring        = google_kms_key_ring.vault.id
#   rotation_period = "7776000s"
#   purpose         = "ENCRYPT_DECRYPT"
# }
