# Specter

Cross-platform terminal + SSH client + remote file editor. A **Dawnrail** project.

Licensed under [GPLv3](LICENSE).

This is a starter scaffold, not a finished app. It was written without a live
Go/Wails toolchain available, so it hasn't been compiled or run yet. Expect to
fix a few rough edges on first build.

## What's here

- `main.go`, `app.go` — Wails entrypoint and the bound methods the frontend calls
- `backend/sshclient/` — SSH dial + interactive shell over `golang.org/x/crypto/ssh`
- `backend/sftpclient/` — remote directory listing and file read/write
- `backend/pty/` — local shell PTY, Unix via `creack/pty`, Windows via `UserExistsError/conpty` (ConPTY, needs Windows 10 1809+)
- `backend/config/sessions.go` — saved connection profiles as plain JSON (host/user/port/keyPath only, no passwords, see rationale in that file)
- `frontend/` — xterm.js terminal + Monaco editor pane, split-pane layout, plain **TypeScript** + Vite (no framework)

## A note on performance

If Specter feels sluggish while developing (typing lag, general UI slowness),
test with a production build (`wails build`) before assuming it's a real bug.
`wails dev` carries real overhead (unminified assets, dev server round-trips,
hot-reload machinery) that doesn't reflect the actual app's performance.

## Setup

You'll need Go 1.22+, Node 18+, and the Wails CLI installed locally:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Then from the project root:

```bash
wails dev     # live dev mode
wails build   # produces a native binary per platform
```

## Known gaps to fill in before this is real

1. **Host key verification**: `sshclient.go` uses `ssh.InsecureIgnoreHostKey()`.
   Replace with a real `known_hosts` callback before this touches anything you
   care about. This is the top priority, it's a genuine security hole as written.
2. **Key-based auth UI**: the backend already accepts a `KeyPath`, and
   `SessionProfile` stores it, but the frontend connect form only wires up
   password auth right now.
3. **Wire `config.LoadSessions`/`SaveSessions` into `app.go`**: the storage
   layer exists but nothing calls it yet, need bound methods
   (`ListSessions`, `SaveSession`, `DeleteSession`) and a saved-sessions
   list in the sidebar UI.
4. **Multiplexing**: only a single terminal pane exists. Tmux-style split
   panes would live in the frontend, xterm.js instances can be created per pane.
5. **ConPTY on Windows is wired but untested**: `backend/pty/pty_windows.go`
   now calls `UserExistsError/conpty` for real, but this has only been
   written, not compiled or run on an actual Windows machine yet.

## Session storage

Saved profiles (`backend/config/sessions.go`) store host/user/port/key path
as plain JSON in the OS config directory. **Passwords are never saved.**
MobaXterm stores saved passwords with weak, reversible obfuscation, a known
real weakness, and this scaffold deliberately doesn't repeat it. If
password-saving becomes a real requirement later, use the OS keychain
(Keychain / Credential Manager / Secret Service) instead of a custom
encrypted blob, don't build your own crypto for this.

## CI/CD

Two GitHub Actions workflows live in `.github/workflows/`:

- **`ci.yml`**: runs on every push/PR to `main`. Fast checks only, no full
  Wails build, so it doesn't need GTK/webkit system deps. Go: `gofmt`,
  `go vet`, `golangci-lint`, `go build ./backend/...`. Frontend: `tsc`
  type-check, ESLint, Vite build.
- **`release.yml`**: runs on version tags (`v*.*.*`). Full cross-platform
  Wails builds (Linux/Windows/macOS via a matrix), packages each into an
  archive, and auto-publishes them to a GitHub Release with generated
  release notes.

To cut a release: `git tag v0.1.0 && git push origin v0.1.0`.

Repo doesn't exist on GitHub yet, these workflows are ready to go the
moment it's created and this code is pushed.

## Naming

**Specter**: the terminal. Fast, cross-platform, gets in and out without the
bloat. **Skald**: the other Dawnrail project, a type-safe network config DSL.
