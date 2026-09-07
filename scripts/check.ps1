# Runs every check CI runs, in the order this repo's build actually
# requires. Two things here are not obvious enough to leave to memory:
#
#   1. The frontend must be built before any Go command touches the root
#      package. main.go embeds `all:frontend/dist`, so `go build`,
#      `go vet` and `go test` all fail with "pattern all:frontend/dist:
#      no matching files found" on a clean checkout. CI dodges this by
#      scoping its Go job to ./backend/..., which is also why the root
#      package's tests have never run in CI.
#
#   2. `./...` walks into frontend/node_modules, which ships a stray
#      vendored Go package (flatted). Go has no way to exclude a
#      directory by name, so the package list is filtered here instead.
#
# Usage:  .\scripts\check.ps1  [-SkipInstall]

[CmdletBinding()]
param(
    # Skip `npm ci` when node_modules is already in sync with the lockfile.
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# The toolchain lives outside the repo (so `npm ci` can never wipe it)
# and outside Program Files (so installing it never needed elevation).
# Override with XPECTER_TOOLS if yours is somewhere else.
$toolRoot = if ($env:XPECTER_TOOLS) { $env:XPECTER_TOOLS } else { Join-Path $env:USERPROFILE 'dev-tools' }
$nodeDir = Get-ChildItem -Path $toolRoot -Filter 'node-v*-win-x64' -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name | Select-Object -Last 1
$prefix = @(
    (Join-Path $toolRoot 'go\bin'),
    $(if ($nodeDir) { $nodeDir.FullName }),
    (Join-Path $env:USERPROFILE 'go\bin')
) | Where-Object { $_ -and (Test-Path $_) }
if ($prefix) { $env:Path = ($prefix -join ';') + ';' + $env:Path }

foreach ($tool in 'go', 'node', 'npm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is not on PATH. See CODEBOOK.md for the toolchain layout."
    }
}

$failed = @()
function Invoke-Step {
    param([string]$Name, [scriptblock]$Body)
    Write-Host ""
    Write-Host "=== $Name ===" -ForegroundColor Cyan
    & $Body
    if ($LASTEXITCODE -ne 0) {
        $script:failed += $Name
        Write-Host "FAILED: $Name (exit $LASTEXITCODE)" -ForegroundColor Red
    }
}

# --- Frontend, first, because the Go embed depends on its output ---

if (-not $SkipInstall) {
    Invoke-Step 'npm ci' { Push-Location frontend; npm ci --no-audit --no-fund; Pop-Location }
}
Invoke-Step 'tsc --noEmit' { Push-Location frontend; npx tsc --noEmit; Pop-Location }
Invoke-Step 'eslint' { Push-Location frontend; npm run lint; Pop-Location }
Invoke-Step 'vite build' { Push-Location frontend; npm run build; Pop-Location }

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "Stopping before the Go checks: the frontend build is what produces frontend/dist." -ForegroundColor Red
    Write-Host "Failed: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}

# --- Go ---

# Repo sources only. gofmt would happily report on vendored JS-adjacent
# Go files under node_modules, which are none of our business.
Invoke-Step 'gofmt' {
    $unformatted = Get-ChildItem -Recurse -Filter *.go |
        Where-Object { $_.FullName -notlike '*\node_modules\*' } |
        ForEach-Object { gofmt -l $_.FullName }
    if ($unformatted) {
        Write-Host "Not gofmt'd:" -ForegroundColor Red
        $unformatted | ForEach-Object { Write-Host "  $_" }
        $global:LASTEXITCODE = 1
    } else {
        Write-Host "clean"
        $global:LASTEXITCODE = 0
    }
}

$packages = go list ./... | Where-Object { $_ -notlike '*/node_modules/*' }
Write-Host ""
Write-Host "Go packages under test: $($packages.Count)" -ForegroundColor DarkGray

Invoke-Step 'go vet' { go vet $packages }
Invoke-Step 'go build' { go build $packages }
Invoke-Step 'go test' { go test -count=1 $packages }

Write-Host ""
if ($failed.Count -gt 0) {
    Write-Host "FAILED: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "All checks passed." -ForegroundColor Green
