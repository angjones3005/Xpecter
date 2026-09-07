# Runs the full check suite, then produces build\bin\xpecter.exe.
#
# Usage:  .\scripts\build.ps1 [-SkipChecks] [-SkipInstall] [-Version dev]

[CmdletBinding()]
param(
    # Build without running the checks first. For a quick iteration loop
    # only: `wails build` runs its own frontend build, so a broken type
    # or lint error will still produce an exe if you skip these.
    [switch]$SkipChecks,
    [switch]$SkipInstall,
    # Stamped into main.Version, the same variable the release workflow
    # fills with the git tag.
    [string]$Version = 'dev'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if (-not $SkipChecks) {
    & (Join-Path $PSScriptRoot 'check.ps1') -SkipInstall:$SkipInstall
    if ($LASTEXITCODE -ne 0) { throw 'Checks failed; not building.' }
}

$toolRoot = if ($env:XPECTER_TOOLS) { $env:XPECTER_TOOLS } else { Join-Path $env:USERPROFILE 'dev-tools' }
$nodeDir = Get-ChildItem -Path $toolRoot -Filter 'node-v*-win-x64' -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name | Select-Object -Last 1
$prefix = @(
    (Join-Path $toolRoot 'go\bin'),
    $(if ($nodeDir) { $nodeDir.FullName }),
    (Join-Path $env:USERPROFILE 'go\bin')
) | Where-Object { $_ -and (Test-Path $_) }
if ($prefix) { $env:Path = ($prefix -join ';') + ';' + $env:Path }

if (-not (Get-Command wails -ErrorAction SilentlyContinue)) {
    throw "wails is not on PATH. Install it with: go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0"
}

Write-Host ""
Write-Host "=== wails build ===" -ForegroundColor Cyan
wails build -platform windows/amd64 -ldflags "-X main.Version=$Version"
if ($LASTEXITCODE -ne 0) { throw "wails build failed (exit $LASTEXITCODE)" }

$exe = Join-Path $repo 'build\bin\xpecter.exe'
if (-not (Test-Path $exe)) { throw "Build reported success but $exe is missing." }
$info = Get-Item $exe
Write-Host ""
Write-Host ("Built {0} ({1:N1} MB) at {2}" -f $exe, ($info.Length / 1MB), $info.LastWriteTime) -ForegroundColor Green
