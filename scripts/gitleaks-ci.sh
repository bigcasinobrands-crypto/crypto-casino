#!/usr/bin/env bash
# Matches CI: gitleaks scans full git history from repo root (requires gitleaks on PATH).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "install gitleaks: go install github.com/zricethezav/gitleaks/v8@latest" >&2
  exit 1
fi
exec gitleaks detect --source "$ROOT" --verbose
