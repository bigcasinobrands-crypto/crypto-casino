# ELEVATED — attach only to short-lived tokens after dual-superadmin break_glass approval.
# Revoke token when grant is consumed or expired.

path "casino/data/*" {
  capabilities = ["read", "create", "update"]
}

path "casino/delete/*" {
  capabilities = ["update"]
}

path "casino/destroy/*" {
  capabilities = ["update"]
}

path "casino/metadata/*" {
  capabilities = ["list", "read", "delete"]
}

path "sys/policies/*" {
  capabilities = ["read", "list"]
}
