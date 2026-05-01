variable "project_id" {
  type        = string
  description = "GCP project for Cloud KMS (Vault seal)"
  default     = "YOUR_PROJECT_ID"
}

variable "region" {
  type        = string
  default     = "us-central1"
}
