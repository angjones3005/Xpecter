# Xpecter Build And Validation Codebook

## Scope

How to build and validate Xpecter on the current development machine: a
Windows VM on Hyper-V, with the repo on a local NTFS path.

This replaces an earlier revision that documented a Linux VM reached from
Windows over an SSHFS mapped drive (`T:`). That setup is gone, along with
every workaround it needed. If you find advice anywhere in this repo about
running Node tooling "VM-native" or copying the frontend to `C:\Temp`
first, it is stale — nothing on a local path needs it.

## Environment

- Source of truth: local NTFS path, no mount layer, no mapped drive.
- Everything runs natively on Windows: Node tooling, Go, `wails build`,
  and the `.exe` smoke test.
- The toolchain is deliberately **not** installed machine-wide. Go and
  Node are plain zip extractions under `%USERPROFILE%\dev-tools`, which
  needs no administrator rights, so nothing here can hang on a UAC
  prompt in a non-interactive shell. Override the location by setting
  `XPECTER_TOOLS`.

| Tool | Version | Location |
|---|---|---|
| Go | 1.27.1 (go.mod requires 1.25.0) | `%USERPROFILE%\dev-tools\go\bin` |
| Node | 20.20.2 LTS (CI pins Node 20) | `%USERPROFILE%\dev-tools\node-v20.20.2-win-x64` |
| npm | 10.8.2 | ships with Node |
| Wails CLI | v2.15.0 (matches go.mod) | `%USERPROFILE%\go\bin` |
| WebView2 | 152.0.4191.66 | preinstalled with Windows 11 |

`go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0` installs the
CLI. Keep it pinned to the version in `go.mod`: a drift between the two
produces a build warning and, across larger gaps, real breakage.

## Canonical Validation Path

```powershell
.\scripts\check.ps1              # every check CI runs, in the right order
.\scripts\build.ps1              # the above, then build\bin\xpecter.exe
.\scripts\build.ps1 -SkipChecks  # fast iteration
```

Both scripts put the toolchain on `PATH` themselves, so they work from a
shell that has never seen it.

## Two Ordering Traps

These are the only non-obvious things about building this repo. Both are
encoded in `scripts/check.ps1`; they are written down here because the
failure messages do not explain themselves.

### The frontend must be built before any Go command touches the root package

`main.go` embeds `all:frontend/dist`. On a clean checkout, `go build`,
`go vet` and `go test` against the root package all fail with:

```
main.go:13:12: pattern all:frontend/dist: no matching files found
```

This is not a Go problem and not a code problem — `frontend/dist` is a
build artifact. Run `npm run build` in `frontend/` first.

CI works around this by scoping its Go job to `./backend/...`, which has
the side effect that **the root package's own tests never run in CI**.
`app_test.go` is only exercised locally, by `scripts/check.ps1`.

### `./...` walks into `frontend/node_modules`

After `npm ci`, `go list ./...` picks up a stray vendored Go package
(`flatted`) shipped inside a JS dependency:

```
?   xpecter/frontend/node_modules/flatted/golang/pkg/flatted   [no test files]
```

Go has no mechanism to exclude a directory by name, and the obvious fix
of dropping a `go.mod` into `frontend/` is not available: a nested module
would put `frontend/dist` outside the root module, and `go:embed` cannot
reach across a module boundary. So the package list is filtered by the
caller instead:

```powershell
$packages = go list ./... | Where-Object { $_ -notlike '*/node_modules/*' }
go test -count=1 $packages
```

Prefer `.\scripts\check.ps1` over typing `go test ./...` directly.

## Windows Testing Path

- Build output: `build\bin\xpecter.exe`
- Smoke test expectation: the process starts, keeps running, opens a
  window titled `Xpecter`, and spawns a `msedgewebview2.exe` child. That
  child is the real signal — without it the binary linked but the webview
  never came up, and the window would be blank.

## Known Non-Blocking Warnings

- Vite chunk-size warnings during the production build are informational.
  `index-*.js` is legitimately large; it carries Monaco.
- `npm audit` output should be triaged separately from build health.
- npm may advertise a newer major version of itself. Ignore it; CI pins
  Node 20 and its bundled npm.

## Maintenance

Update this file when any of the following changes:

- The development machine or where the repo lives
- Toolchain versions, especially the Wails CLI / `go.mod` pairing
- The frontend script contract in `frontend/package.json`
- CI/CD execution environment and validation entrypoints
- Anything that changes the two ordering traps above
