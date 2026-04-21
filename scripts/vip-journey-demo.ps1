# Simulated VIP + bonus customer journey (console playback with pauses).
#
# Prerequisites: Core API running, migrations applied (Postgres).
# Optional: set PLAYER_JWT to a logged-in user's access token for authenticated steps.
#
# Examples (repo root, PowerShell):
#   ./scripts/vip-journey-demo.ps1
#   $env:BASE='http://localhost:8080'; $env:PLAYER_JWT='<paste jwt>'; ./scripts/vip-journey-demo.ps1 -StepSeconds 1

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
        $probe = Invoke-WebRequest -Uri ($candidate.TrimEnd('/') + '/v1/vip/program') -TimeoutSec 2 -UseBasicParsing
        if ($probe.StatusCode -eq 200) {
          $Base = $candidate.TrimEnd('/')
          break
        }
      }
    } catch {}
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
    Write-Host "   (request failed: $($_.Exception.Message))" -ForegroundColor Yellow
    return $null
  }
}

Write-Host "========================================" -ForegroundColor White
Write-Host " VIP / Bonus journey simulation (demo)  " -ForegroundColor White
Write-Host " API: $Base" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor White

Step "1) Player discovers the public VIP ladder (GET /v1/vip/program)..."
$prog = Get-Json '/v1/vip/program'
if ($prog -and $prog.tiers) {
  Write-Host "   Tiers: $($prog.tiers.Count)" -ForegroundColor Green
  $first = $prog.tiers[0]
  if ($null -ne $first) {
    $bn = 0
    if ($first.tier_benefits) { $bn = @($first.tier_benefits).Count }
    Write-Host "   First tier: $($first.name) - structured benefits rows: $bn" -ForegroundColor Green
  }
}

Step "2) Player registers / logs in (browser). Token optional for the next steps."

if (-not $Token) {
  Write-Host "   No PLAYER_JWT - skipping authenticated calls." -ForegroundColor Yellow
  Write-Host "   Tip: copy access_token from DevTools, localStorage key player_access_token" -ForegroundColor DarkGray
  Step "3) [Skipped] In production: cash wagers (game.debit) accrue lifetime_wager_minor and recalc tier_id."
  Step "4) [Skipped] On strict tier promotion, tier-up grants run (idempotent)."
  Step "5) [Skipped] Passive rebate_percent_add applies on next rebate run for matching program_key."
  Step "6) Player sees VIP badge on /profile + header (GET /v1/auth/me vip_tier). Admin search shows VIP tier."
  Write-Host ""
  Write-Host "Done (public-only)." -ForegroundColor Cyan
  exit 0
}

Step "3) Session: GET /v1/auth/me (includes vip_tier for UI badge)"
$me = Get-Json '/v1/auth/me'
if ($me) {
  $vip = $me.vip_tier
  if (-not $vip) { $vip = '(none yet - play cash to earn tier)' }
  Write-Host "   email: $($me.email); vip_tier: $vip" -ForegroundColor Green
}

Step "4) GET /v1/vip/status"
$st = Get-Json '/v1/vip/status'
if ($st) {
  $life = $st.progress.lifetime_wager_minor
  Write-Host "   tier: $($st.tier); next: $($st.next_tier); lifetime_wager_minor: $life" -ForegroundColor Green
}

Step "5) GET /v1/rewards/hub (calendar, hunt, vip, bonus instances)"
$hub = Get-Json '/v1/rewards/hub'
if ($hub -and $hub.vip) {
  Write-Host "   hub.vip.tier: $($hub.vip.tier)" -ForegroundColor Green
}

Step "6) GET /v1/wallet/bonuses"
$wb = Get-Json '/v1/wallet/bonuses'
if ($wb -and $wb.bonuses) {
  Write-Host "   bonus instances: $(@($wb.bonuses).Count)" -ForegroundColor Green
}

Step "7) Operator: Admin - Engagement - VIP system; global search Ctrl+K shows VIP tier on players."
Write-Host ""
Write-Host "Demo complete. Tier updates on profile after periodic refresh (~30s) in player UI." -ForegroundColor Cyan
