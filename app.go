package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"time"

	"specter/backend/config"
	"specter/backend/idgen"
	"specter/backend/pty"
	"specter/backend/serialclient"
	"specter/backend/sftpclient"
	"specter/backend/sshclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	sessions map[string]*sshclient.Session
	locals   map[string]*pty.LocalTerminal
	serials  map[string]*serialclient.Session
	// startupDir (SPE-86): a directory passed on the command line at
	// launch, from Windows Explorer's "Open in Specter" context menu.
	// Read once by the frontend via GetStartupDir() during its own
	// startup sequence, empty when Specter was launched normally.
	startupDir string
}

func NewApp(startupDir string) *App {
	return &App{
		sessions:   make(map[string]*sshclient.Session),
		locals:     make(map[string]*pty.LocalTerminal),
		serials:    make(map[string]*serialclient.Session),
		startupDir: startupDir,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "specter-remote-file-") {
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
func (a *App) StartLocalTerminal(shell string, dir string) (string, error) {
	id := idgen.New()
	lt, err := pty.New(func(data []byte) {
		runtime.EventsEmit(a.ctx, "local:data:"+id, string(data))
	}, shell, dir)
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
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	Password   string `json:"password,omitempty"`
	KeyPath    string `json:"keyPath,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
	// IgnoreKeyPermWarning: user already saw and accepted the SPE-65
	// KeyPermissionWarning once for this attempt, skip the check.
	IgnoreKeyPermWarning bool `json:"ignoreKeyPermWarning,omitempty"`
}

type ConnectResult struct {
	SessionID       string `json:"sessionId,omitempty"`
	NeedsTrust      bool   `json:"needsTrust,omitempty"`
	Changed         bool   `json:"changed,omitempty"`
	Host            string `json:"host,omitempty"`
	Fingerprint     string `json:"fingerprint,omitempty"`
	KeyType         string `json:"keyType,omitempty"`
	NeedsPassphrase bool   `json:"needsPassphrase,omitempty"`
	// NeedsKeyPermConfirm (SPE-65): the selected key file is
	// group/world-readable. Soft warning, not a hard block, retry with
	// IgnoreKeyPermWarning once the user's explicitly acknowledged it.
	NeedsKeyPermConfirm bool   `json:"needsKeyPermConfirm,omitempty"`
	KeyPermPath         string `json:"keyPermPath,omitempty"`
	KeyPermMode         string `json:"keyPermMode,omitempty"`
	// LegacyCompat (SPE-99): true if this connection only succeeded by
	// automatically falling back to the widened algorithm set, an older
	// device that doesn't support Specter's normal secure defaults. Not
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
	sess, err := sshclient.Dial(sshclient.Config{
		Host: req.Host, Port: req.Port, User: req.User,
		Password: req.Password, KeyPath: req.KeyPath, Passphrase: req.Passphrase,
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

	err = sess.StartShell(func(data []byte) {
		runtime.EventsEmit(a.ctx, "ssh:data:"+id, string(data))
	}, func(reason sshclient.CloseReason) {
		if reason.Deliberate {
			return
		}
		runtime.EventsEmit(a.ctx, "ssh:closed:"+id, SessionClosedEvent{
			EOF:     reason.EOF,
			Message: closeErrorMessage(reason.Err),
		})
	})
	if err != nil {
		return ConnectResult{}, err
	}

	return ConnectResult{SessionID: id, LegacyCompat: sess.UsedLegacyCompat()}, nil
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

// GetStartupDir returns the directory Specter was launched with (SPE-86,
// Windows Explorer's "Open in Specter" context menu), or "" for a normal
// launch. The frontend calls this once during its own startup sequence
// and opens a local shell tab rooted there when non-empty. Consumed
// exactly once per launch; the value doesn't change during the session,
// so there's no corresponding "clear" call needed.
func (a *App) GetStartupDir() string {
	return a.startupDir
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
// picker (SPE-61). Returns "" (no error) if the user cancels.
func (a *App) SelectImageFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Terminal Wallpaper",
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
		Title:           "Export Specter Configuration",
		DefaultFilename: "specter-config.json",
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
// it (see config.ImportBundle for merge semantics: Settings is
// replaced outright, Sessions/Groups/LocalShellProfiles are merged in
// alongside whatever's already here). Returns "" (no error) if the
// user cancels the dialog.
func (a *App) ImportConfigFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Import Specter Configuration",
		Filters: []runtime.FileFilter{
			{DisplayName: "Specter Config (*.json)", Pattern: "*.json"},
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
		return "", fmt.Errorf("not a valid Specter config file: %w", err)
	}
	if err := config.ImportBundle(bundle); err != nil {
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

func (a *App) ReadRemoteFile(id string, path string) (string, error) {
	sess, ok := a.sessions[id]
	if !ok {
		return "", fmt.Errorf("no such session: %s", id)
	}
	return sftpclient.ReadFile(sess.SSHClient(), path)
}

// OpenRemoteFile downloads a remote file to a private temporary directory
// and opens it with the operating system's default application. The temp
// copy remains available after Specter returns so the external application
// can finish opening it.
func (a *App) OpenRemoteFile(id string, remotePath string) error {
	sess, ok := a.sessions[id]
	if !ok {
		return fmt.Errorf("no such session: %s", id)
	}

	tmpDir, err := os.MkdirTemp("", "specter-remote-file-*")
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
func (a *App) UploadRemoteFile(id string, path string, base64Content string) error {
	sess, ok := a.sessions[id]
	if !ok {
		return fmt.Errorf("no such session: %s", id)
	}
	data, err := base64.StdEncoding.DecodeString(base64Content)
	if err != nil {
		return fmt.Errorf("invalid base64 upload payload: %w", err)
	}
	return sftpclient.UploadFile(sess.SSHClient(), path, data)
}
