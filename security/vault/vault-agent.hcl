# Vault Agent — AppRole auth + template env file for Go API (stub).
# Run beside API or on host; renew leases automatically.

pid_file = "/var/run/vault-agent.pid"

vault {
  address = "https://vault.example:8200"
}

auto_auth {
  method "approle" {
    config = {
      role_id_file_path   = "/vault/approle/role_id"
      secret_id_file_path = "/vault/approle/secret_id"
    }
  }
  sink "file" {
    config = { path = "/vault/token" }
  }
}

template {
  destination = "/run/casino-api.env"
  perms       = "0640"
  contents    = <<EOT
{{- with secret "casino/data/app/api" -}}
DATABASE_URL={{ .Data.data.DATABASE_URL }}
JWT_SECRET={{ .Data.data.JWT_SECRET }}
{{- end }}
EOT
}

# exec / signal: process manager should reload API on template change (e.g. SIGHUP) or restart pod.
