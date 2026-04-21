# Bonus smoke checks (API). Set BASE and PLAYER_JWT, then run from repo root:
#   $env:BASE='http://localhost:8080'; $env:PLAYER_JWT='<access_token>'; ./scripts/e2e-bonus-smoke.ps1
# Prerequisites: core API up, migrations applied, player logged in (JWT from browser devtools or login response).

param(
  [string] $Base = $env:BASE,
  [string] $Token = $env:PLAYER_JWT
)

$ErrorActionPreference = 'Stop'
if (-not $Base) { $Base = 'http://localhost:8080' }
$Base = $Base.TrimEnd('/')

$headers = @{ Accept = 'application/json' }
if ($Token) { $headers['Authorization'] = "Bearer $Token" }

function Invoke-Json([string] $Method, [string] $Path) {
  $uri = "$Base$Path"
  Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

Write-Host "== Bonus E2E smoke ($Base) ==" -ForegroundColor Cyan

Write-Host "`n1) GET /v1/bonuses/available (optional auth improves eligibility)..."
try {
  $offers = Invoke-Json GET '/v1/bonuses/available'
  $n = @($offers.offers).Count
  Write-Host "   offers count: $n" -ForegroundColor Green
} catch {
  Write-Host "   FAILED: $_" -ForegroundColor Yellow
}

if (-not $Token) {
  Write-Host "`nSkip authenticated steps (set PLAYER_JWT)." -ForegroundColor Yellow
  exit 0
}

Write-Host "`n2) GET /v1/wallet/bonuses ..."
$wb = Invoke-Json GET '/v1/wallet/bonuses'
$bn = @($wb.bonuses).Count
Write-Host "   instances: $bn; bonus_locked_minor: $($wb.wallet.bonus_locked_minor)" -ForegroundColor Green

$first = @($wb.bonuses) | Select-Object -First 1
if ($first -and ($first.status -eq 'active' -or $first.status -eq 'pending')) {
  Write-Host "`n3) POST forfeit on first active/pending instance (skipped by default)..."
  Write-Host "   Uncomment the next lines in the script to actually forfeit id=$($first.id)"
  # $body = '{}' | ConvertTo-Json
  # Invoke-RestMethod -Method POST -Uri "$Base/v1/wallet/bonuses/$($first.id)/forfeit" -Headers $headers -ContentType 'application/json' -Body '{}'
} else {
  Write-Host "`n3) No active/pending instance to forfeit (ok)." -ForegroundColor DarkGray
}

Write-Host "`nDone." -ForegroundColor Cyan
