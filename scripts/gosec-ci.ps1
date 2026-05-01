# Mirrors .github/workflows/security-scan.yml Gosec invocation (strict profile).
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location (Join-Path $repoRoot 'services\core')

$goBin = Join-Path (& go env GOPATH).Trim() 'bin'
if ($env:PATH -notlike "*$goBin*") {
    $env:PATH = "$goBin;$env:PATH"
}
if (-not (Get-Command gosec -ErrorAction SilentlyContinue)) {
    go install github.com/securego/gosec/v2/cmd/gosec@latest
}

gosec -severity=high -confidence=high -exclude-dir=internal/e2e -exclude-dir=internal/bonuse2e -fmt=text ./cmd/... ./internal/...
