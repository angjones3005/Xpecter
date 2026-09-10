# Xpecter

A cross-platform terminal: SSH client, local shell, serial console, and remote file editor, in one lightweight app. A **Dawnrail** project.

Licensed under [GPLv3](LICENSE).

## What is this?

Xpecter is built to cover the SSH-and-serial-console workflow without the bloat of a full-featured tool that does forty things you'll never touch. It runs the same way on Windows, macOS, and Linux.

**Core features:**
- SSH connections with real host key verification, password or key-based auth
- Local shell tabs (including Command Prompt / PowerShell specifically on Windows)
- Direct serial/COM port console access, for connecting straight to network hardware
- A built-in file browser and Monaco-based code editor for remote files, with drag-and-drop upload
- A PDF viewer in the same panes as the editor, for files here or on a host
- Saved Remote Desktop (RDP) sessions, opened in your system's Remote Desktop client with the address, user and display filled in
- Session organization: folders, drag-and-drop, quick-connect search, recent sessions, tags
- Dark/Light theming
- Clipboard sync between the local OS and remote sessions (OSC 52), plus optional auto-copy-on-select
- A MobaXterm-style session picker and top menu bar (Terminal / Sessions / View / Tools / Settings)

## Installing

Download the build for your platform from the [Releases page](https://github.com/angjones3005/Xpecter/releases), then run it.

- **Windows**: unzip and run `xpecter.exe`.
- **macOS**: unzip and run the app. Since this isn't a signed/notarized build yet, you'll likely need to right-click the app and choose **Open** the first time, rather than double-clicking, to get past Gatekeeper's unsigned-app warning.
- **Linux**: extract the archive and run the `xpecter` binary. No install step required.

No account, no setup wizard. Open it, and use **Sessions > New Session** (or the **+ New Session** button on a fresh tab) to connect.

## Known limitations (beta)

This is an early beta. A few things worth knowing going in:

- **macOS**: builds successfully in CI, but hasn't yet been verified running on real Mac hardware. If you hit anything odd on Mac specifically, that's genuinely useful to report.
- **Serial console support is new** and hasn't yet been tested against real hardware, if you try it, feedback here is especially valuable.
- **No password saving, by design.** Saved sessions store host/user/port/key path only, never passwords. This is intentional (see "Session storage" below), not a bug.
- **Windows ConPTY**: verified working for the default shell and Command Prompt; the PowerShell-specific path and a few edge cases (resize behavior, very old Windows versions, process cleanup) haven't been separately stress-tested yet.
- No drag-and-drop *download* yet (remote file to local), only upload (local file to remote) is supported for now.

None of these should stop you from using it day to day, they're just the honest edges of an early build.

## What to report

If something breaks, feels missing, or you'd expect it to work differently, that's exactly the kind of feedback that's useful right now. Anything from "this crashed" to "I wish X worked like Y" is fair game.

---

## For developers

Quick troubleshooting reference: [CODEBOOK.md](CODEBOOK.md)

### What's here

- `main.go`, `app.go` — Wails entrypoint and the bound methods the frontend calls
- `backend/sshclient/` — SSH dial + interactive shell over `golang.org/x/crypto/ssh`, with real host key verification (`known_hosts`-based trust-on-first-use, not `InsecureIgnoreHostKey`)
- `backend/sftpclient/` — remote directory listing, file read/write, and binary-safe upload
- `backend/pty/` — local shell PTY, Unix via `creack/pty`, Windows via `UserExistsError/conpty` (ConPTY, needs Windows 10 1809+), supports requesting a specific shell (e.g. `cmd.exe`, `powershell.exe`)
- `backend/serialclient/` — direct serial/COM port console access via `go.bug.st/serial`, for connecting to network hardware consoles
- `backend/config/sessions.go` — saved connection profiles and session groups as plain JSON (host/user/port/keyPath/groupId/tags only, no passwords, see rationale in that file)
- `frontend/` — xterm.js terminal + Monaco editor pane, split-pane layout, plain **TypeScript** + Vite (no framework)

### A note on performance

If Xpecter feels sluggish while developing (typing lag, general UI slowness), test with a production build (`wails build`) before assuming it's a real bug. `wails dev` carries real overhead (unminified assets, dev server round-trips, hot-reload machinery) that doesn't reflect the actual app's performance.

### Setup

You'll need Go 1.22+, Node 18+, and the Wails CLI installed locally:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Then from the project root:

```bash
wails dev     # live dev mode
wails build   # produces a native binary per platform
```

### Build and validation on Windows

```powershell
.\scripts\check.ps1              # every check CI runs, in the right order
.\scripts\build.ps1              # the above, then build\bin\xpecter.exe
```

One ordering trap is worth knowing before you run Go commands by hand:
`main.go` embeds `all:frontend/dist`, so on a clean checkout `go build`,
`go vet` and `go test` against the root package fail with `pattern
all:frontend/dist: no matching files found` until the frontend has been
built. Run `npm run build` in `frontend/` first, or just use the scripts.

See [CODEBOOK.md](CODEBOOK.md) for the toolchain layout and the other trap
(`./...` walking into `frontend/node_modules`).

On Linux, the build may need `-tags webkit2_41` depending on your distro's `webkit2gtk` version:

```bash
wails build -tags webkit2_41
```

### Roadmap / open work

Actively tracked in Linear. Notable open items:
- Tmux-style pane multiplexing
- Visual port-forwarding manager
- MobaXterm session import
- Additional theme presets and a font picker
- Drag-and-drop *download* (remote → local)
- VNC, and RDP drawn inside the window rather than by the system client

### Session storage

Saved profiles (`backend/config/sessions.go`) store host/user/port/key path/group/tags as plain JSON in the OS config directory. **Passwords are never saved.** MobaXterm stores saved passwords with weak, reversible obfuscation, a known real weakness, and Xpecter deliberately doesn't repeat it. If password-saving becomes a real requirement later, use the OS keychain (Keychain / Credential Manager / Secret Service) instead of a custom encrypted blob, don't build your own crypto for this.

### CI/CD

Two GitHub Actions workflows live in `.github/workflows/`:

- **`ci.yml`**: runs on every push/PR to `main`. Fast checks only, no full Wails build, so it doesn't need GTK/webkit system deps. Go: `gofmt`, `go vet`, `golangci-lint`, `go build ./backend/...`. Frontend: `tsc` type-check, ESLint, Vite build.
- **`release.yml`**: runs on version tags (`v*.*.*`). Full cross-platform Wails builds (Linux/Windows/macOS via a matrix), packages each into an archive, and auto-publishes them to a GitHub Release with generated release notes.

To cut a release: `git tag vX.Y.Z && git push origin vX.Y.Z`.

### Naming

**Xpecter**: the terminal. Fast, cross-platform, gets in and out without the bloat. **Skald**: the other Dawnrail project, a type-safe network config DSL.
