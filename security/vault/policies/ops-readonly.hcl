# Read-only troubleshooting: list + read under casino/ — no writes.

path "casino/data/*" {
  capabilities = ["read"]
}

path "casino/metadata/*" {
  capabilities = ["list", "read"]
}
