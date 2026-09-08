package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"xpecter/backend/config"
	"xpecter/backend/fswatch"
	"xpecter/backend/idgen"
	"xpecter/backend/pty"
	"xpecter/backend/serialclient"
	"xpecter/backend/sftpclient"
	"xpecter/backend/sshclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/pbkdf2"
)

type App struct {
	ctx      context.Context
	sessions map[string]*sshclient.Session
	locals   map[string]*pty.LocalTerminal
	serials  map[string]*serialclient.Session
	forwards map[string]net.Listener
	// startupDir (SPE-86): a directory passed on the command line at
	// launch, from Windows Explorer's "Open in Xpecter" context menu.
	// Read once by the frontend via GetStartupDir() during its own
	// startup sequence, empty when Xpecter was launched normally.
	startupDir string
	logMu      sync.Mutex
	// SPE-105 follow-up: one watcher for every editor workspace tree on
	// screen, created on first use because a session that never opens a
	// folder should never hold a watch handle. Guarded by its own mutex
	// since WatchLocalDirs is reachable from the frontend at any time.
	fsWatch   *fswatch.Watcher
	fsWatchMu sync.Mutex
}

func NewApp(startupDir string) *App {
	return &App{
		sessions:   make(map[string]*sshclient.Session),
		locals:     make(map[string]*pty.LocalTerminal),
		serials:    make(map[string]*serialclient.Session),
		forwards:   make(map[string]net.Listener),
		startupDir: startupDir,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	_ = registerContextMenu()
	cleanupStaleRemoteFiles()
	// SPE-87: best-effort, fire-and-forget. A slow disk or a failed
	// write should never delay or block app startup, and there's no
	// user-visible feedback needed on success, it's a silent safety net.
	go func() {
		_ = config.BackupIfDue()
	}()
}

func cleanupStaleRemoteFiles() {
	entries, err := os.ReadDir(os.TempDir())
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, entry := range entries {
		name := entry.Name()
		// Both prefixes: a temp dir left behind by a pre-rename build
		// would otherwise never be swept up by anything.
		if !entry.IsDir() || (!strings.HasPrefix(name, "xpecter-remote-file-") && !strings.HasPrefix(name, "specter-remote-file-")) {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		_ = os.RemoveAll(filepath.Join(os.TempDir(), entry.Name()))
	}
}

func (a *App) shutdown(ctx context.Context) {
	for _, s := range a.sessions {
		s.Close()
	}
	for _, l := range a.locals {
		l.Close()
	}
	for _, sc := range a.serials {
		sc.Close()
	}
	for _, listener := range a.forwards {
		listener.Close()
	}
	a.fsWatchMu.Lock()
	if a.fsWatch != nil {
		_ = a.fsWatch.Close()
		a.fsWatch = nil
	}
	a.fsWatchMu.Unlock()
}

// SessionClosedEvent is emitted as "ssh:closed:<id>" / "serial:closed:<id>"
// whenever a session's read loop stops unexpectedly (SPE-59). Deliberate
// closes (the user closing the tab) never reach the frontend as an event,
// since there's nothing useful to tell them at that point.
type SessionClosedEvent struct {
	EOF     bool   `json:"eof"`
	Message string `json:"message"`
}

// --- Local terminals (one per tab) ---

// StartLocalTerminal spawns a new local shell PTY and returns its ID.
// Output streams to the frontend via the "local:data:<id>" event, matching
// the "ssh:data:<id>" pattern already used for SSH sessions.
func (a *App) StartLocalTerminal(shell string, dir string, cols int, rows int) (string, error) {
	id := idgen.New()
	lt, err := pty.New(func(data []byte) {
		runtime.EventsEmit(a.ctx, "local:data:"+id, string(data))
	}, shell, dir, cols, rows)
	if err != nil {
		return "", err
	}
	a.locals[id] = lt
	return id, nil
}

func (a *App) WriteLocalTerminal(id string, data string) error {
	lt, ok := a.locals[id]
	if !ok {
		return fmt.Errorf("no such local terminal: %s", id)
	}
	return lt.Write([]byte(data))
}

func (a *App) ResizeLocalTerminal(id string, cols, rows int) error {
	lt, ok := a.locals[id]
	if !ok {
		return fmt.Errorf("no such local terminal: %s", id)
	}
	return lt.Resize(cols, rows)
}

func (a *App) CloseLocalTerminal(id string) error {
	lt, ok := a.locals[id]
	if !ok {
		return nil
	}
	delete(a.locals, id)
	return lt.Close()
}

// --- Serial/COM port console (direct hardware console access) ---

// ConnectSerial opens a serial port at the given baud rate (8N1, no flow
// control) and returns a session ID, following the same one-per-tab
// pattern as StartLocalTerminal.
func (a *App) ConnectSerial(portName string, baud int) (string, error) {
	id := idgen.New()
	sc, err := serialclient.Open(portName, baud, func(data []byte) {
		runtime.EventsEmit(a.ctx, "serial:data:"+id, string(data))
	}, func(reason serialclient.CloseReason) {
		if reason.Deliberate {
			return
		}
		runtime.EventsEmit(a.ctx, "serial:closed:"+id, SessionClosedEvent{
			EOF:     reason.EOF,
			Message: closeErrorMessage(reason.Err),
		})
	})
	if err != nil {
		return "", err
	}
	a.serials[id] = sc
	return id, nil
}

func (a *App) WriteSerial(id string, data string) error {
	sc, ok := a.serials[id]
	if !ok {
		return fmt.Errorf("no such serial session: %s", id)
	}
	return sc.Write([]byte(data))
}

func (a *App) CloseSerial(id string) error {
	sc, ok := a.serials[id]
	if !ok {
		return nil
	}
	delete(a.serials, id)
	return sc.Close()
}

// ListSerialPorts returns available serial port device paths for a
// future port-picker UI (manual entry is used for now).
func (a *App) ListSerialPorts() ([]string, error) {
	return serialclient.ListPorts()
}

// --- SSH sessions ---

type ConnectRequest struct {
	Host          string `json:"host"`
	Port          int    `json:"port"`
	User          string `json:"user"`
	Password      string `json:"password,omitempty"`
	KeyPath       string `json:"keyPath,omitempty"`
	Passphrase    string `json:"passphrase,omitempty"`
	UseAgent      bool   `json:"useAgent,omitempty"`
	InternalAgent bool   `json:"internalAgent,omitempty"`
	X11           bool   `json:"x11,omitempty"`
	// IgnoreKeyPermWarning: user already saw and accepted the SPE-65
	// KeyPermissionWarning once for this attempt, skip the check.
	IgnoreKeyPermWarning bool `json:"ignoreKeyPermWarning,omitempty"`
}

type ConnectResult struct {
	SessionID         string `json:"sessionId,omitempty"`
	ConnectDurationMs int64  `json:"connectDurationMs,omitempty"`
	NeedsTrust        bool   `json:"needsTrust,omitempty"`
	Changed           bool   `json:"changed,omitempty"`
	Host              string `json:"host,omitempty"`
	Fingerprint       string `json:"fingerprint,omitempty"`
	KeyType           string `json:"keyType,omitempty"`
	NeedsPassphrase   bool   `json:"needsPassphrase,omitempty"`
	// NeedsKeyPermConfirm (SPE-65): the selected key file is
	// group/world-readable. Soft warning, not a hard block, retry with
	// IgnoreKeyPermWarning once the user's explicitly acknowledged it.
	NeedsKeyPermConfirm bool   `json:"needsKeyPermConfirm,omitempty"`
	KeyPermPath         string `json:"keyPermPath,omitempty"`
	KeyPermMode         string `json:"keyPermMode,omitempty"`
	// LegacyCompat (SPE-99): true if this connection only succeeded by
	// automatically falling back to the widened algorithm set, an older
	// device that doesn't support Xpecter's normal secure defaults. Not
	// something the person requests, an honest after-the-fact notice
	// about reduced security for this specific connection.
	LegacyCompat bool `json:"legacyCompat,omitempty"`
}

func (a *App) Connect(req ConnectRequest) (ConnectResult, error) {
	// Loaded fresh per-connect rather than cached, GetSettings/SaveSettings
	// don't cache anything on App either, matches the existing pattern.
	// A load failure isn't fatal to connecting, defaults to keepalive
	// enabled (the safe default) rather than blocking the connection.
	settings, _ := config.LoadSettings()
	startedAt := time.Now()
	sess, err := sshclient.Dial(sshclient.Config{
		Host: req.Host, Port: req.Port, User: req.User,
		Password: req.Password, KeyPath: req.KeyPath, Passphrase: req.Passphrase,
		UseAgent:             req.UseAgent,
		InternalAgent:        req.InternalAgent,
		X11:                  req.X11,
		IgnoreKeyPermWarning: req.IgnoreKeyPermWarning,
		DisableKeepalive:     settings.SSHKeepaliveDisabled,
	})
	if err != nil {
		if errors.Is(err, sshclient.ErrPassphraseRequired) {
			return ConnectResult{NeedsPassphrase: true}, nil
		}
		var permWarning *sshclient.KeyPermissionWarning
		if errors.As(err, &permWarning) {
			return ConnectResult{
				NeedsKeyPermConfirm: true,
				KeyPermPath:         permWarning.Path,
				KeyPermMode:         fmt.Sprintf("%04o", permWarning.Mode.Perm()),
			}, nil
		}
		var unknown *sshclient.HostKeyUnknownError
		if errors.As(err, &unknown) {
			return ConnectResult{
				NeedsTrust: true, Changed: false,
				Host: unknown.Host, Fingerprint: unknown.Fingerprint, KeyType: unknown.KeyType,
			}, nil
		}
		var changed *sshclient.HostKeyChangedError
		if errors.As(err, &changed) {
			return ConnectResult{
				NeedsTrust: true, Changed: true,
				Host: changed.Host, Fingerprint: changed.NewFingerprint, KeyType: changed.KeyType,
			}, nil
		}
		return ConnectResult{}, err
	}

	id := sess.ID()
	a.sessions[id] = sess

	// SPE-126: authenticated, but deliberately no shell yet.
	// StartShellSSH below opens it, once the frontend has a real
	// terminal on screen and can say how big it actually is.
	return ConnectResult{SessionID: id, LegacyCompat: sess.UsedLegacyCompat(), ConnectDurationMs: time.Since(startedAt).Milliseconds()}, nil
}

// StartShellSSH opens the interactive shell on a session Connect has
// already authenticated, with the PTY sized from the real terminal.
//
// SPE-126: this was the tail of Connect, which forced the PTY to be
// requested before any terminal existed, from a hardcoded guess. See
// sshclient.StartShell for why that guess is what made wide output
// wrap in anything but a maximised window.
//
// Splitting the call also closes a race that was always here: the
// frontend can only subscribe to ssh:data:<id> once Connect has told it
// the id, so whatever the remote sent before that (a banner, the first
// prompt) was emitted to nobody. The listener is attached before this.
//
// x11 comes back in as an argument rather than being remembered from
// the ConnectRequest: EnableX11 acts on the ssh.Session that StartShell
// creates, so it can only run here, and one parameter beats a map of
// pending flags to keep clean.
func (a *App) StartShellSSH(id string, cols int, rows int, x11 bool) error {
	sess, ok := a.sessions[id]
	if !ok {
		return fmt.Errorf("no such session: %s", id)
	}
	if err := sess.StartShell(cols, rows, func(data []byte) {
		runtime.EventsEmit(a.ctx, "ssh:data:"+id, string(data))
	}, func(reason sshclient.CloseReason) {
		if reason.Deliberate {
			return
		}
		runtime.EventsEmit(a.ctx, "ssh:closed:"+id, SessionClosedEvent{
			EOF:     reason.EOF,
			Message: closeErrorMessage(reason.Err),
		})
	}); err != nil {
		return err
	}
	if x11 {
		if err := sess.EnableX11(); err != nil {
			delete(a.sessions, id)
			_ = sess.Close()
			return err
		}
	}
	return nil
}

// closeErrorMessage renders a CloseReason's error for display, matching
// MobaXterm's "Remote side unexpectedly closed network connection"
// framing for the clean-EOF case.
func closeErrorMessage(err error) string {
	if err == nil {
		return "Session ended"
	}
	if errors.Is(err, io.EOF) {
		return "Remote side closed the connection"
	}
	if errors.Is(err, os.ErrClosed) {
		return "Session ended"
	}
	return err.Error()
}

func (a *App) TrustHost(host string) error {
	return sshclient.TrustHost(host)
}

func (a *App) TrustHostDespiteChange(host string) error {
	return sshclient.TrustHostDespiteChange(host)
}

// GetPlatform returns "windows", "darwin", or "linux", used by the
// frontend Tools menu to show Command Prompt/PowerShell only on Windows.
func (a *App) GetPlatform() string {
	return runtime.Environment(a.ctx).Platform
}

// GetStartupDir returns the directory Xpecter was launched with (SPE-86,
// Windows Explorer's "Open in Xpecter" context menu), or "" for a normal
// launch. The frontend calls this once during its own startup sequence
// and opens a local shell tab rooted there when non-empty. Consumed
// exactly once per launch; the value doesn't change during the session,
// so there's no corresponding "clear" call needed.
func (a *App) GetStartupDir() string {
	return a.startupDir
}

// OpenNewWindow launches a second Xpecter (SPE-105). Wails v2 is one
// window per process, so this genuinely starts another process rather
// than opening a second window on this one. Both read and write the
// same config files, which is exactly why this is a deliberate menu
// action and not something the app ever does on its own.
//
// Launched with no arguments on purpose: the startup-directory argument
// (SPE-86, Explorer's "Open in Xpecter") belongs to the invocation that
// carried it, not to every window opened from it afterwards.
func (a *App) OpenNewWindow() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe)
	cmd.Dir = filepath.Dir(exe)
	if err := cmd.Start(); err != nil {
		return err
	}
	// Nothing here ever waits on the child, and an un-released process
	// handle lingers as a zombie on Unix once it exits.
	return cmd.Process.Release()
}

// GetClipboardText reads the OS clipboard via Wails' native runtime,
// bypassing the browser Clipboard API entirely. Some WebKitGTK builds
// deny navigator.clipboard.readText() when triggered from a contextmenu
// (right-click) event, even though the identical API call succeeds from
// a keypress, this sidesteps that permission quirk completely.
func (a *App) GetClipboardText() (string, error) {
	return runtime.ClipboardGetText(a.ctx)
}

// GetOSUsername pre-fills the New Session username field (SPE-83),
// matching MobaXterm's "same as Windows login" default. Empty return on
// error is fine, the frontend just skips pre-filling, not worth failing
// anything over.
func (a *App) GetOSUsername() string {
	u, err := user.Current()
	if err != nil {
		return ""
	}
	// Windows returns "COMPUTERNAME\username" or "DOMAIN\username", not
	// just the bare name, confirmed real os/user behavior, not assumed.
	// An SSH username has no domain prefix, strip it if present.
	name := u.Username
	if idx := strings.LastIndex(name, `\`); idx != -1 {
		name = name[idx+1:]
	}
	return name
}

func (a *App) SelectKeyFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select SSH Private Key",
	})
}

// SelectImageFile prompts for an image file, used by the wallpaper
// pickers (SPE-61). The title is a parameter because there are two of
// them now, terminal and editor, and a dialog that names the wrong
// surface is worse than one that names none. Returns "" (no error) if
// the user cancels.
func (a *App) SelectImageFile(title string) (string, error) {
	if title == "" {
		title = "Select Wallpaper"
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
		Filters: []runtime.FileFilter{
			{DisplayName: "Images (*.png;*.jpg;*.jpeg;*.gif;*.webp)", Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.webp"},
		},
	})
}

// SelectAnyFile prompts for any local file to open in the editor
// (SPE-78's local file support), unlike SelectKeyFile/SelectImageFile
// above, deliberately no filter, since editor content isn't restricted
// to one file type. Returns "" (no error) if the user cancels.
func (a *App) SelectAnyFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open File",
	})
}

// SelectDirectory prompts for a folder, used for choosing a local
// shell's starting directory. Returns "" (no error) if the user
// cancels.
func (a *App) SelectDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose Starting Directory",
	})
}

// SelectFolder prompts for a folder to open in the editor as a
// workspace (SPE-105). Distinct from SelectDirectory above only in its
// title: that one asks where a shell should start, this one asks what
// the editor's file tree should show.
func (a *App) SelectFolder() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Folder",
	})
}

// SelectFileIn is SelectAnyFile with a starting directory, so Open File
// from inside an editor workspace lands in that workspace rather than
// wherever the OS dialog happened to be last. An empty defaultDir is
// the OS default, same as SelectAnyFile.
func (a *App) SelectFileIn(defaultDir string) (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Open File",
		DefaultDirectory: defaultDir,
	})
}

// ReadLocalFile and WriteLocalFile (SPE-78) round out local file
// support in the editor pane, alongside the existing remote
// (ReadRemoteFile/WriteRemoteFile) and SaveTextFile (used here for
// local Save As, prompts for a destination) paths.
func (a *App) ReadLocalFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteLocalFile(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

// CreateLocalFile and CreateLocalDir back New File and New Folder in
// the editor's workspace tree (SPE-121). The existing local write paths
// both start from an OS dialog, which answers "where should this buffer
// go"; neither answers "add something to the folder I already have
// open", and that is the whole of what a tree needs.
//
// Both take the parent and the new name separately rather than one
// joined path, so the name can be checked as a name.
func validLocalName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("name cannot be empty")
	}
	if name == "." || name == ".." {
		return "", fmt.Errorf("%q is not a name", name)
	}
	// A separator would let a name typed into a tree rooted at one
	// folder create something outside it, and neither caller has any
	// reason to. Both separators are rejected on every platform:
	// Windows accepts either, and a name carrying the other one is a
	// mistake wherever it was typed.
	if strings.ContainsAny(name, `/\`) {
		return "", errors.New("a name cannot contain a path separator: create the folder first, then create inside it")
	}
	return name, nil
}

func (a *App) CreateLocalFile(dir string, name string) (string, error) {
	name, err := validLocalName(name)
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	// O_EXCL: a name already taken is an error the user should see, not
	// a file silently truncated to nothing. This is "add a file", and
	// it is never allowed to become "replace one".
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) CreateLocalDir(dir string, name string) (string, error) {
	name, err := validLocalName(name)
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	// Mkdir rather than MkdirAll: MkdirAll succeeds silently on a
	// directory that already exists, and New Folder appearing to do
	// nothing reads as a bug rather than as a name already taken.
	if err := os.Mkdir(path, 0o755); err != nil {
		return "", err
	}
	return path, nil
}

// WatchLocalDirs makes the watched set exactly dirs and emits
// "fs:changed" with the directories whose listings change. The frontend
// passes every directory its workspace trees are currently drawing, so
// a folder that gains a file shows it without waiting for a poll.
//
// The whole set arrives on every call rather than add/remove deltas:
// the frontend derives it from what is on screen, which it already has,
// and a delta protocol would need both sides to agree on state that
// only one of them owns. Passing an empty slice drops every watch.
func (a *App) WatchLocalDirs(dirs []string) error {
	a.fsWatchMu.Lock()
	defer a.fsWatchMu.Unlock()

	if a.fsWatch == nil {
		// Nothing to watch and nothing watching: don't create a watcher
		// (and its goroutine and kernel handle) just to be told so.
		if len(dirs) == 0 {
			return nil
		}
		w, err := fswatch.New(func(changed []string) {
			// The watcher outlives a single call and runs on its own
			// goroutine, so it can fire before startup has handed us a
			// context or after shutdown has torn one down.
			if a.ctx == nil {
				return
			}
			runtime.EventsEmit(a.ctx, "fs:changed", changed)
		})
		if err != nil {
			return err
		}
		a.fsWatch = w
	}
	a.fsWatch.SetDirs(dirs)
	return nil
}

// RenameLocalEntry renames a file or folder in place, the local
// counterpart to RenameRemoteEntry. It takes a name rather than a
// destination path, so a rename can never turn into a move.
func (a *App) RenameLocalEntry(oldPath string, newName string) (string, error) {
	newName, err := validLocalName(newName)
	if err != nil {
		return "", err
	}
	target := filepath.Join(filepath.Dir(oldPath), newName)
	if target == oldPath {
		return oldPath, nil
	}
	// Checked rather than left to os.Rename, which on Windows resolves to
	// MoveFileEx with MOVEFILE_REPLACE_EXISTING and would silently
	// destroy the file being renamed over. The same reasoning as the
	// remote side's choice of SSH_FXP_RENAME over PosixRename: losing a
	// file to a typo in a rename box is not a recoverable mistake.
	//
	// A case-only rename on a case-insensitive filesystem is the one
	// place this would refuse something legitimate, since the target
	// "exists" as the source itself. Allowed through by comparing the
	// resolved identity rather than the string.
	if existing, err := os.Stat(target); err == nil {
		current, statErr := os.Stat(oldPath)
		if statErr != nil || !os.SameFile(existing, current) {
			return "", fmt.Errorf("%s already exists", newName)
		}
	}
	if err := os.Rename(oldPath, target); err != nil {
		return "", err
	}
	return target, nil
}

// LocalFile mirrors RemoteFile for the local filesystem, so the
// editor's workspace tree and the SFTP browser are the same shape on
// the frontend.
type LocalFile struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// ListLocalDir backs the editor's folder tree (SPE-105). Directories
// sort ahead of files and then by name, case-insensitively: the order a
// file tree is expected to be in, decided here rather than in the
// frontend so the remote browser can adopt the same ordering later
// without a second implementation of it.
func (a *App) ListLocalDir(dir string) ([]LocalFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	files := make([]LocalFile, 0, len(entries))
	for _, entry := range entries {
		var size int64
		// A file that vanished between ReadDir and Info is worth
		// listing without a size, not worth failing the whole listing.
		if info, err := entry.Info(); err == nil {
			size = info.Size()
		}
		files = append(files, LocalFile{
			Name:  entry.Name(),
			Path:  filepath.Join(dir, entry.Name()),
			IsDir: entry.IsDir(),
			Size:  size,
		})
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})
	return files, nil
}

// AppendSessionLog appends raw terminal output to one file per session.
// The directory is user-selected and the filename is sanitized so labels
// cannot escape it. A per-App mutex keeps concurrent output chunks ordered.
func (a *App) AppendSessionLog(directory, sessionID, label, content string) error {
	if directory == "" || content == "" {
		return nil
	}
	name := sanitizeLogName(label)
	if name == "" {
		name = "session"
	}
	path := filepath.Join(directory, name+"-"+sessionID+".log")
	a.logMu.Lock()
	defer a.logMu.Unlock()
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(content)
	return err
}

func sanitizeLogName(label string) string {
	var b strings.Builder
	for _, r := range label {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	return strings.Trim(b.String(), "._")
}

// ReadImageFile reads an arbitrary local image path and returns it as a
// data: URL, since the webview can't load arbitrary file:// paths
// directly for security reasons. Used to render the wallpaper (SPE-61),
// referenced by path in Settings rather than embedded there.
func (a *App) ReadImageFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	mimeType := mime.TypeByExtension(filepath.Ext(path))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// SaveTextFile prompts for a destination path and writes content to it,
// used by the disconnected-session panel's "Save output to file" action
// (SPE-59, matching MobaXterm's "S" option). Returns "" (no error) if the
// user cancels the dialog.
func (a *App) SaveTextFile(defaultFilename string, content string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Terminal Output",
		DefaultFilename: defaultFilename,
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// SaveTextFileIn is SaveTextFile with a starting directory and a title
// that fits an editor (SPE-105), so Save As inside a workspace opens in
// that workspace instead of wherever the last "Save Terminal Output"
// went. Kept separate rather than widening SaveTextFile, which the
// session-output save still uses with its own title.
func (a *App) SaveTextFileIn(defaultDir string, defaultFilename string, content string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save File",
		DefaultDirectory: defaultDir,
		DefaultFilename:  defaultFilename,
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// --- Terminal personalization (SPE-61) ---

func (a *App) GetSettings() (config.Settings, error) {
	return config.LoadSettings()
}

func (a *App) SaveSettings(s config.Settings) error {
	return config.SaveSettings(s)
}

// --- Saved sessions ---

func (a *App) ListSessions() ([]config.SessionProfile, error) {
	return config.LoadSessions()
}

func sessionID(s config.SessionProfile) string { return s.ID }

func (a *App) SaveSession(profile config.SessionProfile) error {
	sessions, err := config.LoadSessions()
	if err != nil {
		return err
	}
	if profile.ID == "" {
		profile.ID = idgen.New()
	}
	return config.SaveSessions(config.UpsertByID(sessions, profile, sessionID))
}

func (a *App) DeleteSession(id string) error {
	sessions, err := config.LoadSessions()
	if err != nil {
		return err
	}
	return config.SaveSessions(config.RemoveByID(sessions, id, sessionID))
}

// --- Local shell profiles (SPE-102) ---

func (a *App) ListLocalShellProfiles() ([]config.LocalShellProfile, error) {
	return config.LoadLocalShellProfiles()
}

func localShellProfileID(p config.LocalShellProfile) string { return p.ID }

func (a *App) SaveLocalShellProfile(profile config.LocalShellProfile) error {
	profiles, err := config.LoadLocalShellProfiles()
	if err != nil {
		return err
	}
	if profile.ID == "" {
		profile.ID = idgen.New()
	}
	return config.SaveLocalShellProfiles(config.UpsertByID(profiles, profile, localShellProfileID))
}

func (a *App) DeleteLocalShellProfile(id string) error {
	profiles, err := config.LoadLocalShellProfiles()
	if err != nil {
		return err
	}
	return config.SaveLocalShellProfiles(config.RemoveByID(profiles, id, localShellProfileID))
}

// --- Pinned folders (SPE-106) ---
// Same shape as the local shell profiles above: a list the sidebar
// renders, added to and removed from one entry at a time.

func (a *App) ListFolders() ([]config.Folder, error) {
	return config.LoadFolders()
}

func folderID(f config.Folder) string { return f.ID }

func (a *App) SaveFolder(folder config.Folder) error {
	folders, err := config.LoadFolders()
	if err != nil {
		return err
	}
	if folder.ID == "" {
		folder.ID = idgen.New()
	}
	return config.SaveFolders(config.UpsertByID(folders, folder, folderID))
}

func (a *App) DeleteFolder(id string) error {
	folders, err := config.LoadFolders()
	if err != nil {
		return err
	}
	return config.SaveFolders(config.RemoveByID(folders, id, folderID))
}

// --- Session groups (folders) ---

func (a *App) ListGroups() ([]config.SessionGroup, error) {
	return config.LoadGroups()
}

func groupID(g config.SessionGroup) string { return g.ID }

// SaveGroup creates a new group, or updates one with a matching ID.
func (a *App) SaveGroup(group config.SessionGroup) error {
	groups, err := config.LoadGroups()
	if err != nil {
		return err
	}
	if group.ID == "" {
		group.ID = idgen.New()
	}
	return config.SaveGroups(config.UpsertByID(groups, group, groupID))
}

// DeleteGroup removes a group and ungroups any sessions inside it
// (sets their GroupID back to empty) rather than deleting those sessions.
func (a *App) DeleteGroup(id string) error {
	groups, err := config.LoadGroups()
	if err != nil {
		return err
	}
	if err := config.SaveGroups(config.RemoveByID(groups, id, groupID)); err != nil {
		return err
	}

	sessions, err := config.LoadSessions()
	if err != nil {
		return err
	}
	changed := false
	for i, s := range sessions {
		if s.GroupID == id {
			sessions[i].GroupID = ""
			changed = true
		}
	}
	if changed {
		return config.SaveSessions(sessions)
	}
	return nil
}

// --- Config import/export (SPE-93) ---

// ExportConfigFile prompts for a destination and writes the current
// Settings, Sessions, Groups, and LocalShellProfiles to it as a single
// portable JSON file (see config.ExportBundle for exactly what's
// included, notably no passwords or known_hosts). Returns "" (no
// error) if the user cancels the dialog.
func (a *App) ExportConfigFile() (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Xpecter Configuration",
		DefaultFilename: "xpecter-config.json",
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	bundle, err := config.ExportBundle()
	if err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", err
	}
	return path, nil
}

// ImportConfigFile prompts for a previously exported file and applies
// it. replace picks between config.ImportMerge (add alongside what is
// here) and config.ImportReplace (make this machine match the file).
// Returns "" (no error) if the user cancels the dialog.
func (a *App) ImportConfigFile(replace bool) (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Import Xpecter Configuration",
		Filters: []runtime.FileFilter{
			{DisplayName: "Xpecter Config (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var bundle config.ConfigBundle
	if err := json.Unmarshal(data, &bundle); err != nil {
		return "", fmt.Errorf("not a valid Xpecter config file: %w", err)
	}
	if err := config.ImportBundle(bundle, importMode(replace)); err != nil {
		return "", err
	}
	return path, nil
}

// importMode keeps the bool-to-mode translation in one place: the two
// import entry points below both take a bool over the Wails bridge,
// which has no notion of the Go enum.
func importMode(replace bool) config.ImportMode {
	if replace {
		return config.ImportReplace
	}
	return config.ImportMerge
}

// ResetConfiguration clears everything an export captures and returns
// the filename of the backup taken immediately beforehand, so the UI
// can tell the user exactly what to restore from if they change their
// mind. See config.ResetAll.
func (a *App) ResetConfiguration() (string, error) {
	return config.ResetAll()
}

// MobaImportResult is a struct rather than a (path, count, error)
// triple because Wails marshals a bound method returning at most one
// value plus an error: internal/binding.BoundMethod.Call switches on the
// output count and handles only 1 and 2. With three returns it matched
// neither case, so the frontend received null and every error, including
// "no importable MobaXterm sessions found", was dropped on the floor.
// The import itself had already run and saved by then, so the sessions
// landed while the UI reported a TypeError and never refreshed the list.
type MobaImportResult struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
}

// ImportMobaXtermSessions imports simple INI-style MobaXterm session files.
// Password-like fields are deliberately ignored.
func (a *App) ImportMobaXtermSessions() (MobaImportResult, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import MobaXterm Sessions",
		Filters: []runtime.FileFilter{{DisplayName: "MobaXterm files (*.mxtsessions;*.ini)", Pattern: "*.mxtsessions;*.ini"}},
	})
	if err != nil || path == "" {
		return MobaImportResult{Path: path}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return MobaImportResult{}, err
	}
	profiles := parseMobaSessions(string(data))
	if len(profiles) == 0 {
		return MobaImportResult{}, fmt.Errorf("no importable MobaXterm sessions found")
	}
	existing, err := config.LoadSessions()
	if err != nil {
		return MobaImportResult{}, err
	}
	existing = append(existing, profiles...)
	if err := config.SaveSessions(existing); err != nil {
		return MobaImportResult{}, err
	}
	return MobaImportResult{Path: path, Count: len(profiles)}, nil
}

func parseMobaSessions(data string) []config.SessionProfile {
	var profiles []config.SessionProfile
	var current config.SessionProfile
	flush := func() {
		if current.Host != "" {
			if current.Name == "" {
				current.Name = current.User + "@" + current.Host
			}
			if current.Port == 0 {
				current.Port = 22
			}
			current.ID = idgen.New()
			profiles = append(profiles, current)
		}
		current = config.SessionProfile{}
	}
	for _, raw := range strings.Split(data, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			flush()
			section := strings.Trim(line, "[]")
			current.Name = section[strings.LastIndex(section, "\\")+1:]
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(parts[0]))
		value := strings.TrimSpace(parts[1])
		switch key {
		case "name", "sessionname", "session":
			if current.Name == "" {
				current.Name = value
			}
		case "host", "hostname", "ip", "address", "remotehost":
			current.Host = value
		case "user", "username", "remoteuser":
			current.User = value
		case "port", "remoteport":
			if n, err := strconv.Atoi(value); err == nil {
				current.Port = n
			}
		case "keypath", "privatekey", "privatekeypath":
			current.KeyPath = value
		}
	}
	flush()
	return profiles
}

type encryptedConfigBundle struct {
	Version int    `json:"version"`
	Salt    string `json:"salt"`
	Nonce   string `json:"nonce"`
	Data    string `json:"data"`
}

func deriveBundleKey(passphrase string, salt []byte) []byte {
	return pbkdf2.Key([]byte(passphrase), salt, 310000, 32, sha256.New)
}

// ExportEncryptedConfigFile writes a passphrase-protected portable bundle.
// The encrypted file is suitable for user-managed cloud storage; Xpecter
// never uploads it or receives the passphrase.
func (a *App) ExportEncryptedConfigFile(passphrase string) (string, error) {
	if passphrase == "" {
		return "", fmt.Errorf("passphrase cannot be empty")
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Encrypted Xpecter Configuration",
		DefaultFilename: "xpecter-config.enc.json",
	})
	if err != nil || path == "" {
		return path, err
	}
	bundle, err := config.ExportBundle()
	if err != nil {
		return "", err
	}
	plain, err := json.Marshal(bundle)
	if err != nil {
		return "", err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	block, err := aes.NewCipher(deriveBundleKey(passphrase, salt))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	envelope := encryptedConfigBundle{Version: 1, Salt: base64.StdEncoding.EncodeToString(salt), Nonce: base64.StdEncoding.EncodeToString(nonce), Data: base64.StdEncoding.EncodeToString(gcm.Seal(nil, nonce, plain, nil))}
	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return "", err
	}
	return path, os.WriteFile(path, data, 0o600)
}

// ImportEncryptedConfigFile decrypts and imports a user-managed encrypted
// bundle. A wrong passphrase fails authentication before any config changes.
func (a *App) ImportEncryptedConfigFile(passphrase string, replace bool) (string, error) {
	if passphrase == "" {
		return "", fmt.Errorf("passphrase cannot be empty")
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Import Encrypted Xpecter Configuration"})
	if err != nil || path == "" {
		return path, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var envelope encryptedConfigBundle
	if err := json.Unmarshal(data, &envelope); err != nil {
		return "", fmt.Errorf("not a valid encrypted Xpecter config: %w", err)
	}
	salt, err := base64.StdEncoding.DecodeString(envelope.Salt)
	if err != nil {
		return "", fmt.Errorf("invalid encrypted config salt: %w", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(envelope.Nonce)
	if err != nil {
		return "", fmt.Errorf("invalid encrypted config nonce: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(envelope.Data)
	if err != nil {
		return "", fmt.Errorf("invalid encrypted config data: %w", err)
	}
	block, err := aes.NewCipher(deriveBundleKey(passphrase, salt))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("wrong passphrase or corrupted encrypted config")
	}
	var bundle config.ConfigBundle
	if err := json.Unmarshal(plain, &bundle); err != nil {
		return "", fmt.Errorf("decrypted config is invalid: %w", err)
	}
	if err := config.ImportBundle(bundle, importMode(replace)); err != nil {
		return "", err
	}
	return path, nil
}

// --- Auto-backup (SPE-87) ---

// ListBackups returns available automatic backup filenames, newest
// first, for a Restore from Backup UI to present.
func (a *App) ListBackups() ([]string, error) {
	return config.ListBackups()
}

// RestoreBackup replaces current Settings/Sessions/Groups/
// LocalShellProfiles with the given backup (see config.RestoreBackup:
// this REPLACES outright, it does not merge like ImportConfigFile
// above).
func (a *App) RestoreBackup(filename string) error {
	return config.RestoreBackup(filename)
}

func (a *App) WriteSSH(id string, data string) error {
	sess, ok := a.sessions[id]
	if !ok {
		return fmt.Errorf("no such session: %s", id)
	}
	return sess.Write([]byte(data))
}

func (a *App) ResizeSSH(id string, cols, rows int) error {
	sess, ok := a.sessions[id]
	if !ok {
		return fmt.Errorf("no such session: %s", id)
	}
	return sess.Resize(cols, rows)
}

func (a *App) CloseSSH(id string) error {
	sess, ok := a.sessions[id]
	if !ok {
		return nil
	}
	delete(a.sessions, id)
	return sess.Close()
}

// StartLocalForward binds a local TCP port and forwards each connection
// through an existing SSH session to remoteHost:remotePort.
func (a *App) StartLocalForward(sessionID string, localPort int, remoteHost string, remotePort int) (string, error) {
	sess, ok := a.sessions[sessionID]
	if !ok {
		return "", fmt.Errorf("no such session: %s", sessionID)
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
	if err != nil {
		return "", err
	}
	forwardID := idgen.New()
	a.forwards[forwardID] = listener
	go func() {
		for {
			local, err := listener.Accept()
			if err != nil {
				return
			}
			remote, err := sess.SSHClient().Dial("tcp", net.JoinHostPort(remoteHost, fmt.Sprintf("%d", remotePort)))
			if err != nil {
				local.Close()
				continue
			}
			go proxyTCP(local, remote)
		}
	}()
	return forwardID, nil
}

func proxyTCP(left, right net.Conn) {
	defer left.Close()
	defer right.Close()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(left, right); done <- struct{}{} }()
	go func() { _, _ = io.Copy(right, left); done <- struct{}{} }()
	<-done
}

func (a *App) StopForward(id string) error {
	listener, ok := a.forwards[id]
	if !ok {
		return nil
	}
	delete(a.forwards, id)
	return listener.Close()
}

// --- SFTP / remote file editing ---

type RemoteFile struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

func (a *App) ListRemoteDir(id string, path string) ([]RemoteFile, error) {
	sess, ok := a.sessions[id]
	if !ok {
		return nil, fmt.Errorf("no such session: %s", id)
	}
	entries, err := sftpclient.ListDir(sess.SSHClient(), path)
	if err != nil {
		return nil, err
	}
	out := make([]RemoteFile, 0, len(entries))
	for _, e := range entries {
		out = append(out, RemoteFile{Name: e.Name, Path: e.Path, IsDir: e.IsDir, Size: e.Size})
	}
	return out, nil
}

// validRemoteName is validLocalName's counterpart for the remote
// browser. It is deliberately not the same function: remote paths are
// POSIX, where "/" is the only separator and a backslash is an ordinary
// character that a legitimate file is allowed to contain. Rejecting "\"
// here, as the local rule does, would refuse to rename files that exist
// perfectly happily on the host.
func validRemoteName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("name cannot be empty")
	}
	if name == "." || name == ".." {
		return "", fmt.Errorf("%q is not a name", name)
	}
	if strings.Contains(name, "/") {
		return "", errors.New("a name cannot contain \"/\": create the folder first, then create inside it")
	}
	return name, nil
}

// CreateRemoteFile, CreateRemoteDir and RenameRemoteEntry give the
// remote browser the same three actions the editor's workspace tree
// already has. Each takes the parent and the new name separately so the
// name can be checked as a name, matching the local pair.
func (a *App) CreateRemoteFile(id string, dir string, name string) (string, error) {
	sess, ok := a.sessions[id]
	if !ok {
		return "", fmt.Errorf("no such session: %s", id)
	}
	name, err := validRemoteName(name)
	if err != nil {
		return "", err
	}
	return sftpclient.CreateFile(sess.SSHClient(), dir, name)
}

func (a *App) CreateRemoteDir(id string, dir string, name string) (string, error) {
	sess, ok := a.sessions[id]
	if !ok {
		return "", fmt.Errorf("no such session: %s", id)
	}
	name, err := validRemoteName(name)
	if err != nil {
		return "", err
	}
	return sftpclient.CreateDir(sess.SSHClient(), dir, name)
}

// RenameRemoteEntry renames in place: it takes a new name, not a new
// path, so a rename can never turn into a move to somewhere the user
// can't see.
func (a *App) RenameRemoteEntry(id string, oldPath string, newName string) (string, error) {
	sess, ok := a.sessions[id]
	if !ok {
		return "", fmt.Errorf("no such session: %s", id)
	}
	newName, err := validRemoteName(newName)
	if err != nil {
		return "", err
	}
	return sftpclient.Rename(sess.SSHClient(), oldPath, newName)
}

func (a *App) ReadRemoteFile(id string, path string) (string, error) {
	sess, ok := a.sessions[id]
	if !ok {
		return "", fmt.Errorf("no such session: %s", id)
	}
	return sftpclient.ReadFile(sess.SSHClient(), path)
}

// OpenRemoteFile downloads a remote file to a private temporary directory
// and opens it with the operating system's default application. The temp
// copy remains available after Xpecter returns so the external application
// can finish opening it.
func (a *App) OpenRemoteFile(id string, remotePath string) error {
	sess, ok := a.sessions[id]
	if !ok {
		return fmt.Errorf("no such session: %s", id)
	}

	tmpDir, err := os.MkdirTemp("", "xpecter-remote-file-*")
	if err != nil {
		return err
	}
	localPath := remoteTempFilePath(tmpDir, remotePath)
	if err := sftpclient.DownloadFile(sess.SSHClient(), remotePath, localPath); err != nil {
		_ = os.RemoveAll(tmpDir)
		return err
	}
	if err := openExternalPath(localPath); err != nil {
		_ = os.RemoveAll(tmpDir)
		return err
	}
	return nil
}

func remoteTempFilePath(tmpDir, remotePath string) string {
	name := filepath.Base(filepath.FromSlash(remotePath))
	if name == "." || name == string(filepath.Separator) || name == "" {
		name = "remote-file"
	}
	return filepath.Join(tmpDir, name)
}

func (a *App) WriteRemoteFile(id string, path string, content string) error {
	sess, ok := a.sessions[id]
	if !ok {
		return fmt.Errorf("no such session: %s", id)
	}
	return sftpclient.WriteFile(sess.SSHClient(), path, content)
}

// UploadRemoteFile writes a base64-encoded file to a remote path. Base64
// is used because Wails bindings serialize over JSON, which requires
// valid UTF-8 strings, arbitrary binary data (images, executables, etc.)
// is not valid UTF-8 and would be corrupted if sent as a raw string.
func (a *App) UploadRemoteFile(id string, path string, base64Content string, modifiedAt int64) error {
	sess, ok := a.sessions[id]
	if !ok {
		return fmt.Errorf("no such session: %s", id)
	}
	data, err := base64.StdEncoding.DecodeString(base64Content)
	if err != nil {
		return fmt.Errorf("invalid base64 upload payload: %w", err)
	}
	var modTime time.Time
	if modifiedAt > 0 {
		modTime = time.UnixMilli(modifiedAt)
	}
	return sftpclient.UploadFile(sess.SSHClient(), path, data, modTime)
}
