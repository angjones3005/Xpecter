package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"

	"specter/backend/config"
	"specter/backend/pty"
	"specter/backend/sftpclient"
	"specter/backend/sshclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	sessions map[string]*sshclient.Session
	locals   map[string]*pty.LocalTerminal
}

func NewApp() *App {
	return &App{
		sessions: make(map[string]*sshclient.Session),
		locals:   make(map[string]*pty.LocalTerminal),
	}
}

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) shutdown(ctx context.Context) {
	for _, s := range a.sessions {
		s.Close()
	}
	for _, l := range a.locals {
		l.Close()
	}
}

// --- Local terminals (one per tab) ---

// StartLocalTerminal spawns a new local shell PTY and returns its ID.
// Output streams to the frontend via the "local:data:<id>" event, matching
// the "ssh:data:<id>" pattern already used for SSH sessions.
func (a *App) StartLocalTerminal(shell string) (string, error) {
	id := newID()
	lt, err := pty.New(func(data []byte) {
		runtime.EventsEmit(a.ctx, "local:data:"+id, string(data))
	}, shell)
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

// --- SSH sessions ---

type ConnectRequest struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	Password   string `json:"password,omitempty"`
	KeyPath    string `json:"keyPath,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
}

type ConnectResult struct {
	SessionID       string `json:"sessionId,omitempty"`
	NeedsTrust      bool   `json:"needsTrust,omitempty"`
	Changed         bool   `json:"changed,omitempty"`
	Host            string `json:"host,omitempty"`
	Fingerprint     string `json:"fingerprint,omitempty"`
	KeyType         string `json:"keyType,omitempty"`
	NeedsPassphrase bool   `json:"needsPassphrase,omitempty"`
}

func (a *App) Connect(req ConnectRequest) (ConnectResult, error) {
	sess, err := sshclient.Dial(sshclient.Config{
		Host: req.Host, Port: req.Port, User: req.User,
		Password: req.Password, KeyPath: req.KeyPath, Passphrase: req.Passphrase,
	})
	if err != nil {
		if errors.Is(err, sshclient.ErrPassphraseRequired) {
			return ConnectResult{NeedsPassphrase: true}, nil
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
	})
	if err != nil {
		return ConnectResult{}, err
	}

	return ConnectResult{SessionID: id}, nil
}

func (a *App) TrustHost(host string) error {
	return sshclient.TrustHost(host)
}

func (a *App) TrustHostDespiteChange(host string) error {
	return sshclient.TrustHostDespiteChange(host)
}

func (a *App) SelectKeyFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select SSH Private Key",
	})
}

// --- Saved sessions ---

func (a *App) ListSessions() ([]config.SessionProfile, error) {
	return config.LoadSessions()
}

func (a *App) SaveSession(profile config.SessionProfile) error {
	sessions, err := config.LoadSessions()
	if err != nil {
		return err
	}
	if profile.ID == "" {
		profile.ID = newID()
	}
	replaced := false
	for i, s := range sessions {
		if s.ID == profile.ID {
			sessions[i] = profile
			replaced = true
			break
		}
	}
	if !replaced {
		sessions = append(sessions, profile)
	}
	return config.SaveSessions(sessions)
}

func (a *App) DeleteSession(id string) error {
	sessions, err := config.LoadSessions()
	if err != nil {
		return err
	}
	kept := sessions[:0]
	for _, s := range sessions {
		if s.ID != id {
			kept = append(kept, s)
		}
	}
	return config.SaveSessions(kept)
}

// --- Session groups (folders) ---

func (a *App) ListGroups() ([]config.SessionGroup, error) {
	return config.LoadGroups()
}

// SaveGroup creates a new group, or updates one with a matching ID.
func (a *App) SaveGroup(group config.SessionGroup) error {
	groups, err := config.LoadGroups()
	if err != nil {
		return err
	}
	if group.ID == "" {
		group.ID = newID()
	}
	replaced := false
	for i, g := range groups {
		if g.ID == group.ID {
			groups[i] = group
			replaced = true
			break
		}
	}
	if !replaced {
		groups = append(groups, group)
	}
	return config.SaveGroups(groups)
}

// DeleteGroup removes a group and ungroups any sessions inside it
// (sets their GroupID back to empty) rather than deleting those sessions.
func (a *App) DeleteGroup(id string) error {
	groups, err := config.LoadGroups()
	if err != nil {
		return err
	}
	kept := groups[:0]
	for _, g := range groups {
		if g.ID != id {
			kept = append(kept, g)
		}
	}
	if err := config.SaveGroups(kept); err != nil {
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

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
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
