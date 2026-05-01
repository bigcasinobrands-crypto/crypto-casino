#!/usr/bin/env bash
# Exit 1 if certificate expires within WARNING_DAYS (default 30). GNU date required.
# Usage:
#   ./check_cert_expiry.sh https://api.example.com
#   ./check_cert_expiry.sh /path/to/cert.pem
set -euo pipefail
WARNING_DAYS="${WARNING_DAYS:-30}"
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "usage: $0 <https://host|path/to.pem>" >&2
  exit 2
fi

not_after_to_epoch() {
  local not_after="$1"
  date -d "$not_after" +%s
}

if [[ -f "$TARGET" ]]; then
  NOT_AFTER=$(openssl x509 -enddate -noout -in "$TARGET" | sed 's/^notAfter=//')
  EXP_EPOCH=$(not_after_to_epoch "$NOT_AFTER")
else
  U="${TARGET#http://}"
  U="${U#https://}"
  HOST="${U%%/*}"
  PORT=443
  if [[ "$HOST" == *:* ]]; then
    HOSTONLY="${HOST%:*}"
    PORT="${HOST##*:}"
    HOST="$HOSTONLY"
  fi
  NOT_AFTER=$(echo | openssl s_client -servername "$HOST" -connect "${HOST}:${PORT}" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//' || true)
  if [[ -z "${NOT_AFTER:-}" ]]; then
    echo "error: could not fetch certificate for $TARGET" >&2
    exit 1
  fi
  EXP_EPOCH=$(not_after_to_epoch "$NOT_AFTER")
fi

NOW=$(date +%s)
WARN_SEC=$((WARNING_DAYS * 86400))
LEFT=$((EXP_EPOCH - NOW))
if (( LEFT < WARN_SEC )); then
  echo "CRITICAL: certificate expires in $((LEFT / 86400)) day(s) ($TARGET)" >&2
  exit 1
fi
echo "OK: certificate for $TARGET expires in $((LEFT / 86400)) day(s)"
