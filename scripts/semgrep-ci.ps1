# Mirrors .github/workflows/security-scan.yml Semgrep step (p/golang on services/core).
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
try {
    $userBase = (& python -c "import site; print(site.getuserbase())").Trim()
    if ($userBase) {
        $scriptsDir = Join-Path $userBase 'Scripts'
        if (Test-Path $scriptsDir) {
            $env:PATH = "$scriptsDir;$env:PATH"
        }
    }
} catch {}
if (-not (Get-Command semgrep -ErrorAction SilentlyContinue)) {
    python -m pip install --user semgrep
    $userBase = (& python -c "import site; print(site.getuserbase())").Trim()
    if ($userBase) {
        $scriptsDir = Join-Path $userBase 'Scripts'
        if (Test-Path $scriptsDir) { $env:PATH = "$scriptsDir;$env:PATH" }
    }
}
Set-Location $repoRoot
semgrep scan --config p/golang --error services/core
