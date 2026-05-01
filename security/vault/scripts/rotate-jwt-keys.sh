#!/usr/bin/env bash
# Rotate JWT RSA keys in Vault KV with kid overlap (deploy new key, dual-sign window, retire old).
set -euo pipefail
echo "1) Generate new RSA keypair; upload to Vault path casino/data/app/jwt with kid v2"
echo "2) Deploy API with support for multiple kids in JWKS (extend jwtissuer if needed)"
echo "3) After overlap window, remove old kid from JWKS and revoke old private material"
