$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$vaultDir = Join-Path $root "security\vault"
if (-not (Get-Command vault -ErrorAction SilentlyContinue)) {
  Write-Host "Vault CLI not found. Install from https://developer.hashicorp.com/vault/install"
  exit 1
}
$env:VAULT_ADDR = if ($env:VAULT_ADDR) { $env:VAULT_ADDR } else { "http://127.0.0.1:8200" }
$env:VAULT_TOKEN = if ($env:VAULT_TOKEN) { $env:VAULT_TOKEN } else { "dev-root-token" }
Push-Location $vaultDir
try {
  vault secrets enable -path=casino kv-v2 2>$null
  vault secrets enable transit 2>$null
  $transitKey = if ($env:VAULT_TRANSIT_KEY_NAME) { $env:VAULT_TRANSIT_KEY_NAME } else { "player-pii" }
  vault write -f "transit/keys/$transitKey" 2>$null
  Get-ChildItem policies\*.hcl | ForEach-Object {
    $name = $_.BaseName
    vault policy write $name $_.FullName
  }
  Write-Host "Bootstrap complete. Mounts: casino/, transit/ ; Transit dev key: $transitKey ; policies from policies\*.hcl"
} finally {
  Pop-Location
}
