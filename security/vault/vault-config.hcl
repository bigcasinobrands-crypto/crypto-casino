# Production-oriented Vault server config (STUB — tune for your environment).
# Reference: https://developer.hashicorp.com/vault/docs/configuration

ui = true
disable_mlock = false

listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_cert_file = "/vault/tls/tls.crt"
  tls_key_file  = "/vault/tls/tls.key"
  # tls_client_ca_file = "/vault/tls/ca.crt"  # mTLS to Vault API
}

storage "raft" {
  path = "/vault/data"
  node_id = "vault-1"
  # retry_join { leader_api_addr = "https://vault-2:8200" }
}

api_addr     = "https://vault.example:8200"
cluster_addr = "https://vault.example:8201"

# seal "awskms" { region = "us-east-1" kms_key_id = "alias/casino-vault-unseal" }

audit {
  type = "file"
  options = { file_path = "/vault/logs/audit.log" }
}

# Log forwarded to SIEM via agent (Vector / Fluent Bit).
