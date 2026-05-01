# Project plan: MFA / WebAuthn + admin UX

## Outcome

Staff who have **MFA WebAuthn enforced** complete password login, then assert a **registered passkey**. Superadmins toggle enforcement per user; staff manage keys in the **Security keys** page (`/system/security-keys`).

## In-repo deliverables

- API: Redis-backed MFA pending + register/finish handlers (`staffauth`).
- Admin SPA: login step-up, passkey enrollment, staff directory MFA toggle.

## Phases

1. **Config** — Set `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_DISPLAY_NAME`, `WEBAUTHN_RP_ORIGINS` on core; align with admin SPA origin. **Redis required**.
2. **Enrollment** — Staff register at least one passkey before enforcement is enabled for that account.
3. **Enforcement** — Superadmin enables `mfa_webauthn_enforced`; verify `mfa_not_enrolled` when no credentials.
4. **Break-glass** — Document superadmin recovery if passkeys lost (platform procedure, not code).

Runbook: [`../../runbooks/staff-webauthn-mfa.md`](../../runbooks/staff-webauthn-mfa.md).
