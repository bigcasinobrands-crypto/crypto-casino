# Runbook: Staff WebAuthn / MFA

## Symptoms

- `mfa_not_enrolled` on login after enforcement enabled.
- `webauthn_not_configured` / `redis_required` from API.
- Users stuck after password; browser shows WebAuthn prompt then fails.

## Checks

1. **Redis** — MFA pending sessions live in Redis; verify `REDIS_URL` and connectivity from API pods.
2. **WebAuthn env** — `WEBAUTHN_RP_ID` must equal the registrable domain (e.g. `localhost` for dev, `admin.example.com` prod); `WEBAUTHN_RP_ORIGINS` must include the exact admin SPA origin (scheme + host + port).
3. **CORS** — Admin origin allowed; preflight allows `X-WebAuthn-Session-Key`, `X-MFA-Token`.
4. **Clock skew** — Large skew can break assertion validation.

## Recovery

- **Lost passkey:** Use break-glass / superadmin procedure: temporarily disable `mfa_webauthn_enforced` for the user in Staff users, have them re-enroll on **Security keys**, re-enable enforcement.
- **Bad deploy:** Roll back API; pending MFA tokens in Redis expire per TTL — users retry login.

## Post-incident

- Capture `request_id` from client; grep JSON logs for `webauthn_*` and `mfa_*` error codes.
