#!/usr/bin/env bash
# Example: alert when TLS certs or Vault PKI leaf certs approach expiry.
set -euo pipefail
THRESHOLD_DAYS="${1:-14}"
openssl s_client -connect "${VAULT_HOST:-127.0.0.1}:${VAULT_TLS_PORT:-8200}" -servername "${VAULT_SERVER_NAME:-}" </dev/null 2>/dev/null \
  | openssl x509 -noout -dates || true
echo "Set up cron + Prometheus blackbox or x509_exporter; threshold ${THRESHOLD_DAYS}d"
