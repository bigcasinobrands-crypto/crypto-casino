# GCP Cloud KMS stub (Vault auto-unseal)

`main.tf` holds a minimal **Terraform + Google provider** stub so CI can **`terraform validate`** / **tflint** the directory. Uncomment resources when provisioning Cloud KMS.

Example resources (also commented in `main.tf`):

```text
# resource "google_kms_key_ring" "vault" { name = "vault" location = var.region }
# resource "google_kms_crypto_key" "unseal" { name = "vault-unseal" key_ring = google_kms_key_ring.vault.id }
```

Use separate service account + `cloudkms.cryptoKeyVersions.useToEncrypt` for Vault only.
