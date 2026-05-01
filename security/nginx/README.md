# Nginx / edge hardening (examples)

Production **admin** APIs should not rely on Kong OSS alone for IP allowlisting. Terminate TLS at **nginx**, **Envoy**, **AWS ALB + WAF**, or **Cloudflare** with an explicit allowlist for `/v1/admin`.

## Files

| File | Purpose |
|------|---------|
| [`admin-internal.example.conf`](admin-internal.example.conf) | Sample `server` block: allow RFC-1918 + VPN CIDRs; proxy to upstream API. **Copy and adapt** hostnames, certs, and `allow` lists. |

Keep real configs in your Terraform / Helm repo if this monorepo does not deploy nginx.
