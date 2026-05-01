# Runbook: Vault Transit operators

## When to use

- Rotating Transit keys, investigating decrypt failures, or recovering from sealed Vault.

## Preconditions

- Valid operator token **or** Vault Agent/Kubernetes auth with Transit encrypt/decrypt policy.
- `VAULT_ADDR`, mount path, and `VAULT_TRANSIT_KEY_NAME` match application configuration.

## Encrypt/decrypt smoke test

Use the Vault CLI from a trusted admin host (never from player-facing systems):

```bash
vault write -f transit/encrypt/$KEY_NAME plaintext=$(echo -n "smoke" | base64)
vault write transit/decrypt/$KEY_NAME ciphertext="vault:v1:..."
```

## Rotation

1. Enable a new key version in Transit (`vault write -f transit/keys/$KEY_NAME/rotate`).
2. Application should prefer latest version for **encrypt**; **decrypt** accepts older ciphertext versions until re-encrypted.
3. Plan re-wrap or lazy re-encrypt for hot columns per product requirements.

## Sealed Vault

If pods cannot decrypt PII: follow [`vault-sealed.md`](vault-sealed.md); restore auto-unseal; verify Transit health; scale core API after Vault is unsealed.

## Escalation

- If ciphertext corruption suspected: freeze writes, snapshot DB, involve security + DPO before destructive fixes.
