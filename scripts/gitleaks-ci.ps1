# Matches CI Gitleaks — full git scan from repo root (requires gitleaks on PATH).
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot
if (-not (Get-Command gitleaks -ErrorAction SilentlyContinue)) {
    Write-Error "Install gitleaks: go install github.com/zricethezav/gitleaks/v8@latest"
}
gitleaks detect --source $repoRoot --verbose
