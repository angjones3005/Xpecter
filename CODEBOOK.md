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

The frontend has unit tests too (`npm test` in `frontend/`, Vitest),
for the pure pieces that were pulled out of `main.ts` so they could be
tested: ANSI colour-state reading (`ansi.ts`), shell quoting
(`shellquote.ts`), the Markdown task-marker scan (`markdown.ts`),
paste line splitting (`paste.ts`), the saved-workspace format
(`workspace.ts`), tag colours and guards (`tags.ts`), custom highlight
rules (`highlightrules.ts`) and the OSC 7 and hex-dump helpers (`osc.ts`).
`check.ps1` and CI run them between eslint and the Vite build. Anything
that touches the DOM stays in `main.ts` and is exercised in the running
app instead.

## The Frontend Build Has A Prepare Step

`npm run dev` and `npm run build` both run `npm run prepare-assets`
first, which copies PDF.js's standard PDF fonts out of `node_modules`
into `frontend/public/pdfjs/`. Vite serves and ships `public/` verbatim,
so this is what puts those fonts under the served root in both dev and
production.

They are copied rather than committed: they are third-party binaries
that pdfjs-dist already carries, and `frontend/public/pdfjs/` is
gitignored. The consequence to know about is that **`vite` and `vite
build` must not be invoked directly** — do that and the directory is
missing, and PDFs that name a standard font without embedding it render
with the wrong fonts or not at all. Use the npm scripts, which every
other entrypoint here (`scripts/check.ps1`, `scripts/build.ps1`,
`wails build`, CI) already does.

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
The root package's tests (`app_test.go`, `forwards_test.go`, `putty_test.go`, `search_test.go`, `sudosave_test.go` and the rest) are only exercised locally, by `scripts/check.ps1`.

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

## Release Signing

Unsigned Go binaries built minutes before download are what Defender on
a managed machine deletes on sight, and what SmartScreen warns about on
any machine. The release workflow therefore code-signs the Windows exe
and the NSIS installer through **Azure Artifact Signing** (Microsoft's
cloud signing service, previously called Trusted Signing). The runner
never holds a certificate; it authenticates to the service and asks it
to sign a hash, and the signature is RFC 3161 timestamped so it outlives
the certificate.

Signing is switched on by the presence of six repository secrets. When
they are absent every signing step is skipped and the release ships
unsigned, so a fork still builds.

| Secret | What it is |
|---|---|
| `AZURE_TENANT_ID` | The Entra tenant of the Azure subscription |
| `AZURE_CLIENT_ID` | An app registration (service principal) given the **Artifact Signing Certificate Profile Signer** role on the signing account |
| `AZURE_CLIENT_SECRET` | A client secret for that app registration — **or** leave this out and set `AZURE_SUBSCRIPTION_ID` with a federated (OIDC) credential on the app registration for `repo:angjones3005/Xpecter:ref:refs/tags/*`, which is what Azure's own guide sets up |
| `SIGNING_ENDPOINT` | The account's regional endpoint, e.g. `https://eus.codesigning.azure.net` |
| `SIGNING_ACCOUNT_NAME` | The Artifact Signing account name |
| `SIGNING_PROFILE_NAME` | The certificate profile (Public Trust) inside that account |

They must be **repository** secrets (Settings → Secrets and variables →
Actions → Repository secrets), not environment secrets and not
variables: the build job declares no environment. The Windows job's
step list shows one "Signing: … is set" step per secret; a skipped one
is a secret the workflow could not see.

Setting it up, once:

1. In the Azure portal create an **Artifact Signing** account (Basic tier
   is enough), then an **identity validation** for the publisher. This is
   the step that takes time: Microsoft verifies the legal identity the
   certificate will name, an organisation or, in supported countries, an
   individual.
2. Once validated, add a **certificate profile** of type Public Trust.
3. Create an app registration, give it a client secret, and assign it
   the Certificate Profile Signer role on the signing account.
4. Add the six secrets to the GitHub repository and push a tag.

The signed publisher name is what a company's IT department allow-lists,
so ask them for a publisher rule rather than a per-release hash rule.
Every release also publishes `SHA256SUMS.txt` for hash-based rules.

The version resource matters too. `wails.json`'s `info` block supplies
the company, product, copyright and version strings Explorer shows under
Properties → Details, and the release workflow stamps the tag into
`productVersion` before building. To check them, read the file the way
Explorer does (`Shell.Application` → `GetDetailsOf`): PowerShell 5.1's
`(Get-Item x.exe).VersionInfo` shows blanks for these exes even though
the resource is correct, which cost an hour of chasing nothing.

## Maintenance

Update this file when any of the following changes:

- The development machine or where the repo lives
- Toolchain versions, especially the Wails CLI / `go.mod` pairing
- The frontend script contract in `frontend/package.json`
- CI/CD execution environment and validation entrypoints
- Anything that changes the two ordering traps above
