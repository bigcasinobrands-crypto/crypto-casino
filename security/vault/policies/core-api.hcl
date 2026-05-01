# Least-privilege policy for casino-api / worker (KV v2 read on integration paths).

path "casino/data/integrations/*" {
  capabilities = ["read"]
}

path "casino/metadata/integrations/*" {
  capabilities = ["list", "read"]
}

path "casino/data/app/*" {
  capabilities = ["read"]
}

path "casino/metadata/app/*" {
  capabilities = ["list", "read"]
}

# Transit secrets engine — encrypt/decrypt for PII (mount path must match VAULT_TRANSIT_MOUNT, default "transit").
path "transit/encrypt/*" {
  capabilities = ["update"]
}

path "transit/decrypt/*" {
  capabilities = ["update"]
}
