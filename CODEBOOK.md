# Specter Frontend Validation Codebook

## Scope

This codebook documents frontend validation behavior for this repo when code is hosted on a Linux VM and accessed from Windows through an SSHFS mapped drive.

## Environment Pattern

- Source of truth: Linux VM filesystem (native path in VM)
- Windows access path: mapped drive `T:`
- Windows mapping type observed: `\\sshfs\<user>@<host>`

## Confirmed Symptoms

- `npm ci` or `npm install` from Windows against `T:\specter\frontend` fails with:
  - `EPERM: operation not permitted, mkdir 't:\\specter\\frontend'`
- Basic Node filesystem writes can still succeed on `T:` (mkdir/rmdir test passes).
- Frontend lint/type/build checks pass when the same folder is copied to a local Windows path (`C:\Temp\...`) and run there.
- The same failure hits any tool that creates a parent directory before it
  writes, not just npm. That includes editor/agent file-write tooling
  targeting anything under `T:\specter\frontend`, and `wails build` binding
  generation (`Error: mkdir T:\specter\frontend\wailsjs\go\main: Access is
  denied`). That binding failure is non-fatal and the build still completes,
  because nothing imports the generated bindings.
- Plain shell writes to those same paths succeed (`cp`, `>`, `>>`, heredocs).
  The constraint is specifically `mkdir` against an already-existing
  directory, so shell redirection is the reliable way to edit a file in
  place on `T:` when the local-copy workflow below is more than the change
  is worth.

## Root Cause (Operational)

- The failure is not a frontend code issue.
- The failure is an npm/arborist behavior mismatch on SSHFS-mounted paths in Windows.
- This is a filesystem/mount-layer constraint, not a project-level permissions bug.

## Canonical Validation Path

Run Node tooling in the Linux VM on the native Linux path.

```bash
cd /path/to/specter/frontend
npm ci
npm run lint
npx tsc --noEmit
npm run build
```

## Windows Testing Path

Use Windows for executable smoke tests only.

- Example binary: `build/bin/specter-test-wails.exe`
- Smoke test expectation: process starts and remains running, then can be stopped cleanly.

## Fallback Path (When VM-native tooling is unavailable)

Use a local copy on Windows for frontend checks.

```powershell
$dest='C:\Temp\specter-frontend-test'
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Path $dest | Out-Null
Copy-Item -Recurse -Force t:\specter\frontend\* $dest
npm --prefix $dest ci
npm --prefix $dest run lint
Push-Location $dest
npx tsc --noEmit
Pop-Location
npm --prefix $dest run build
```

## Permission Guidance

- Linux permission changes alone may not fix npm on Windows SSHFS mappings.
- If folder ACLs look correct but npm still fails on `T:`, prefer VM-native execution.
- Treat SSHFS path execution as read/edit-friendly but npm-install fragile.

## Decision Rule

- If command touches dependency graph (`npm ci`, `npm install`): run in VM native path.
- If command launches packaged Windows app (`*.exe`): run on Windows.
- If VM shell is unavailable: use local Windows temp copy as fallback.

## Known Non-Blocking Warnings

- Vite chunk-size warnings during production build are informational unless performance goals require tuning.
- npm audit vulnerability output should be triaged separately from build health.

## Maintenance

Update this file when any of the following changes:

- Drive mapping type (no longer SSHFS)
- npm version behavior changes on mapped drives
- Frontend script contract in `frontend/package.json`
- CI/CD execution environment and validation entrypoints
