# Rewards hub + bonus surfaces (API walkthrough with pauses).
# Optional PLAYER_JWT for authenticated endpoints.
#
#   npm run demo:rewards
#   $env:PLAYER_JWT='...'; npm run demo:rewards
#   $env:BASE='http://127.0.0.1:9090'; $env:PLAYER_JWT='...'; ./scripts/rewards-bonus-demo.ps1

param(
  [string] $Base = $env:BASE,
  [string] $Token = $env:PLAYER_JWT,
  [int] $StepSeconds = 2
)

$ErrorActionPreference = 'Continue'

if (-not $Base -or $Base.Trim() -eq '') {
  $Base = $null
  foreach ($candidate in @('http://127.0.0.1:9090', 'http://127.0.0.1:8080', 'http://localhost:9090', 'http://localhost:8080')) {
    try {
      $r = Invoke-WebRequest -Uri ($candidate.TrimEnd('/') + '/health') -TimeoutSec 2 -UseBasicParsing
      if ($r.StatusCode -eq 200) {
        $probe = Invoke-WebRequest -Uri ($candidate.TrimEnd('/') + '/v1/vip/program') -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($probe -and $probe.StatusCode -eq 200) {
          $Base = $candidate.TrimEnd('/')
          break
        }
      }
    } catch {}
  }
  if (-not $Base) {
    foreach ($candidate in @('http://127.0.0.1:9090', 'http://127.0.0.1:8080')) {
      try {
        $r = Invoke-WebRequest -Uri ($candidate.TrimEnd('/') + '/health') -TimeoutSec 2 -UseBasicParsing
        if ($r.StatusCode -eq 200) { $Base = $candidate.TrimEnd('/'); break }
      } catch {}
    }
  }
  if (-not $Base) { $Base = 'http://127.0.0.1:8080' }
}
$Base = $Base.TrimEnd('/')

$headers = @{ Accept = 'application/json' }
if ($Token) { $headers['Authorization'] = "Bearer $Token" }

function Step([string] $Message) {
  Write-Host ""
  Write-Host $Message -ForegroundColor Cyan
  Start-Sleep -Seconds $StepSeconds
}

function Get-Json([string] $Path) {
  try {
    return Invoke-RestMethod -Method GET -Uri ($Base + $Path) -Headers $headers
  } catch {
    Write-Host "   (GET failed: $($_.Exception.Message))" -ForegroundColor Yellow
    return $null
  }
}

function Post-Json([string] $Path, [string] $Body = '{}') {
  try {
    $ph = @{ Accept = 'application/json' }
    if ($Token) { $ph['Authorization'] = "Bearer $Token" }
    return Invoke-RestMethod -Method POST -Uri ($Base + $Path) -Headers $ph -ContentType 'application/json' -Body $Body
  } catch {
    Write-Host "   (POST failed: $($_.Exception.Message))" -ForegroundColor Yellow
    return $null
  }
}

Write-Host "========================================" -ForegroundColor White
Write-Host " Rewards + bonus demo (player API)      " -ForegroundColor White
Write-Host " API: $Base" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor White

Step "1) Published offers (GET /v1/bonuses/available) -> marketing tiles on /rewards"
$off = Get-Json '/v1/bonuses/available'
if ($off -and $off.offers) {
  $n = @($off.offers).Count
  Write-Host "   offers: $n" -ForegroundColor Green
  if ($n -gt 0) {
    $o0 = $off.offers[0]
    Write-Host "   example: $($o0.title) (pv $($o0.promotion_version_id))" -ForegroundColor DarkGreen
  }
}

Step "2) VIP ladder blurbs (GET /v1/vip/program) -> /vip page"
$vip = Get-Json '/v1/vip/program'
if ($vip -and $vip.tiers) {
  Write-Host "   public tiers: $(@($vip.tiers).Count)" -ForegroundColor Green
}

if (-not $Token) {
  Write-Host ""
  Write-Host "No PLAYER_JWT - skipping hub, calendar (auth), wallet bonuses, daily claim." -ForegroundColor Yellow
  Write-Host "Admin (browser): Bonus Engine -> Promotions, Player layout, Operations, Risk." -ForegroundColor DarkGray
  Write-Host "Player preview: /rewards/preview (no login)." -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "Done (public-only)." -ForegroundColor Cyan
  exit 0
}

Step "3) Full hub (GET /v1/rewards/hub) -> live /rewards grid"
$hub = Get-Json '/v1/rewards/hub'
if ($hub) {
  $cal = 0
  if ($hub.calendar) { $cal = @($hub.calendar).Count }
  $ao = 0
  if ($hub.available_offers) { $ao = @($hub.available_offers).Count }
  $bi = 0
  if ($hub.bonus_instances) { $bi = @($hub.bonus_instances).Count }
  Write-Host "   calendar days: $cal; available_offers: $ao; bonus_instances: $bi" -ForegroundColor Green
  if ($hub.vip) {
    Write-Host "   vip.tier: $($hub.vip.tier)" -ForegroundColor Green
  }
  if ($hub.aggregates) {
    Write-Host "   bonus_locked_minor: $($hub.aggregates.bonus_locked_minor)" -ForegroundColor DarkGreen
  }
}

Step "4) Calendar slice (GET /v1/rewards/calendar?days=7)"
$cal = Get-Json '/v1/rewards/calendar?days=7'
if ($cal -and $cal.calendar) {
  Write-Host "   calendar entries: $(@($cal.calendar).Count)" -ForegroundColor Green
}

Step "5) Wallet bonus instances (GET /v1/wallet/bonuses)"
$wb = Get-Json '/v1/wallet/bonuses'
if ($wb -and $wb.bonuses) {
  Write-Host "   instances: $(@($wb.bonuses).Count)" -ForegroundColor Green
}

Step "6) Daily claim attempt (POST /v1/rewards/daily/claim) - may 409 if already claimed or active WR"
$claimDate = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
$claimBody = (@{ date = $claimDate } | ConvertTo-Json -Compress)
$claim = Post-Json '/v1/rewards/daily/claim' $claimBody
if ($claim) {
  Write-Host "   response: $($claim | ConvertTo-Json -Compress)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Operator map: Admin -> Bonus Engine -> 'Player layout' = rewards API field map + program list." -ForegroundColor DarkGray
Write-Host "Done." -ForegroundColor Cyan
