#!/usr/bin/env bash
# Mirrors .github/workflows/security-scan.yml Gosec invocation (strict profile).
set -euo pipefail
cd "$(dirname "$0")/../services/core"
export PATH="$(go env GOPATH)/bin:$PATH"
command -v gosec >/dev/null 2>&1 || go install github.com/securego/gosec/v2/cmd/gosec@latest
exec gosec -severity=high -confidence=high -exclude-dir=internal/e2e -exclude-dir=internal/bonuse2e -fmt=text ./cmd/... ./internal/...
