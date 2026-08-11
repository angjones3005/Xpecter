package main

import (
	"context"
	"fmt"

	"specter/backend/pty"
	"specter/backend/sftpclient"
	"specter/backend/sshclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the main struct bound to the frontend. Every exported method
// here becomes callable from JavaScript via window.go.main.App.<Method>.
type App struct {
	ctx context.Context

	sessions map[string]*sshclient.Session // keyed by session ID
	local    *pty.LocalTerminal
}

func NewApp() *App {
	return &App{
		sessions: make(map[string]*sshclient.Session),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(ctx context.Context) {
	for _, s := range a.sessions {
		s.Close()
	}
	if a.local != nil {
		a.local.Close()
	}
}

// --- Local terminal ---

// StartLocalTerminal spawns a local shell PTY and streams output to the
// frontend via the "local:data" event.
func (a *App) StartLocalTerminal() error {
	lt, err := pty.New(func(data []byte) {
		runtime.EventsEmit(a.ctx, "local:data", string(data))
	})
	if err != nil {
		return err
	}
	a.local = lt
	return nil
}

func (a *App) WriteLocalTerminal(data string) error {
	if a.local == nil {
		return fmt.Errorf("local terminal not started")
	}
	return a.local.Write([]byte(data))
}

func (a *App) ResizeLocalTerminal(cols, rows int) error {
	if a.local == nil {
		return fmt.Errorf("local terminal not started")
	}
	return a.local.Resize(cols, rows)
}

// --- SSH sessions ---

type ConnectRequest struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password,omitempty"`
	KeyPath  string `json:"keyPath,omitempty"`
}

// Connect opens a new SSH session and an interactive shell over it.
// Returns a session ID used for subsequent Write/Resize/Close/SFTP calls.
func (a *App) Connect(req ConnectRequest) (string, error) {
	sess, err := sshclient.Dial(sshclient.Config{
		Host:     req.Host,
		Port:     req.Port,
		User:     req.User,
		Password: req.Password,
		KeyPath:  req.KeyPath,
	})
	if err != nil {
		return "", err
	}

	id := sess.ID()
	a.sessions[id] = sess

	err = sess.StartShell(func(data []byte) {
		runtime.EventsEmit(a.ctx, "ssh:data:"+id, string(data))
	})
	if err != nil {
		return "", err
	}

	return id, nil
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
		out = append(out, RemoteFile{
			Name:  e.Name,
			Path:  e.Path,
			IsDir: e.IsDir,
			Size:  e.Size,
		})
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
