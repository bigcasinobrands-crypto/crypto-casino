#!/usr/bin/env bash
# Mirrors .github/workflows/security-scan.yml Semgrep step (p/golang on services/core).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! command -v semgrep >/dev/null 2>&1; then
  python3 -m pip install --user semgrep
  export PATH="$HOME/.local/bin:$PATH"
fi
exec semgrep scan --config p/golang --error services/core
