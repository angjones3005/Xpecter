#!/usr/bin/env bash
# Run from the root of your Specter repo.
set -euo pipefail

cat > "backend/sshclient/sshclient.go" << 'SPECTER_EOF_0'
// Package sshclient wraps golang.org/x/crypto/ssh to provide an
// interactive shell session, with real host key verification against the
// user's standard ~/.ssh/known_hosts file (no more InsecureIgnoreHostKey).
package sshclient

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

var ErrPassphraseRequired = errors.New("private key is encrypted, passphrase required")

type Config struct {
	Host       string
	Port       int
	User       string
	Password   string
	KeyPath    string
	Passphrase string
	// IgnoreKeyPermWarning skips the KeyPermissionWarning check below,
	// set only after the user has explicitly acknowledged it once
	// (SPE-65). Specter didn't create the user's key file, so this is a
	// soft warning with real user choice, not a hard block like OpenSSH
	// itself does.
	IgnoreKeyPermWarning bool
	// DisableKeepalive turns off the periodic no-op probe (SPE-79),
	// read from the persisted Settings.SSHKeepaliveDisabled preference
	// at connect time in app.go's Connect(), not something the caller
	// usually sets directly.
	DisableKeepalive bool
}

type Session struct {
	id      string
	client  *ssh.Client
	sess    *ssh.Session
	stdin   io.WriteCloser
	closing atomic.Bool
	// usedLegacyCompat records whether this session had to fall back to
	// the widened SPE-99 algorithm set to connect, exposed via
	// UsedLegacyCompat() below.
	usedLegacyCompat bool
}

// CloseReason distinguishes why a session's read loop stopped, so the
// frontend can show an accurate message (SPE-59) instead of just going
// quiet. Deliberate is set when Close() was called locally (tab closed by
// the user); everything else is an unexpected drop the user should be
// told about, since they may still be typing into a dead session.
type CloseReason struct {
	// Deliberate is true only when the user closed this session
	// themselves (closing the tab). No frontend notification is needed
	// in that case, the tab is already gone.
	Deliberate bool
	// EOF is true when the remote side cleanly closed the connection
	// (io.EOF), matching MobaXterm's "Remote side unexpectedly closed
	// network connection" case.
	EOF bool
	// Err holds the underlying error for anything that isn't a clean
	// EOF, e.g. a network-level drop or timeout.
	Err error
}

// HostKeyUnknownError means this host has never been seen before — not in
// known_hosts at all. The frontend should show the fingerprint and, if the
// user accepts, call TrustHost before retrying Connect.
type HostKeyUnknownError struct {
	Host        string
	Fingerprint string
	KeyType     string
}

func (e *HostKeyUnknownError) Error() string {
	return fmt.Sprintf("unknown host key for %s (%s): %s", e.Host, e.KeyType, e.Fingerprint)
}

// HostKeyChangedError means the host IS in known_hosts, but presented a
// different key than what's on record — the classic MITM signal. Requires
// deliberate, explicit override (TrustHostDespiteChange), never silent.
type HostKeyChangedError struct {
	Host           string
	NewFingerprint string
	KeyType        string
}

func (e *HostKeyChangedError) Error() string {
	return fmt.Sprintf("WARNING: host key for %s has CHANGED (%s): %s — this can mean the server was reconfigured, OR that you're being intercepted", e.Host, e.KeyType, e.NewFingerprint)
}

// KeyPermissionWarning means the selected private key file is
// group/world-readable, the same condition real OpenSSH refuses to use
// a key under. Specter treats it as a soft warning rather than a hard
// block (SPE-65), since it didn't create this file and the user may
// have a real reason it's set up this way, but they should know.
type KeyPermissionWarning struct {
	Path string
	Mode os.FileMode
}

func (e *KeyPermissionWarning) Error() string {
	return fmt.Sprintf("key file %s has overly permissive mode %04o (should not be group/world-readable)", e.Path, e.Mode.Perm())
}

// pendingKeys caches the offending public key by hostname between the
// failed Connect attempt and the frontend's trust decision, so we don't
// need to round-trip raw key bytes through the JS bridge.
var (
	pendingKeysMu sync.Mutex
	pendingKeys   = map[string]pendingKey{}
)

// pendingKeyTTL bounds how long an abandoned trust prompt's key stays in
// memory (SPE-65). Not a security issue, it's just the offending public
// key plus a timestamp, but untidy to keep forever if a user closes the
// app or navigates away without accepting or rejecting.
const pendingKeyTTL = 10 * time.Minute

// sweepExpiredPendingKeys drops entries older than pendingKeyTTL. Called
// lazily whenever a new pending key is added rather than on a background
// timer, no ticket goroutine needed for what's genuinely a minor cleanup.
// Caller must hold pendingKeysMu.
func sweepExpiredPendingKeys() {
	cutoff := time.Now().Add(-pendingKeyTTL)
	for host, pk := range pendingKeys {
		if pk.at.Before(cutoff) {
			delete(pendingKeys, host)
		}
	}
}

type pendingKey struct {
	key  ssh.PublicKey
	addr string
	at   time.Time
}

func knownHostsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "known_hosts")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		f, ferr := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
		if ferr != nil {
			return "", ferr
		}
		_ = f.Close()
	}
	return path, nil
}

func hostKeyCallback() (ssh.HostKeyCallback, error) {
	path, err := knownHostsPath()
	if err != nil {
		return nil, err
	}
	base, err := knownhosts.New(path)
	if err != nil {
		return nil, err
	}

	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := base(hostname, remote, key)
		if err == nil {
			return nil
		}

		var keyErr *knownhosts.KeyError
		if errors.As(err, &keyErr) {
			pendingKeysMu.Lock()
			sweepExpiredPendingKeys()
			pendingKeys[hostname] = pendingKey{key: key, addr: remote.String(), at: time.Now()}
			pendingKeysMu.Unlock()

			fp := ssh.FingerprintSHA256(key)
			if len(keyErr.Want) == 0 {
				return &HostKeyUnknownError{Host: hostname, Fingerprint: fp, KeyType: key.Type()}
			}
			return &HostKeyChangedError{Host: hostname, NewFingerprint: fp, KeyType: key.Type()}
		}
		return err
	}, nil
}

// TrustHost records a genuinely new host's key in known_hosts. Only valid
// after a HostKeyUnknownError — call this once the user has confirmed the
// fingerprint shown by the frontend.
func TrustHost(hostname string) error {
	return writeTrustedKey(hostname, false)
}

// TrustHostDespiteChange overwrites an existing, mismatched known_hosts
// entry. Only valid after a HostKeyChangedError, and only after explicit,
// deliberate user confirmation — this is the override for a potential MITM
// warning, so the frontend must make this a distinctly harder action than
// TrustHost's ordinary first-connect flow, not a one-click default.
func TrustHostDespiteChange(hostname string) error {
	return writeTrustedKey(hostname, true)
}

func writeTrustedKey(hostname string, replacing bool) error {
	pendingKeysMu.Lock()
	pk, ok := pendingKeys[hostname]
	if ok {
		delete(pendingKeys, hostname)
	}
	pendingKeysMu.Unlock()

	if !ok {
		return fmt.Errorf("no pending host key for %s (fingerprint may have expired, try connecting again)", hostname)
	}

	path, err := knownHostsPath()
	if err != nil {
		return err
	}

	if replacing {
		if err := removeHostLines(path, hostname); err != nil {
			return err
		}
	}

	line := knownhosts.Line([]string{hostname}, pk.key)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(line + "\n"); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// removeHostLines strips existing known_hosts lines for hostname before a
// changed-key override is written, avoiding a stale, conflicting entry.
func removeHostLines(path, hostname string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), hostname+" ") {
			continue
		}
		kept = append(kept, line)
	}
	return os.WriteFile(path, []byte(strings.Join(kept, "\n")), 0o600)
}

func Dial(cfg Config) (*Session, error) {
	if cfg.Port == 0 {
		cfg.Port = 22
	}

	var authMethods []ssh.AuthMethod
	if cfg.KeyPath != "" {
		if !cfg.IgnoreKeyPermWarning {
			if info, err := os.Stat(cfg.KeyPath); err == nil {
				if info.Mode().Perm()&0o077 != 0 {
					return nil, &KeyPermissionWarning{Path: cfg.KeyPath, Mode: info.Mode()}
				}
			}
			// A Stat failure here isn't fatal, os.ReadFile below will
			// surface the real error (missing file, no permission to
			// even stat it, etc.) with better context than this check would.
		}
		key, err := os.ReadFile(cfg.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("reading key: %w", err)
		}
		signer, err := ssh.ParsePrivateKey(key)
		if err != nil {
			var passErr *ssh.PassphraseMissingError
			if errors.As(err, &passErr) {
				if cfg.Passphrase == "" {
					return nil, ErrPassphraseRequired
				}
				signer, err = ssh.ParsePrivateKeyWithPassphrase(key, []byte(cfg.Passphrase))
				if err != nil {
					return nil, fmt.Errorf("parsing key with passphrase: %w", err)
				}
			} else {
				return nil, fmt.Errorf("parsing key: %w", err)
			}
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}
	if cfg.Password != "" {
		authMethods = append(authMethods, ssh.Password(cfg.Password))
	}

	hkCallback, err := hostKeyCallback()
	if err != nil {
		return nil, fmt.Errorf("setting up host key verification: %w", err)
	}

	sshCfg := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            authMethods,
		Timeout:         10 * time.Second,
		HostKeyCallback: hkCallback,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	client, err := ssh.Dial("tcp", addr, sshCfg)
	usedLegacyCompat := false
	if err != nil {
		// SPE-99: automatic fallback, not a manual checkbox the person
		// has to predict in advance. Only retries for the specific
		// failure this addresses (AlgorithmNegotiationError, "no common
		// algorithm"), a real exported error type confirmed against
		// Go's own source, not a broad catch-all retry on any failure.
		var algErr *ssh.AlgorithmNegotiationError
		if errors.As(err, &algErr) {
			// Combine the library's own real "modern" and "insecure"
			// algorithm lists rather than hardcoding a guessed copy of
			// either, that guess could silently drift from what the
			// installed x/crypto/ssh version actually implements/
			// defaults to. Modern algorithms listed first, so they're
			// still preferred whenever the peer supports them, legacy
			// ones only come into play as a fallback for older devices
			// that need them, confirmed real via a real CBC-only
			// device tonight.
			supported := ssh.SupportedAlgorithms()
			insecure := ssh.InsecureAlgorithms()
			legacyCfg := &ssh.ClientConfig{
				User:            cfg.User,
				Auth:            authMethods,
				Timeout:         10 * time.Second,
				HostKeyCallback: hkCallback,
				Config: ssh.Config{
					Ciphers:      append(append([]string{}, supported.Ciphers...), insecure.Ciphers...),
					KeyExchanges: append(append([]string{}, supported.KeyExchanges...), insecure.KeyExchanges...),
					MACs:         append(append([]string{}, supported.MACs...), insecure.MACs...),
				},
				HostKeyAlgorithms: append(append([]string{}, supported.HostKeys...), insecure.HostKeys...),
			}
			client, err = ssh.Dial("tcp", addr, legacyCfg)
			if err == nil {
				usedLegacyCompat = true
			}
		}
		if err != nil {
			return nil, err
		}
	}

	sess := &Session{id: newID(), client: client, usedLegacyCompat: usedLegacyCompat}
	if !cfg.DisableKeepalive {
		go sess.keepaliveLoop()
	}
	return sess, nil
}

// UsedLegacyCompat reports whether this session had to fall back to
// the widened SPE-99 algorithm set to connect at all, so callers can
// surface a one-time, honest notice rather than silently using weaker
// security for the connection.
func (s *Session) UsedLegacyCompat() bool { return s.usedLegacyCompat }

// keepaliveLoop periodically probes the connection with a no-op SSH
// global request (SPE-79). golang.org/x/crypto/ssh doesn't send
// keepalives on its own, meaning an idle session behind a firewall/NAT
// that silently drops idle connections (no TCP RST ever sent) can hang
// forever on read() rather than erroring, the session just looks frozen
// with zero feedback. A failed keepalive closes the client, which
// unblocks the shell's read loop and correctly fires onClose (SPE-59's
// disconnect panel) through the existing path, reusing Close() rather
// than duplicating its cleanup.
func (s *Session) keepaliveLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if s.closing.Load() {
			return
		}
		if _, _, err := s.client.SendRequest("keepalive@openssh.com", true, nil); err != nil {
			_ = s.Close()
			return
		}
	}
}

func (s *Session) ID() string             { return s.id }
func (s *Session) SSHClient() *ssh.Client { return s.client }

// StartShell opens an interactive shell on the session. onData streams
// output as it arrives; onClose fires exactly once, when the read loop
// stops for any reason (clean remote close, network drop, or a
// deliberate local Close()), so the frontend can distinguish "the switch
// closed the session" from "I closed this tab" (SPE-59).
func (s *Session) StartShell(onData func([]byte), onClose func(CloseReason)) error {
	sess, err := s.client.NewSession()
	if err != nil {
		return err
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
	if err := sess.RequestPty("xterm-256color", 40, 120, modes); err != nil {
		_ = sess.Close()
		return err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		_ = sess.Close()
		return err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		_ = sess.Close()
		return err
	}
	if err := sess.Shell(); err != nil {
		_ = sess.Close()
		return err
	}
	s.sess = sess
	s.stdin = stdin
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				onData(chunk)
			}
			if err != nil {
				if onClose != nil {
					onClose(CloseReason{
						Deliberate: s.closing.Load(),
						EOF:        errors.Is(err, io.EOF),
						Err:        err,
					})
				}
				return
			}
		}
	}()
	return nil
}

func (s *Session) Write(data []byte) error {
	if s.stdin == nil {
		return fmt.Errorf("shell not started")
	}
	_, err := s.stdin.Write(data)
	return err
}

func (s *Session) Resize(cols, rows int) error {
	if s.sess == nil {
		return fmt.Errorf("shell not started")
	}
	return s.sess.WindowChange(rows, cols)
}

func (s *Session) Close() error {
	s.closing.Store(true)
	if s.sess != nil {
		_ = s.sess.Close()
	}
	return s.client.Close()
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
SPECTER_EOF_0

cat > "app.go" << 'SPECTER_EOF_1'
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"os/user"
	"path/filepath"
	"strings"

	"specter/backend/config"
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
}

func NewApp() *App {
	return &App{
		sessions: make(map[string]*sshclient.Session),
		locals:   make(map[string]*pty.LocalTerminal),
		serials:  make(map[string]*serialclient.Session),
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

// --- Serial/COM port console (direct hardware console access) ---

// ConnectSerial opens a serial port at the given baud rate (8N1, no flow
// control) and returns a session ID, following the same one-per-tab
// pattern as StartLocalTerminal.
func (a *App) ConnectSerial(portName string, baud int) (string, error) {
	id := newID()
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
SPECTER_EOF_1

cat > "frontend/wailsjs.d.ts" << 'SPECTER_EOF_2'
// Wails injects these globals at build time from the Go backend's bound
// methods (app.go). Hand-written here since Specter isn't using the
// `wails generate` codegen step yet, keep this in sync with app.go.
export interface ConnectRequest {
  host: string;
  port: number;
  user: string;
  password?: string;
  keyPath?: string;
  passphrase?: string;
  // SPE-65: user already acknowledged the key-permission warning once
  // for this attempt.
  ignoreKeyPermWarning?: boolean;
}
export interface ConnectResult {
  sessionId?: string;
  needsTrust?: boolean;
  changed?: boolean;
  host?: string;
  fingerprint?: string;
  keyType?: string;
  needsPassphrase?: boolean;
  // SPE-65: the selected key file is group/world-readable. Soft
  // warning, not a hard block, retry with ignoreKeyPermWarning once
  // acknowledged.
  needsKeyPermConfirm?: boolean;
  keyPermPath?: string;
  keyPermMode?: string;
  // SPE-99: true if this connection only succeeded via automatic
  // fallback to a widened algorithm set, not something requested, an
  // honest after-the-fact notice about reduced security.
  legacyCompat?: boolean;
}
export interface SessionProfile {
  id: string;
  name: string;
  type?: string;
  host?: string;
  port?: number;
  user?: string;
  keyPath?: string;
  serialPort?: string;
  baud?: number;
  groupId?: string;
  tags?: string[];
  lastUsed?: string;
  // Drives the sidebar icon for SSH sessions: '' / 'host' (default,
  // VM/Linux box) or 'switch' (network hardware). Serial sessions
  // always show their own icon regardless of this field.
  deviceKind?: string;
}
export interface SessionGroup {
  id: string;
  name: string;
  parentId?: string;
}
export interface RemoteFile {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}
// Emitted as "ssh:closed:<id>" / "serial:closed:<id>" when a session's
// read loop stops unexpectedly (SPE-59). Deliberate closes (user closed
// the tab) never emit this event, there's nothing to tell the user.
export interface SessionClosedEvent {
  eof: boolean;
  message: string;
}
// Global terminal personalization (SPE-61): wallpaper, color scheme,
// and font, one set for the whole app, not per-session/per-tab.
export interface Settings {
  wallpaperPath?: string;
  wallpaperOpacity?: number;
  colorScheme?: string;
  fontFamily?: string;
  fontSize?: number;
  // Frontend-only, never sent to the backend: the wallpaper image
  // re-read as a data: URL each load via App.ReadImageFile(wallpaperPath),
  // since only the path itself is persisted in settings.json.
  wallpaperDataUrl?: string;
  // SPE-79. Inverted polarity matches the Go struct: false/absent means
  // keepalive is ON (the default), only true actually disables it.
  sshKeepaliveDisabled?: boolean;
}
// Check-for-updates: a GitHub releases API check on launch. Includes an
// in-app download+launch flow (DownloadAndInstallUpdate below), the
// person still explicitly clicks a button, this isn't silent
// auto-update, but the click now does the whole thing in-app rather
// than handing off to a browser tab.
export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  assetUrl: string;
}
export interface AppBindings {
  StartLocalTerminal(shell: string): Promise<string>;
  WriteLocalTerminal(id: string, data: string): Promise<void>;
  ResizeLocalTerminal(id: string, cols: number, rows: number): Promise<void>;
  CloseLocalTerminal(id: string): Promise<void>;
  Connect(req: ConnectRequest): Promise<ConnectResult>;
  SelectKeyFile(): Promise<string>;
  SelectImageFile(): Promise<string>;
  ReadImageFile(path: string): Promise<string>;
  SaveTextFile(defaultFilename: string, content: string): Promise<string>;
  SelectAnyFile(): Promise<string>;
  ReadLocalFile(path: string): Promise<string>;
  WriteLocalFile(path: string, content: string): Promise<void>;
  GetSettings(): Promise<Settings>;
  SaveSettings(settings: Settings): Promise<void>;
  GetVersion(): Promise<string>;
  CheckForUpdate(): Promise<UpdateInfo>;
  DownloadAndInstallUpdate(assetUrl: string): Promise<void>;
  GetClipboardText(): Promise<string>;
  GetOSUsername(): Promise<string>;
  GetPlatform(): Promise<string>;
  ConnectSerial(portName: string, baud: number): Promise<string>;
  WriteSerial(id: string, data: string): Promise<void>;
  CloseSerial(id: string): Promise<void>;
  ListSerialPorts(): Promise<string[]>;
  ListSessions(): Promise<SessionProfile[]>;
  SaveSession(profile: SessionProfile): Promise<void>;
  DeleteSession(id: string): Promise<void>;
  ListGroups(): Promise<SessionGroup[]>;
  SaveGroup(group: SessionGroup): Promise<void>;
  DeleteGroup(id: string): Promise<void>;
  TrustHost(host: string): Promise<void>;
  TrustHostDespiteChange(host: string): Promise<void>;
  WriteSSH(id: string, data: string): Promise<void>;
  ResizeSSH(id: string, cols: number, rows: number): Promise<void>;
  CloseSSH(id: string): Promise<void>;
  ListRemoteDir(id: string, path: string): Promise<RemoteFile[]>;
  ReadRemoteFile(id: string, path: string): Promise<string>;
  WriteRemoteFile(id: string, path: string, content: string): Promise<void>;
  UploadRemoteFile(id: string, path: string, base64Content: string): Promise<void>;
}
interface WailsRuntime {
  EventsOn(eventName: string, callback: (...data: unknown[]) => void): () => void;
  EventsOff(eventName: string, ...additionalEventNames: string[]): void;
  EventsEmit(eventName: string, ...data: unknown[]): void;
  WindowMinimise(): void;
  WindowToggleMaximise(): void;
  Quit(): void;
  BrowserOpenURL(url: string): void;
  WindowFullscreen(): void;
  WindowUnfullscreen(): void;
  WindowIsFullscreen(): Promise<boolean>;
}
declare global {
  interface Window {
    go: { main: { App: AppBindings } };
    runtime: WailsRuntime;
  }
}
SPECTER_EOF_2

cat > "frontend/index.html" << 'SPECTER_EOF_3'
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Specter</title>
  <style>
    :root[data-theme="dark"] {
      color-scheme: dark;
      --bg: #1e1e1e;
      --bg-alt: #252525;
      --bg-input: #1a1a1a;
      --border: #333;
      --text: #ddd;
      --text-dim: #999;
      --hover: #2a2a2a;
      --accent: #3178c6;
      --danger: #e5484d;
      --success: #2ea043;
      --warning: #d29922;
    }
    :root[data-theme="light"] {
      color-scheme: light;
      --bg: #ffffff;
      --bg-alt: #f3f3f3;
      --bg-input: #ffffff;
      --border: #d0d0d0;
      --text: #1e1e1e;
      --text-dim: #666;
      --hover: #e8e8e8;
      --accent: #3178c6;
      --danger: #cf3d3e;
      --success: #1f8a3d;
      --warning: #a06800;
    }
    html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font-family: sans-serif; }
    body { display: flex; flex-direction: column; }
    #menubar { flex: 0 0 auto; display: flex; align-items: center; background: var(--bg-alt); border-bottom: 1px solid var(--border); font-size: 13px; user-select: none; position: relative; z-index: 500; --wails-draggable: drag; }
    #menubar .menu-item { padding: 5px 12px; cursor: pointer; color: var(--text); position: relative; --wails-draggable: no-drag; }
    #menubar .menu-item:hover, #menubar .menu-item.open { background: var(--hover); }
    #menubar .menu-dropdown { position: absolute; top: 100%; left: 0; background: var(--bg-alt); border: 1px solid var(--border); min-width: 190px; display: none; flex-direction: column; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    #menubar .menu-dropdown.open { display: flex; }
    #menubar .menu-dropdown .item { padding: 6px 12px; cursor: pointer; white-space: nowrap; }
    #menubar .menu-dropdown .item:hover { background: var(--hover); }
    #menubar .menu-dropdown .item.disabled { opacity: 0.4; cursor: default; pointer-events: none; }
    #editor-saveas-menu .item { padding: 6px 12px; cursor: pointer; white-space: nowrap; }
    #editor-saveas-menu .item:hover { background: var(--hover); }
    #menubar .menu-dropdown .separator { border-top: 1px solid var(--border); margin: 4px 0; }
    #menubar .menu-dropdown .item label { display: flex; align-items: center; gap: 6px; cursor: pointer; width: 100%; justify-content: space-between; }
    /* Frameless window: this bar IS the title bar (--wails-draggable:drag
       above), so brand/spacer/controls opt back OUT of dragging where
       they need real clicks. */
    #titlebar-brand { display: flex; align-items: center; gap: 6px; padding: 0 10px 0 12px; --wails-draggable: no-drag; }
    #titlebar-brand img { width: 18px; height: 18px; border-radius: 4px; display: block; }
    #titlebar-brand span { font-weight: 600; color: var(--text); letter-spacing: 0.2px; }
    #titlebar-spacer { flex: 1; align-self: stretch; }
    #titlebar-controls { display: flex; align-self: stretch; --wails-draggable: no-drag; }
    #titlebar-controls button { width: 44px; border: none; background: transparent; color: var(--text-dim); cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; }
    #titlebar-controls button:hover { background: var(--hover); color: var(--text); }
    #titlebar-controls button#win-close:hover { background: #e5484d; color: #ffffff; }
    #app {
      flex: 1; min-height: 0; display: grid;
      /* SPE-96: --sw/--ew/--rsw/--rew as variables (rather than
         hardcoding pixel values in every collapse-state combination
         below) means the right-side variant only needs to reorder the
         template, not re-derive collapse logic for a second time.
         Resize-handle tracks (--rsw/--rew) collapse to 0px alongside
         their pane, not fixed at 5px always, matching the original
         explicit combined rule this replaces (0px 0px 1fr 0px 0px when
         both were collapsed), a stray 5px gap would remain otherwise
         even when fully collapsed. */
      --sw: 220px;
      --ew: 1fr;
      --rsw: 5px;
      --rew: 5px;
      grid-template-columns: var(--sw) var(--rsw) 1fr var(--rew) var(--ew);
    }
    #statusbar { flex: 0 0 auto; height: 22px; background: var(--bg-alt); border-top: 1px solid var(--border); display: flex; align-items: center; padding: 0 10px; font-size: 11px; color: var(--text-dim); }
    #app.sidebar-collapsed { --sw: 0px; --rsw: 0px; }
    #app.sidebar-collapsed #sidebar, #app.sidebar-collapsed #resize-sidebar { display: none; }
    .resize-handle { cursor: col-resize; background: transparent; }
    #resize-sidebar { grid-column: 2; }
    #resize-editor { grid-column: 4; }
    .resize-handle:hover, .resize-handle.dragging { background: var(--accent); }
    #sidebar { border-right: 1px solid var(--border); overflow-y: auto; padding: 8px; font-size: 13px; grid-column: 1; }
    #sidebar .entry { padding: 4px 6px; cursor: pointer; border-radius: 4px; }
    #sidebar .entry:hover { background: var(--hover); }
    .session-entry { padding: 4px 6px; cursor: pointer; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
    .session-entry:hover { background: var(--hover); }
    .session-entry .delete-btn { opacity: 0.5; font-size: 11px; }
    .session-entry .delete-btn:hover { opacity: 1; color: var(--danger); }
    #terminal-pane { border-right: 1px solid var(--border); min-width: 0; display: flex; flex-direction: column; overflow: hidden; grid-column: 3; }
    #editor-pane { min-width: 0; display: flex; flex-direction: column; overflow: hidden; grid-column: 5; }
    #app.editor-collapsed { --ew: 0px; --rew: 0px; }
    #app.editor-collapsed #editor-pane, #app.editor-collapsed #resize-editor { display: none; }
    /* SPE-96: sidebar on the right instead of the left, a pure
       left-right mirror of the default order (editor and sidebar swap
       ends, terminal-pane stays in the middle either way). Explicit
       grid-column on every item, same discipline as the earlier fix for
       the collapse-related layout bug, not implicit auto-placement. */
    #app.sidebar-right { grid-template-columns: var(--ew) var(--rew) 1fr var(--rsw) var(--sw); }
    #app.sidebar-right #editor-pane { grid-column: 1; }
    #app.sidebar-right #resize-editor { grid-column: 2; }
    #app.sidebar-right #resize-sidebar { grid-column: 4; }
    #app.sidebar-right #sidebar { grid-column: 5; border-right: none; border-left: 1px solid var(--border); }
    #app.sidebar-right #terminal-pane { border-right: none; border-left: 1px solid var(--border); }
    #terminal { flex: 1; min-height: 0; padding: 4px; box-sizing: border-box; }
    #editor { flex: 1; min-height: 0; }
    .toolbar { padding: 6px 10px; font-size: 13px; background: var(--bg-alt); border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    .toolbar input { background: var(--bg-input); border: 1px solid var(--border); color: var(--text); padding: 3px 6px; width: 90px; min-width: 0; }
    .toolbar button { padding: 3px 8px; }
    .tab { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px; border-right: 1px solid var(--border); cursor: pointer; white-space: nowrap; color: var(--text-dim); }
    .tab.active { background: var(--bg-alt); color: var(--text); border-top: 2px solid var(--accent); }
    .tab .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #666; }
    .tab .status-dot.connected { background: var(--success); }
    .tab .status-dot.connecting { background: var(--warning); }
    .tab .status-dot.disconnected { background: var(--danger); }
    .tab .tab-close { opacity: 0.5; margin-left: 4px; }
    .tab .tab-close:hover { opacity: 1; color: var(--danger); }
    .tab-add { padding: 6px 10px; cursor: pointer; color: var(--text-dim); font-size: 14px; }
    .tab-add:hover { color: var(--text); }
    #theme-select {
      background: var(--bg-input);
      border: 1px solid var(--border);
      color: var(--text);
      font-size: 12px;
      padding: 3px 20px 3px 6px;
      -webkit-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0l5 6 5-6z' fill='%23999'/></svg>");
      background-repeat: no-repeat;
      background-position: right 6px center;
      border-radius: 4px;
    }
    #theme-select option {
      background: var(--bg-input);
      color: var(--text);
    }
    button {
      background: var(--accent);
      color: #ffffff;
      border: none;
      border-radius: 5px;
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      transition: opacity 0.12s ease;
    }
    button:hover {
      opacity: 0.85;
    }
    button:active {
      opacity: 0.7;
    }
    .toolbar button, .picker-item, #session-picker .close {
      background: var(--bg-input);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .toolbar button:hover {
      opacity: 1;
      background: var(--hover);
    }
    #session-picker-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 2000; }
    #session-picker-overlay.open { display: flex; }
    #session-picker { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; width: 280px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    #session-picker .picker-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--border); font-size: 14px; }
    #session-picker .picker-header .close { cursor: pointer; opacity: 0.6; }
    #session-picker .picker-header .close:hover { opacity: 1; }
    #session-picker .picker-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 20px; }
    #session-picker .picker-item { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--text); border: 1px solid var(--border); }
    #session-picker .picker-item:hover { background: var(--hover); border-color: var(--accent); }
    #session-picker .picker-item .icon { font-size: 28px; }
    .disconnect-panel {
      position: absolute;
      left: 8px;
      right: 8px;
      bottom: 8px;
      background: var(--bg-alt);
      border: 1px solid var(--border);
      border-top: 2px solid var(--danger);
      border-radius: 6px;
      padding: 10px 12px;
      font-family: Menlo, Consolas, monospace;
      font-size: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      z-index: 10;
    }
    .disconnect-title { color: var(--danger); font-weight: bold; margin-bottom: 6px; }
    .disconnect-action { display: flex; align-items: center; gap: 8px; padding: 3px 2px; cursor: pointer; color: var(--text); border-radius: 4px; }
    .disconnect-action:hover { background: var(--hover); }
    .disconnect-key { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; padding: 1px 6px; border: 1px solid var(--accent); border-radius: 4px; color: var(--accent); font-weight: bold; font-size: 11px; }
    /* Theme the terminal's native scrollbar to match the app instead of
       the OS default (usually white/light, standing out badly against
       the dark theme and any wallpaper). Only touches the scrollbar's
       own decoration, never .xterm-viewport's background-color itself,
       that's what broke the scrollbar entirely earlier tonight, this
       is a completely different, safe styling surface. */
    /* Real fix: hide the native scrollbar entirely and draw our own
       (setupCustomScrollbar in main.ts). Two earlier attempts
       (::-webkit-scrollbar styling, then the standard
       scrollbar-width/scrollbar-color properties + color-scheme) both
       worked on Linux/WebKitGTK but not Windows/WebView2, confirmed by
       testing: WebView2 controls its native scrollbar via a separate
       environment-level API Wails v2 doesn't expose, not something more
       CSS properties can reach. A custom-drawn scrollbar is pure page
       content, not dependent on any engine's native rendering, so it's
       genuinely identical on every platform. */
    .xterm-viewport { scrollbar-width: none; }
    .xterm-viewport::-webkit-scrollbar { display: none; width: 0; }
    .custom-scrollbar-track { position: absolute; top: 0; right: 2px; bottom: 0; width: 8px; z-index: 5; }
    .custom-scrollbar-thumb { position: absolute; left: 0; right: 0; background: var(--border); border-radius: 4px; cursor: pointer; min-height: 20px; }
    .custom-scrollbar-thumb:hover, .custom-scrollbar-thumb.dragging { background: var(--text-dim); }
  </style>
</head>
<body>
  <div id="menubar">
    <div id="titlebar-brand"><img src="/appicon.png" alt="" /><span>Specter</span></div>
    <div class="menu-item" data-menu="terminal">Terminal
      <div class="menu-dropdown" id="menu-terminal">
        <div class="item" id="menu-new-tab">New Tab</div>
        <div class="item" id="menu-new-local-shell">New Local Shell</div>
        <div class="item" id="menu-close-tab">Close Tab</div>
        <div class="item" id="menu-disconnect-tab">Disconnect <span style="opacity:0.5;font-size:11px;">Ctrl+Shift+X</span></div>
        <div class="separator"></div>
        <div class="item" id="menu-clear-screen">Clear Screen</div>
      </div>
    </div>
    <div class="menu-item" data-menu="sessions">Sessions
      <div class="menu-dropdown" id="menu-sessions">
        <div class="item" id="menu-new-session">New Session</div>
        <div class="item" id="menu-new-folder">New Folder</div>
      </div>
    </div>
    <div class="menu-item" data-menu="view">View
      <div class="menu-dropdown" id="menu-view">
        <div class="item" id="menu-toggle-editor">Toggle Editor Pane</div>
        <div class="item" id="menu-toggle-sidebar">Toggle Sidebar <span style="opacity:0.5;font-size:11px;">Ctrl+Shift+B</span></div>
        <div class="item" id="menu-toggle-fullscreen">Fullscreen <span style="opacity:0.5;font-size:11px;">F11</span></div>
      </div>
    </div>
    <div class="menu-item" data-menu="tools">Tools
      <div class="menu-dropdown" id="menu-tools">
        <div class="item" id="menu-tool-terminal">Terminal</div>
        <div class="item" id="menu-tool-cmd">Command Prompt</div>
        <div class="item" id="menu-tool-powershell">PowerShell</div>
        <div class="separator"></div>
        <div class="item" id="menu-tool-text-editor">Text Editor</div>
      </div>
    </div>
    <div class="menu-item" data-menu="settings">Settings
      <div class="menu-dropdown" id="menu-settings">
        <div class="item"><label>Theme <select id="theme-select"><option value="dark">Dark</option><option value="light">Light</option></select></label></div>
        <div class="item"><label>Sidebar position <select id="sidebar-position-select"><option value="left">Left</option><option value="right">Right</option></select></label></div>
        <div class="item"><label>Terminal colors
          <select id="colorscheme-select">
            <option value="dark">Dark (default)</option>
            <option value="light">Light (default)</option>
            <option value="dracula">Dracula</option>
            <option value="nord">Nord</option>
            <option value="solarized-dark">Solarized Dark</option>
            <option value="solarized-light">Solarized Light</option>
            <option value="gruvbox-dark">Gruvbox Dark</option>
            <option value="one-dark">One Dark</option>
          </select>
        </label></div>
        <div class="item"><label>Font
          <select id="font-select">
            <option value="menlo">Menlo</option>
            <option value="consolas">Consolas</option>
            <option value="cascadia">Cascadia Code</option>
            <option value="fira">Fira Code</option>
            <option value="jetbrains">JetBrains Mono</option>
            <option value="courier">Courier New</option>
            <option value="ibmplex">IBM Plex Mono</option>
            <option value="sourcecodepro">Source Code Pro</option>
            <option value="inconsolata">Inconsolata</option>
            <option value="victor">Victor Mono</option>
            <option value="ubuntumono">Ubuntu Mono</option>
          </select>
        </label></div>
        <div class="separator"></div>
        <div class="item"><label>Wallpaper <button id="wallpaper-browse" type="button">Browse...</button></label></div>
        <div class="item" id="wallpaper-opacity-row" style="display:none;">
          <label>Opacity <input type="range" id="wallpaper-opacity" min="0" max="60" value="15" style="vertical-align:middle;" /></label>
        </div>
        <div class="item" id="wallpaper-clear-row" style="display:none;"><span id="wallpaper-clear" style="cursor:pointer;color:var(--danger);">Clear wallpaper</span></div>
        <div class="separator"></div>
        <div class="item"><label><input type="checkbox" id="osc52-toggle" /> OSC 52 clipboard sync (remote can write to your clipboard)</label></div>
        <div class="item"><label><input type="checkbox" id="copy-on-select-toggle" /> Copy on select</label></div>
        <div class="item"><label><input type="checkbox" id="rclick-paste-toggle" checked /> Right-click to paste</label></div>
        <div class="item"><label><input type="checkbox" id="warn-multiline-paste-toggle" checked /> Warn before pasting multiple lines</label></div>
        <div class="item"><label><input type="checkbox" id="ssh-keepalive-toggle" checked /> SSH keepalive (prevent idle disconnects)</label></div>
        <div class="item"><label><input type="checkbox" id="show-tab-numbers-toggle" /> Show tab numbers</label></div>
        <div class="item"><label><input type="checkbox" id="highlight-toggle" checked /> Highlight status keywords</label></div>
        <div class="separator"></div>
        <div class="item" id="menu-check-updates" style="cursor:pointer;">Check for Updates&#8230; <span id="menu-version" style="opacity:0.5;font-size:11px;"></span></div>
      </div>
    </div>
    <div id="titlebar-spacer"></div>
    <div id="titlebar-controls">
      <button id="theme-toggle-btn" title="Toggle light/dark theme">&#127762;</button>
      <button id="win-minimize" title="Minimize">&#9472;</button>
      <button id="win-maximize" title="Maximize">&#9633;</button>
      <button id="win-close" title="Close">&#10005;</button>
    </div>
  </div>
  <div id="update-banner" style="display:none;align-items:center;gap:10px;padding:6px 14px;background:#1f3a5f;border-bottom:1px solid var(--border);font-size:12px;color:#cfe3ff;">
    <span id="update-banner-text"></span>
    <button id="update-banner-download" style="margin-left:auto;padding:3px 10px;font-size:12px;">Download</button>
    <span id="update-banner-dismiss" style="cursor:pointer;opacity:0.7;padding:0 4px;" title="Dismiss">&#10005;</span>
  </div>
  <div id="app">
    <div id="sidebar">
      <div class="toolbar" style="padding-left:0;display:flex;align-items:center;justify-content:space-between;">
        <strong>Saved sessions</strong>
        <span id="sidebar-collapse-btn" title="Hide sidebar (Ctrl+Shift+B)" style="cursor:pointer;padding:2px 6px;opacity:0.6;user-select:none;">&#10094;</span>
      </div>
      <input id="session-search" placeholder="Quick connect..." style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);color:var(--text);padding:4px 6px;margin-bottom:4px;font-size:12px;" />
      <div id="session-list"></div>
      <div class="toolbar" style="padding-left:0;cursor:pointer;" id="remote-files-header">
        <strong id="remote-files-label">Remote files</strong>
      </div>
      <div id="file-list"></div>
    </div>
    <div class="resize-handle" id="resize-sidebar"></div>
    <div id="terminal-pane">
      <div style="display:flex;align-items:center;background:var(--bg-input);border-bottom:1px solid var(--border);">
        <span id="sidebar-expand-btn" title="Show sidebar (Ctrl+Shift+B)" style="display:none;cursor:pointer;padding:0 8px;opacity:0.6;user-select:none;align-self:stretch;">&#10095;</span>
        <div id="tab-bar" style="display:flex;overflow-x:auto;flex:1;"></div>
        <span id="editor-expand-btn" title="Show editor pane" style="display:none;cursor:pointer;padding:0 8px;opacity:0.6;user-select:none;align-self:stretch;">&#10094;</span>
      </div>
      <div id="tab-landing" style="display:none;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;">
        <div style="font-size:14px;color:var(--text-dim);">No session yet</div>
        <button id="new-session-btn" style="padding:8px 18px;font-size:13px;">+ New Session</button>
      </div>
      <div id="terminal" style="position:relative;"></div>
      <div id="zoom-bar" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:3px 12px;background:var(--bg-input);border-top:1px solid var(--border);font-size:11px;color:var(--text-dim);flex:0 0 auto;">
        <span id="zoom-out-btn" title="Zoom out (Ctrl -)" style="cursor:pointer;user-select:none;padding:0 4px;">&#128269;&#8722;</span>
        <input type="range" id="zoom-slider" min="8" max="32" step="1" value="13" style="width:120px;height:14px;" />
        <span id="zoom-in-btn" title="Zoom in (Ctrl +)" style="cursor:pointer;user-select:none;padding:0 4px;">&#128269;&#43;</span>
        <span id="zoom-readout" style="min-width:32px;">13px</span>
        <span id="zoom-reset-btn" title="Reset (Ctrl 0)" style="cursor:pointer;user-select:none;opacity:0.7;margin-left:4px;">Reset</span>
      </div>
    </div>
    <div class="resize-handle" id="resize-editor"></div>
    <div id="editor-pane">
      <div class="toolbar">
        <span id="editor-path">No file open</span>
        <span id="editor-status" style="opacity:0;transition:opacity 0.3s;margin-left:8px;font-size:11px;"></span>
        <span id="editor-open-btn" title="Open a local file" style="margin-left:auto;cursor:pointer;opacity:0.7;padding:0 6px;">&#128193; Open</span>
        <span id="editor-save-btn" title="Save (Ctrl+S)" style="cursor:pointer;opacity:0.7;padding:0 6px;">&#128190; Save</span>
        <span id="editor-saveas-btn" title="Save As" style="cursor:pointer;opacity:0.7;padding:0 6px;position:relative;">
          Save As&#8230;
          <div id="editor-saveas-menu" style="display:none;position:absolute;top:100%;right:0;background:var(--bg-alt);border:1px solid var(--border);min-width:140px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
            <div class="item" id="editor-saveas-local">&#128187; Local file&#8230;</div>
            <div class="item" id="editor-saveas-remote">&#127760; Remote path&#8230;</div>
          </div>
        </span>
        <span id="editor-close" style="cursor:pointer;opacity:0.5;padding:0 6px;">&#10005;</span>
      </div>
      <div id="editor"></div>
    </div>
  </div>
  <div id="session-picker-overlay">
    <div id="session-picker">
      <div class="picker-header">
        <strong>New Session</strong>
        <span class="close" id="session-picker-close">✕</span>
      </div>
      <div class="picker-grid" id="picker-grid">
        <div class="picker-item" id="picker-ssh"><span class="icon">🔑</span><span>SSH</span></div>
        <div class="picker-item" id="picker-shell"><span class="icon">&gt;_</span><span>Shell</span></div>
        <div class="picker-item" id="picker-serial"><span class="icon">🔌</span><span>Serial</span></div>
      </div>
      <div id="picker-serial-fields" style="display:none;flex-direction:column;gap:8px;padding:16px;">
        <input id="serial-port" placeholder="/dev/ttyUSB0 or COM3" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);color:var(--text);padding:5px 8px;" />
        <select id="serial-baud" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);color:var(--text);padding:5px 8px;">
          <option value="9600" selected>9600</option>
          <option value="19200">19200</option>
          <option value="38400">38400</option>
          <option value="57600">57600</option>
          <option value="115200">115200</option>
        </select>
        <button id="serial-connect" style="padding:6px;">Connect</button>
      </div>
      <div id="picker-ssh-fields" style="display:none;padding:16px;display:none;flex-direction:column;gap:8px;">
        <input id="host" placeholder="host" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);color:var(--text);padding:5px 8px;" />
        <input id="user" placeholder="user" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);color:var(--text);padding:5px 8px;" />
        <div>
          <label style="margin-right:10px;"><input type="radio" name="devicekind" value="host" checked /> VM / Host</label>
          <label style="margin-right:10px;"><input type="radio" name="devicekind" value="switch" /> Switch</label>
          <label><input type="radio" name="devicekind" value="firewall" /> Firewall</label>
        </div>
        <div>
          <label style="margin-right:10px;"><input type="radio" name="authmode" value="password" checked /> Password</label>
          <label><input type="radio" name="authmode" value="key" /> Key</label>
        </div>
        <span id="auth-password-fields">
          <input id="password" placeholder="password" type="password" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);color:var(--text);padding:5px 8px;" />
        <div id="caps-lock-warning" style="display:none;color:var(--warning);font-size:11px;">⚠ Caps Lock is on</div>
        </span>
        <span id="auth-key-fields" style="display:none;flex-direction:column;gap:8px;">
          <input id="keyPath" placeholder="key path" readonly style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);color:var(--text);padding:5px 8px;" />
          <button id="browse-key">Browse…</button>
          <input id="passphrase" placeholder="passphrase (if any)" type="password" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);color:var(--text);padding:5px 8px;" />
        </span>
        <button id="connect" style="padding:6px;">Connect</button>
      </div>
    </div>
  </div>
  <div id="statusbar">Specter</div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
SPECTER_EOF_3

cat > "frontend/src/main.ts" << 'SPECTER_EOF_4'
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import * as monaco from 'monaco-editor';
import '@xterm/xterm/css/xterm.css';
// SPE-61: bundle real font files for the 3 open-source coding fonts so
// they render identically everywhere, rather than depending on the
// host OS having them installed. Consolas/Menlo/Courier New stay
// OS-dependent, they're proprietary (Microsoft/Apple), can't be
// bundled, Windows/Mac generally have them, stock Linux generally
// doesn't.
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/cascadia-code/400.css';
import '@fontsource/cascadia-code/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/source-code-pro/400.css';
import '@fontsource/source-code-pro/700.css';
import '@fontsource/inconsolata/400.css';
import '@fontsource/inconsolata/700.css';
import '@fontsource/victor-mono/400.css';
import '@fontsource/victor-mono/700.css';
import '@fontsource/ubuntu-mono/400.css';
import '@fontsource/ubuntu-mono/700.css';
import type { RemoteFile, ConnectRequest, SessionProfile, SessionGroup, SessionClosedEvent, Settings, UpdateInfo } from '../wailsjs.d.ts';

type ThemeName = 'dark' | 'light';

const XTERM_THEMES: Record<ThemeName, Record<string, string>> = {
  dark: {
    background: '#1e1e1e', foreground: '#dddddd', cursor: '#dddddd',
    black: '#1e1e1e', red: '#e5484d', green: '#2ea043', yellow: '#d29922',
    blue: '#3178c6', magenta: '#bc7cf0', cyan: '#39c5cf', white: '#dddddd',
    brightBlack: '#666666', brightRed: '#ff6b6b', brightGreen: '#3fb950',
    brightYellow: '#e3b341', brightBlue: '#58a6ff', brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd', brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff', foreground: '#1e1e1e', cursor: '#1e1e1e',
    black: '#1e1e1e', red: '#cf3d3e', green: '#1f8a3d', yellow: '#a06800',
    blue: '#3178c6', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#e5484d', brightGreen: '#2ea043',
    brightYellow: '#d29922', brightBlue: '#4184e4', brightMagenta: '#a475f9',
    brightCyan: '#3192aa', brightWhite: '#1e1e1e',
  },
};

// SPE-61: curated terminal color-scheme presets, separate from the
// dark/light UI chrome toggle above. A full 16-color ANSI palette each,
// same shape as XTERM_THEMES. 'dark'/'light' here alias the existing UI
// themes so picking neither preserves old behavior exactly.
type ColorScheme = ThemeName | 'dracula' | 'nord' | 'solarized-dark' | 'solarized-light' | 'gruvbox-dark' | 'one-dark';

const TERMINAL_COLOR_SCHEMES: Record<ColorScheme, Record<string, string>> = {
  ...XTERM_THEMES,
  dracula: {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  nord: {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
  'solarized-dark': {
    background: '#002b36', foreground: '#839496', cursor: '#839496',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  'solarized-light': {
    background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  'gruvbox-dark': {
    background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
    blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26',
    brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b',
    brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
  },
  'one-dark': {
    background: '#282c34', foreground: '#abb2bf', cursor: '#abb2bf',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
    brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
    brightCyan: '#56b6c2', brightWhite: '#ffffff',
  },
};

// SPE-61: curated font list, not free text, so a user can't select a
// font that doesn't exist. Most of these are real bundled font files
// (imported above via @fontsource, actual .woff2s in the build output),
// guaranteed to render identically everywhere regardless of host OS.
// Menlo, Consolas, and Courier New are the exception: proprietary
// (Apple/Microsoft), can't be legally bundled, fall back to the OS's
// copy if present (Windows/Mac generally have them, stock Linux
// generally doesn't, so those 3 may look unchanged on Linux).
const FONT_OPTIONS: { value: string; stack: string }[] = [
  { value: 'menlo', stack: 'Menlo, Consolas, monospace' },
  { value: 'consolas', stack: 'Consolas, Menlo, monospace' },
  { value: 'cascadia', stack: '"Cascadia Code", Consolas, monospace' },
  { value: 'fira', stack: '"Fira Code", Consolas, monospace' },
  { value: 'jetbrains', stack: '"JetBrains Mono", Consolas, monospace' },
  { value: 'courier', stack: '"Courier New", Courier, monospace' },
  { value: 'ibmplex', stack: '"IBM Plex Mono", Consolas, monospace' },
  { value: 'sourcecodepro', stack: '"Source Code Pro", Consolas, monospace' },
  { value: 'inconsolata', stack: 'Inconsolata, Consolas, monospace' },
  { value: 'victor', stack: '"Victor Mono", Consolas, monospace' },
  { value: 'ubuntumono', stack: '"Ubuntu Mono", Consolas, monospace' },
];

function fontStack(fontId: string): string {
  return FONT_OPTIONS.find((f) => f.value === fontId)?.stack ?? FONT_OPTIONS[0].stack;
}

const MONACO_THEMES: Record<ThemeName, string> = {
  dark: 'vs-dark',
  light: 'vs',
};

// In-memory copy of backend-persisted settings.json (SPE-61), loaded
// once at startup via App.GetSettings(). Deliberately not localStorage,
// matches the file-on-disk decision made for the wallpaper image itself.
let appSettings: Settings = {};

function currentColorScheme(): ColorScheme {
  const s = appSettings.colorScheme;
  if (s && s in TERMINAL_COLOR_SCHEMES) return s as ColorScheme;
  return currentTheme();
}

function wallpaperActive(): boolean {
  return !!appSettings.wallpaperPath;
}

// The palette actually applied to xterm: the chosen preset, with its
// background swapped for transparent whenever a wallpaper is active, so
// xterm's own canvas rendering (which paints an opaque per-cell
// background from this value) doesn't paint over the wallpaper image
// sitting on the viewport underneath it. Text keeps the palette's
// normal foreground/ANSI colors.
function activeXtermTheme(): Record<string, string> {
  const base = TERMINAL_COLOR_SCHEMES[currentColorScheme()];
  if (!wallpaperActive()) return base;
  return { ...base, background: 'transparent' };
}

function refreshAllTerminalThemes() {
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.theme = activeXtermTheme();
  }
}

// SPE-77: zoom drives the same persisted appSettings.fontSize shown in
// Settings, not a separate temporary zoom layer, confirmed choice.
// Applies to every live tab (font size is global, not per-tab, same
// reasoning as refreshAllTerminalThemes above), refitting and notifying
// the backend of the new terminal size for each, mirroring what
// refitActiveTerminal does for a single tab.
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_DEFAULT = 13;

function applyFontSize(size: number) {
  const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
  appSettings.fontSize = clamped;
  for (const tab of tabs.values()) {
    if (!tab.term || !tab.fitAddon) continue;
    tab.term.options.fontSize = clamped;
    tab.fitAddon.fit();
    if (tab.mode === 'local' && tab.backendId) App.ResizeLocalTerminal(tab.backendId, tab.term.cols, tab.term.rows);
    if (tab.mode === 'ssh' && tab.backendId) App.ResizeSSH(tab.backendId, tab.term.cols, tab.term.rows);
  }
  // SPE-78: editor shares the same font size setting as the terminal,
  // confirmed choice, not an independent editor-specific size.
  editor.updateOptions({ fontSize: clamped });
  const slider = document.getElementById('zoom-slider') as HTMLInputElement;
  slider.value = String(clamped);
  document.getElementById('zoom-readout')!.textContent = `${clamped}px`;
  App.SaveSettings(appSettings);
}

function zoomBy(delta: number) {
  applyFontSize((appSettings.fontSize || FONT_SIZE_DEFAULT) + delta);
}

function applyColorScheme(name: ColorScheme) {
  appSettings.colorScheme = name;
  App.SaveSettings(appSettings);
  refreshAllTerminalThemes();
}

function applyFont(fontId: string) {
  appSettings.fontFamily = fontId;
  App.SaveSettings(appSettings);
  const stack = fontStack(fontId);
  // SPE-61 originally only touched the terminal itself; the picker
  // should also cover the rest of the app chrome (sidebar, menus, tab
  // bar), otherwise the terminal font visibly doesn't match everything
  // around it.
  document.body.style.fontFamily = stack;
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontFamily = stack;
  }
  refitActiveTerminal();
}

// Renders the wallpaper as each terminal's own .xterm-viewport
// background-image (a dark tint layered via linear-gradient in the same
// background-image stack, alongside the actual photo) rather than a
// separate absolutely-positioned div with a transparent viewport
// underneath. The old approach required making .xterm-viewport's own
// background-color fully transparent, which turned out to break its
// native scrollbar entirely (mouse wheel AND direct thumb-drag both
// stopped working, confirmed via testing on real hardware): a real
// WebKit-family rendering quirk with transparent scrollable containers,
// unrelated to the wallpaper image itself. This sidesteps it completely:
// background-image always paints above background-color in CSS, so
// xterm's own background-color never needs to be touched at all. As a
// side effect, this also eliminates the earlier "wallpaper bleeds
// through the landing screen" bug, there's no longer a floating div
// that could leak, only per-tab viewports that only exist once a real
// terminal is actually created.
function wallpaperBackgroundImage(): string {
  if (!appSettings.wallpaperDataUrl) return '';
  const opacity = appSettings.wallpaperOpacity ?? 0.15;
  const dim = 1 - opacity;
  return `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${appSettings.wallpaperDataUrl}")`;
}

function applyWallpaperToTab(tab: Tab) {
  if (!tab.term?.element) return;
  const viewport = tab.term.element.querySelector('.xterm-viewport') as HTMLElement | null;
  if (!viewport) return;
  const bg = wallpaperBackgroundImage();
  if (bg) {
    viewport.style.backgroundImage = bg;
    viewport.style.backgroundSize = 'cover';
    viewport.style.backgroundPosition = 'center';
  } else {
    viewport.style.backgroundImage = '';
  }
}

function applyWallpaperVisual() {
  for (const tab of tabs.values()) applyWallpaperToTab(tab);
  document.getElementById('wallpaper-opacity-row')!.style.display = appSettings.wallpaperPath ? 'flex' : 'none';
  document.getElementById('wallpaper-clear-row')!.style.display = appSettings.wallpaperPath ? 'flex' : 'none';
  refreshAllTerminalThemes();
}

async function setWallpaper(path: string) {
  appSettings.wallpaperPath = path;
  appSettings.wallpaperDataUrl = await App.ReadImageFile(path);
  if (!appSettings.wallpaperOpacity) appSettings.wallpaperOpacity = 0.15;
  await App.SaveSettings(appSettings);
  applyWallpaperVisual();
}

async function clearWallpaper() {
  appSettings.wallpaperPath = '';
  appSettings.wallpaperDataUrl = undefined;
  await App.SaveSettings(appSettings);
  applyWallpaperVisual();
}

async function loadSettingsAndApply() {
  appSettings = await App.GetSettings();
  if (appSettings.wallpaperPath) {
    try {
      appSettings.wallpaperDataUrl = await App.ReadImageFile(appSettings.wallpaperPath);
    } catch {
      // Wallpaper file moved/deleted since last launch, fall back to no
      // wallpaper rather than a broken image or a thrown error at startup.
      appSettings.wallpaperPath = '';
    }
  }
  const colorSelect = document.getElementById('colorscheme-select') as HTMLSelectElement;
  colorSelect.value = appSettings.colorScheme || currentTheme();
  const fontSelectEl = document.getElementById('font-select') as HTMLSelectElement;
  fontSelectEl.value = appSettings.fontFamily || FONT_OPTIONS[0].value;
  const opacitySlider = document.getElementById('wallpaper-opacity') as HTMLInputElement;
  opacitySlider.value = String(Math.round((appSettings.wallpaperOpacity ?? 0.15) * 100));
  applyWallpaperVisual();

  const keepaliveToggle = document.getElementById('ssh-keepalive-toggle') as HTMLInputElement;
  keepaliveToggle.checked = !appSettings.sshKeepaliveDisabled;

  const slider = document.getElementById('zoom-slider') as HTMLInputElement;
  const initialSize = appSettings.fontSize || FONT_SIZE_DEFAULT;
  slider.value = String(initialSize);
  document.getElementById('zoom-readout')!.textContent = `${initialSize}px`;

  // In case a tab was created before this async load resolved (race:
  // GetSettings is an IPC round-trip), reapply font to whatever's live.
  // refreshAllTerminalThemes (called by applyWallpaperVisual above)
  // already handles color.
  const stack = fontStack(appSettings.fontFamily || FONT_OPTIONS[0].value);
  document.body.style.fontFamily = stack;
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontFamily = stack;
  }
  // Same race-condition reasoning for font SIZE: the editor was created
  // synchronously at module load, before this async settings load
  // resolved, and terminal tabs may exist too if one connected fast.
  const savedFontSize = appSettings.fontSize || FONT_SIZE_DEFAULT;
  editor.updateOptions({ fontSize: savedFontSize });
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontSize = savedFontSize;
  }
}

function applyTheme(name: ThemeName) {
  document.documentElement.setAttribute('data-theme', name);
  localStorage.setItem('specter-theme', name);

  // Only follow the UI theme toggle for terminal ANSI colors when the
  // user hasn't explicitly picked a color-scheme preset (SPE-61);
  // once they have, dark/light and terminal colors are independent.
  if (!appSettings.colorScheme || appSettings.colorScheme === 'dark' || appSettings.colorScheme === 'light') {
    appSettings.colorScheme = name;
  }
  refreshAllTerminalThemes();

  if (typeof monaco !== 'undefined' && editor) {
    monaco.editor.setTheme(MONACO_THEMES[name]);
  }
}

function refitActiveTerminal() {
  // CSS class toggles (sidebar/editor collapse) don't fire a browser
  // resize event, so xterm.js never re-measures its container on its
  // own. Force it after any layout change that affects terminal width.
  requestAnimationFrame(() => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab?.fitAddon || !tab.term) return;
    tab.fitAddon.fit();
    if (tab.mode === 'local' && tab.backendId) App.ResizeLocalTerminal(tab.backendId, tab.term.cols, tab.term.rows);
    if (tab.mode === 'ssh' && tab.backendId) App.ResizeSSH(tab.backendId, tab.term.cols, tab.term.rows);
  });
}

function currentTheme(): ThemeName {
  const saved = localStorage.getItem('specter-theme');
  return saved === 'light' ? 'light' : 'dark';
}


const App = window.go.main.App;
const runtime = window.runtime;

// --- Tab model ---
// Each tab owns its own xterm.js Terminal + backend session (SSH session ID
// or local terminal ID). 'pending' tabs show the connect form instead of a
// live terminal, until Connect/StartLocalTerminal resolves them.

type TabMode = 'pending' | 'local' | 'ssh' | 'serial';
type TabStatus = 'connecting' | 'connected' | 'disconnected';

interface Tab {
  id: string;
  mode: TabMode;
  backendId: string | null; // sessionId (ssh) or local terminal id
  label: string;
  status: TabStatus;
  term: Terminal | null;
  fitAddon: FitAddon | null;
  container: HTMLDivElement | null;
  // SPE-59: true while showing the "session stopped" panel after an
  // unexpected disconnect. Gates keyboard input away from the dead PTY
  // and routes R/S/Enter to the panel's actions instead.
  stopped: boolean;
  overlay: HTMLDivElement | null;
  // Set once a session connects; re-runs the same connect call to
  // power the panel's "R to restart session" action. null for local
  // shell tabs (out of scope for SPE-59, see ticket).
  reconnect: (() => void | Promise<void>) | null;
}

const tabs = new Map<string, Tab>();
let activeTabId: string | null = null;
let tabCounter = 0;

function newTabId(): string {
  tabCounter += 1;
  return `tab-${tabCounter}`;
}

function createPendingTab(): Tab {
  const tab: Tab = {
    id: newTabId(),
    mode: 'pending',
    backendId: null,
    label: 'New Tab',
    status: 'disconnected',
    term: null,
    fitAddon: null,
    container: null,
    stopped: false,
    overlay: null,
    reconnect: null,
  };
  tabs.set(tab.id, tab);
  return tab;
}

// SPE-97: opt-in (defaults off), a numbered badge is a minor visual
// addition, not a safety/correctness feature, so it follows the
// opt-in convention rather than the default-on one.
let showTabNumbersEnabled = localStorage.getItem('specter-show-tab-numbers') === 'on';

function renderTabBar() {
  const bar = document.getElementById('tab-bar')!;
  bar.innerHTML = '';
  let tabIndex = 0;
  for (const tab of tabs.values()) {
    tabIndex++;
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.onclick = () => switchToTab(tab.id);

    if (showTabNumbersEnabled) {
      const num = document.createElement('span');
      num.textContent = String(tabIndex);
      num.style.cssText = 'opacity:0.5;font-size:10px;margin-right:5px;';
      el.appendChild(num);
    }

    const dot = document.createElement('span');
    dot.className = 'status-dot ' + tab.status;
    el.appendChild(dot);

    const label = document.createElement('span');
    label.textContent = (tab.mode === 'local' ? '💻 ' : tab.mode === 'ssh' ? '🌐 ' : tab.mode === 'serial' ? '🔌 ' : '') + tab.label;
    el.appendChild(label);

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
    el.appendChild(close);

    bar.appendChild(el);
  }

  const addBtn = document.createElement('div');
  addBtn.className = 'tab-add';
  addBtn.textContent = '+';
  addBtn.onclick = () => {
    const tab = createPendingTab();
    switchToTab(tab.id);
  };
  bar.appendChild(addBtn);
}

function switchToTab(id: string) {
  activeTabId = id;
  const tab = tabs.get(id)!;

  // Hide all terminal containers, show only the active one (or the connect
  // form if this tab hasn't connected yet).
  document.querySelectorAll('.term-instance').forEach((el) => {
    (el as HTMLElement).style.display = 'none';
  });
  document.getElementById('tab-landing')!.style.display = tab.mode === 'pending' ? 'flex' : 'none';

  if (tab.container) {
    tab.container.style.display = 'block';
    tab.fitAddon?.fit();
    if (tab.mode === 'ssh' && tab.backendId) App.ResizeSSH(tab.backendId, tab.term!.cols, tab.term!.rows);
    if (tab.mode === 'local' && tab.backendId) App.ResizeLocalTerminal(tab.backendId, tab.term!.cols, tab.term!.rows);
  }

  if (tab.mode === 'ssh' && tab.backendId) {
    refreshFileList('.', tab.backendId);
  }

  renderTabBar();
}

async function closeTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) return;

  // SPE-81: only prompt for a genuinely live session, not the disconnect
  // panel's own "exit tab" action (tab.stopped is already true there,
  // there's nothing live left to lose), and not a pending/never-connected
  // tab, matching the ticket's own scope note.
  if (tab.status === 'connected' && !tab.stopped) {
    const proceed = confirm(`Close this tab? The session is still connected (${tab.label}).`);
    if (!proceed) return;
  }

  if (tab.mode === 'ssh' && tab.backendId) {
    await App.CloseSSH(tab.backendId);
    runtime.EventsOff('ssh:data:' + tab.backendId, 'ssh:closed:' + tab.backendId);
  }
  if (tab.mode === 'local' && tab.backendId) await App.CloseLocalTerminal(tab.backendId);
  if (tab.mode === 'serial' && tab.backendId) {
    await App.CloseSerial(tab.backendId);
    runtime.EventsOff('serial:data:' + tab.backendId, 'serial:closed:' + tab.backendId);
  }
  tab.overlay?.remove();
  tab.term?.dispose();
  tab.container?.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchToTab(remaining[remaining.length - 1]);
    } else {
      const fresh = createPendingTab();
      switchToTab(fresh.id);
    }
  } else {
    renderTabBar();
  }
}

// Custom-drawn scrollbar (see the CSS comment above the .xterm-viewport
// rules for why this exists): the native scrollbar is hidden entirely,
// this is pure page content instead, so it looks and behaves
// identically across Linux/Windows/macOS regardless of what each
// platform's webview engine does or doesn't expose for native scrollbar
// styling.
function setupCustomScrollbar(tab: Tab) {
  if (!tab.term || !tab.container) return;
  const term = tab.term;

  const track = document.createElement('div');
  track.className = 'custom-scrollbar-track';
  const thumb = document.createElement('div');
  thumb.className = 'custom-scrollbar-thumb';
  track.appendChild(thumb);
  tab.container.appendChild(track);

  function update() {
    const buffer = term.buffer.active;
    const totalLines = buffer.length;
    const rows = term.rows;
    if (totalLines <= rows) {
      track.style.display = 'none';
      return;
    }
    track.style.display = 'block';
    const trackHeight = track.clientHeight;
    const thumbHeightPct = Math.max(rows / totalLines, 0.03);
    const scrollableRange = buffer.baseY;
    const scrollPct = scrollableRange > 0 ? buffer.viewportY / scrollableRange : 0;
    thumb.style.height = `${Math.max(thumbHeightPct * trackHeight, 20)}px`;
    const thumbHeightPx = thumb.getBoundingClientRect().height || thumbHeightPct * trackHeight;
    thumb.style.top = `${scrollPct * (trackHeight - thumbHeightPx)}px`;
  }

  term.onScroll(update);
  term.onResize(update);
  // New output can extend the scrollable range without necessarily
  // firing onScroll (e.g. output arriving while already at the
  // bottom), refresh after every write too.
  term.onWriteParsed(update);
  // Redundant safety net: xterm.js's own onScroll event apparently
  // doesn't fire reliably for touchpad-driven scroll on Windows/WebView2
  // (confirmed by testing, content scrolled correctly but the thumb
  // never moved), even though mouse wheel and thumb-drag both worked.
  // Listening directly to .xterm-viewport's real DOM scroll event should
  // catch it regardless of what triggered the scroll, wheel, touchpad,
  // keyboard, programmatic, since it's the browser's own native event,
  // not xterm's internal one.
  const viewport = term.element?.querySelector('.xterm-viewport');
  viewport?.addEventListener('scroll', update);

  let dragging = false;
  let dragStartY = 0;
  let dragStartScrollLine = 0;

  thumb.addEventListener('mousedown', (e) => {
    dragging = true;
    thumb.classList.add('dragging');
    dragStartY = e.clientY;
    dragStartScrollLine = term.buffer.active.viewportY;
    e.preventDefault();
  });
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const buffer = term.buffer.active;
    const scrollableRange = buffer.baseY;
    if (scrollableRange <= 0) return;
    const trackHeight = track.clientHeight;
    const thumbHeightPx = thumb.getBoundingClientRect().height;
    const usableTrack = Math.max(trackHeight - thumbHeightPx, 1);
    const deltaY = e.clientY - dragStartY;
    const deltaLines = (deltaY / usableTrack) * scrollableRange;
    const newLine = Math.round(dragStartScrollLine + deltaLines);
    term.scrollToLine(Math.min(scrollableRange, Math.max(0, newLine)));
  };
  const onMouseUp = () => {
    dragging = false;
    thumb.classList.remove('dragging');
  };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Click on the track itself (not the thumb) jumps to that position,
  // standard scrollbar behavior.
  track.addEventListener('mousedown', (e) => {
    if (e.target !== track) return;
    const buffer = term.buffer.active;
    const scrollableRange = buffer.baseY;
    if (scrollableRange <= 0) return;
    const rect = track.getBoundingClientRect();
    const clickPct = (e.clientY - rect.top) / rect.height;
    term.scrollToLine(Math.round(clickPct * scrollableRange));
  });

  update();
}

// SPE-80: warn before sending clipboard content containing multiple
// lines, since each line can execute as a separate command once it
// reaches a remote shell, a real safety net especially on network
// hardware where a pasted multi-line block could silently apply
// several config commands in sequence. Toggleable, matching the
// checkbox precedent this was modeled on; not everyone wants a prompt
// on every multi-line paste.
let warnMultilinePasteEnabled = localStorage.getItem('specter-warn-multiline-paste') !== 'off';

function writeToTabWithPasteGuard(tab: Tab, text: string) {
  if (warnMultilinePasteEnabled) {
    const lines = text.split(/\r\n|\r|\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
    if (lines.length > 1) {
      const proceed = confirm(`You're about to paste ${lines.length} lines. Each line may run as a separate command on the remote end. Continue?`);
      if (!proceed) return;
    }
  }
  if (tab.mode === 'local' && tab.backendId) App.WriteLocalTerminal(tab.backendId, text);
  if (tab.mode === 'ssh' && tab.backendId) App.WriteSSH(tab.backendId, text);
  if (tab.mode === 'serial' && tab.backendId) App.WriteSerial(tab.backendId, text);
}

function createTerminalForTab(tab: Tab) {
  const container = document.createElement('div');
  container.className = 'term-instance';
  container.style.cssText = 'height:100%;padding:4px;box-sizing:border-box;position:relative;';
  document.getElementById('terminal')!.appendChild(container);

  const term = new Terminal({
    fontFamily: fontStack(appSettings.fontFamily || FONT_OPTIONS[0].value),
    fontSize: appSettings.fontSize || FONT_SIZE_DEFAULT,
    theme: activeXtermTheme(),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  // OSC 52: let remote programs (xclip, pbcopy, tmux, vim, etc.) sync
  // their copy into the local OS clipboard, gated by osc52Enabled since
  // this lets a remote process silently write to the local clipboard.
  term.parser.registerOscHandler(52, (data: string) => {
    if (!osc52Enabled) return true;
    const parts = data.split(';');
    if (parts.length < 2) return true;
    try {
      const text = atob(parts[1]);
      navigator.clipboard.writeText(text).catch(() => {});
    } catch {
      // ignore malformed OSC 52 payloads
    }
    return true;
  });

  // Auto-copy on selection (classic X11/xterm/PuTTY-style behavior),
  // gated by copyOnSelectEnabled toggle since not everyone wants this.
  term.onSelectionChange(() => {
    if (!copyOnSelectEnabled) return;
    const sel = term.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(() => {});
  });

  // Explicit paste keybind (Ctrl+Shift+V / Cmd+Shift+V), separate from
  // native browser paste, as a reliable fallback across platforms/webviews.
  // Ctrl+Shift+X disconnects the active session (see disconnectTab):
  // deliberately NOT plain Ctrl+C, since that's the real SIGINT keystroke
  // needed constantly on a live switch session, and NOT plain Ctrl+X
  // either, since bash/readline and Emacs both use that as a prefix key.
  // Also handles the SPE-59 disconnected-session panel: while a session is
  // stopped, R/S/Enter drive the panel's actions and everything else is
  // swallowed rather than typed into a dead PTY.
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (tab.stopped) {
      if (e.type === 'keydown') {
        const key = e.key.toLowerCase();
        if (key === 'enter') closeTab(tab.id);
        else if (key === 'r') reconnectTab(tab);
        else if (key === 's') saveTabOutput(tab);
      }
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      disconnectTab(tab);
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      // Not plain Ctrl+B: that's tmux's default prefix key, binding it
      // globally would break every tmux user's workflow the moment
      // they're inside a session.
      toggleSidebar();
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      navigator.clipboard.readText().then((text) => writeToTabWithPasteGuard(tab, text)).catch(() => {});
      return false;
    }
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      // SPE-77. Accepts both '=' and '+' since Plus is Shift+Equals on
      // most layouts, matching how browsers handle Ctrl+= zoom too.
      zoomBy(1);
      return false;
    }
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key === '-') {
      zoomBy(-1);
      return false;
    }
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key === '0') {
      applyFontSize(FONT_SIZE_DEFAULT);
      return false;
    }
    if (e.type === 'keydown' && e.key === 'F11') {
      toggleFullscreen();
      return false;
    }
    return true;
  });

  // Right-click to paste (toggleable), matching PuTTY/most Linux terminal convention.
  container.addEventListener('contextmenu', (e) => {
    if (!rightClickPasteEnabled) return;
    e.preventDefault();
    App.GetClipboardText().then((text) => writeToTabWithPasteGuard(tab, text)).catch(() => {});
  });

  // Native browser paste (Ctrl+V, middle-click on Linux, right-click ->
  // Paste in some contexts, etc.), xterm.js listens for this itself and
  // would otherwise feed it straight through to onData below with no
  // multi-line awareness at all. Intercepted here instead, at capture
  // phase so it runs before xterm's own listener, so it goes through
  // the same guard as the other two paste paths above.
  container.addEventListener('paste', (e) => {
    if (!e.clipboardData) return; // let default handling proceed if unavailable
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData('text');
    if (text) writeToTabWithPasteGuard(tab, text);
  }, true);

  term.onData((data) => {
    if (tab.mode === 'local' && tab.backendId) App.WriteLocalTerminal(tab.backendId, data);
    if (tab.mode === 'ssh' && tab.backendId) App.WriteSSH(tab.backendId, data);
    if (tab.mode === 'serial' && tab.backendId) App.WriteSerial(tab.backendId, data);
  });

  tab.term = term;
  tab.fitAddon = fitAddon;
  tab.container = container;
  applyWallpaperToTab(tab);
  setupCustomScrollbar(tab);
}

let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab || !tab.fitAddon || !tab.term) return;
    tab.fitAddon.fit();
    if (tab.mode === 'local' && tab.backendId) App.ResizeLocalTerminal(tab.backendId, tab.term.cols, tab.term.rows);
    if (tab.mode === 'ssh' && tab.backendId) App.ResizeSSH(tab.backendId, tab.term.cols, tab.term.rows);
  }, 100);
});

// --- Editor setup (shared across all tabs, VS Code-style) ---

const editor = monaco.editor.create(document.getElementById('editor')!, {
  value: '',
  language: 'plaintext',
  theme: MONACO_THEMES[currentTheme()],
  automaticLayout: true,
  // SPE-78: shares appSettings.fontSize with the terminal (confirmed
  // choice), appSettings isn't populated yet at this point in module
  // load order (loadSettingsAndApply is async), loadSettingsAndApply
  // re-applies the real value once it resolves, same race-condition
  // pattern already used for the terminal's own font-family sync.
  fontSize: appSettings.fontSize || FONT_SIZE_DEFAULT,
});

function toggleEditorPane() {
  const app = document.getElementById('app')!;
  app.style.gridTemplateColumns = '';
  currentColumnTemplate = ['220px', '5px', '1fr', '5px', '1fr'];
  const collapsed = app.classList.toggle('editor-collapsed');
  document.getElementById('editor-expand-btn')!.style.display = collapsed ? 'flex' : 'none';
  refitActiveTerminal();
}

document.getElementById('editor-close')!.addEventListener('click', toggleEditorPane);
document.getElementById('editor-expand-btn')!.addEventListener('click', toggleEditorPane);

document.getElementById('menu-toggle-editor')!.addEventListener('click', () => {
  closeAllMenus();
  toggleEditorPane();
});


let openFilePath: string | null = null;
let openFileSessionId: string | null = null;
// SPE-78: local file support alongside the existing remote (SSH) editing.
// openFileSessionId stays null for both "nothing open" and "a local file
// is open", this flag is what actually distinguishes the two.
let openFileIsLocal = false;

let editorStatusTimer: ReturnType<typeof setTimeout> | null = null;
function flashEditorStatus(msg: string, isError = false) {
  const el = document.getElementById('editor-status')!;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
  el.style.opacity = '1';
  if (editorStatusTimer) clearTimeout(editorStatusTimer);
  editorStatusTimer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

// Shared tail end of opening a file, whether local or remote:
// language detection, showing/expanding the pane, loading content.
function finishOpeningFile(path: string, content: string) {
  document.getElementById('editor-path')!.textContent = path;
  document.getElementById('editor-close')!.style.display = 'inline';
  // The editor pane defaults to collapsed (nothing to show until a
  // file's actually open), opening one needs to explicitly restore it,
  // otherwise the content loads into Monaco invisibly behind a hidden
  // pane.
  document.getElementById('app')!.classList.remove('editor-collapsed');
  document.getElementById('editor-expand-btn')!.style.display = 'none';
  refitActiveTerminal();
  const ext = path.split('.').pop() ?? '';
  const langMap: Record<string, string> = {
    go: 'go', hs: 'haskell', js: 'javascript', ts: 'typescript', json: 'json', md: 'markdown',
  };
  monaco.editor.setModelLanguage(editor.getModel()!, langMap[ext] ?? 'plaintext');
  editor.setValue(content);
}

async function openRemoteFile(sessionId: string, path: string) {
  const content = await App.ReadRemoteFile(sessionId, path);
  openFilePath = path;
  openFileSessionId = sessionId;
  openFileIsLocal = false;
  finishOpeningFile(path, content);
}

async function openLocalFile() {
  const path = await App.SelectAnyFile();
  if (!path) return; // cancelled
  const content = await App.ReadLocalFile(path);
  openFilePath = path;
  openFileSessionId = null;
  openFileIsLocal = true;
  finishOpeningFile(path, content);
}

async function saveCurrentFile() {
  if (!openFilePath) {
    // Nothing open yet (Untitled), Save behaves like Save As rather
    // than silently doing nothing, matching most editors' convention.
    return saveAsLocal();
  }
  try {
    if (openFileIsLocal) {
      await App.WriteLocalFile(openFilePath, editor.getValue());
    } else if (openFileSessionId) {
      await App.WriteRemoteFile(openFileSessionId, openFilePath, editor.getValue());
    }
    flashEditorStatus('Saved');
  } catch (err) {
    flashEditorStatus(`Save failed: ${err}`, true);
  }
}

async function saveAsLocal() {
  const defaultName = openFilePath ? openFilePath.split(/[\\/]/).pop()! : 'Untitled.txt';
  const path = await App.SaveTextFile(defaultName, editor.getValue());
  if (!path) return; // cancelled
  openFilePath = path;
  openFileSessionId = null;
  openFileIsLocal = true;
  document.getElementById('editor-path')!.textContent = path;
  document.getElementById('editor-close')!.style.display = 'inline';
  flashEditorStatus('Saved');
}

async function saveAsRemote() {
  const sessionId = openFileSessionId ?? (activeTabId ? tabs.get(activeTabId)?.backendId : null);
  if (!sessionId) {
    alert('No active SSH session to save to. Open or switch to an SSH tab first.');
    return;
  }
  const defaultPath = openFilePath && !openFileIsLocal
    ? openFilePath
    : (currentRemotePath === '.' ? 'untitled.txt' : `${currentRemotePath}/untitled.txt`);
  const newPath = prompt('Save to remote path:', defaultPath);
  if (!newPath) return; // cancelled
  try {
    await App.WriteRemoteFile(sessionId, newPath, editor.getValue());
    openFilePath = newPath;
    openFileSessionId = sessionId;
    openFileIsLocal = false;
    document.getElementById('editor-path')!.textContent = newPath;
    document.getElementById('editor-close')!.style.display = 'inline';
    flashEditorStatus('Saved');
  } catch (err) {
    flashEditorStatus(`Save failed: ${err}`, true);
  }
}

document.getElementById('editor-open-btn')!.addEventListener('click', () => { openLocalFile(); });
document.getElementById('editor-save-btn')!.addEventListener('click', () => { saveCurrentFile(); });

const saveAsMenu = document.getElementById('editor-saveas-menu')!;
document.getElementById('editor-saveas-btn')!.addEventListener('click', (e) => {
  e.stopPropagation();
  saveAsMenu.style.display = saveAsMenu.style.display === 'block' ? 'none' : 'block';
});
document.getElementById('editor-saveas-local')!.addEventListener('click', () => {
  saveAsMenu.style.display = 'none';
  saveAsLocal();
});
document.getElementById('editor-saveas-remote')!.addEventListener('click', () => {
  saveAsMenu.style.display = 'none';
  saveAsRemote();
});
document.addEventListener('click', () => { saveAsMenu.style.display = 'none'; });

editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { saveCurrentFile(); });

// --- File browser (scoped to whichever SSH tab is active) ---

let currentRemotePath = '.';
let currentRemoteSessionId: string | null = null;

// Computes the parent of a path built by ListDir's path.Join convention
// (plain relative strings, e.g. "logs", then "logs/subfolder", no
// leading "/" or "./"). Confirmed against the actual Go backend rather
// than assumed, this is exactly the kind of thing that's cheap to get
// wrong by guessing (see tonight's NSIS filename mismatch).
function parentPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '.' : path.slice(0, idx);
}

async function refreshFileList(path = '.', sessionId?: string) {
  const id = sessionId ?? (activeTabId ? tabs.get(activeTabId)?.backendId : null);
  if (!id) return;
  currentRemotePath = path;
  currentRemoteSessionId = id;
  const entries: RemoteFile[] = await App.ListRemoteDir(id, path);
  const list = document.getElementById('file-list')!;
  list.innerHTML = '';
  if (path !== '.') {
    const up = document.createElement('div');
    up.className = 'entry';
    up.textContent = '\ud83d\udcc1 ..';
    up.style.opacity = '0.8';
    up.onclick = () => refreshFileList(parentPath(path), id);
    list.appendChild(up);
  }
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.textContent = (e.isDir ? '\ud83d\udcc1 ' : '\ud83d\udcc4 ') + e.name;
    div.onclick = () => (e.isDir ? refreshFileList(e.path, id) : openRemoteFile(id, e.path));
    list.appendChild(div);
  }
}

async function uploadFilesToCurrentDir(files: FileList) {
  if (!currentRemoteSessionId) return;
  const list = document.getElementById('file-list')!;
  const status = document.createElement('div');
  status.className = 'entry';
  status.style.opacity = '0.7';
  status.style.fontStyle = 'italic';
  list.appendChild(status);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status.textContent = `Uploading ${file.name}...`;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
    const base64 = btoa(binary);
    const remotePath = currentRemotePath === '.' ? file.name : `${currentRemotePath}/${file.name}`;
    try {
      await App.UploadRemoteFile(currentRemoteSessionId, remotePath, base64);
    } catch (err) {
      console.error('Upload failed for', file.name, err);
    }
  }

  refreshFileList(currentRemotePath, currentRemoteSessionId);
}

(() => {
  const fileList = document.getElementById('file-list')!;
  fileList.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    fileList.style.background = 'var(--hover)';
  });
  fileList.addEventListener('dragleave', () => {
    fileList.style.background = '';
  });
  fileList.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    fileList.style.background = '';
    uploadFilesToCurrentDir(e.dataTransfer.files);
  });
})();

// --- Saved sessions ---

function setAuthMode(mode: 'password' | 'key') {
  const radio = document.querySelector(`input[name="authmode"][value="${mode}"]`) as HTMLInputElement;
  radio.checked = true;
  const isKey = mode === 'key';
  document.getElementById('auth-password-fields')!.style.display = isKey ? 'none' : 'inline';
  document.getElementById('auth-key-fields')!.style.display = isKey ? 'inline' : 'none';
}

function setDeviceKind(kind: 'host' | 'switch' | 'firewall') {
  const radio = document.querySelector(`input[name="devicekind"][value="${kind}"]`) as HTMLInputElement;
  radio.checked = true;
}

function currentDeviceKind(): 'host' | 'switch' | 'firewall' {
  const checked = document.querySelector('input[name="devicekind"]:checked') as HTMLInputElement | null;
  if (checked?.value === 'switch') return 'switch';
  if (checked?.value === 'firewall') return 'firewall';
  return 'host';
}

let skipSavePrompt = false;
let skipSerialSavePrompt = false;
let pendingSessionName: string | null = null;

// In-memory only, never persisted to disk, cleared on app restart.

// Distinct from the deliberate "never save passwords to disk" design

// principle in backend/config/sessions.go, this just avoids re-prompting

// within a single running session.

const passwordCache = new Map<string, string>();

function passwordCacheKey(host: string, port: number, user: string): string {

  return `${user}@${host}:${port}`;

}

async function useSession(s: SessionProfile) {
  if (s.type === 'serial') {
    await useSerialSession(s);
    return;
  }
  await useSSHSession(s);
}

async function useSSHSession(s: SessionProfile) {

  await App.SaveSession({ ...s, lastUsed: new Date().toISOString() });

  ensurePendingTab();

  (document.getElementById('host') as HTMLInputElement).value = s.host ?? '';

  (document.getElementById('user') as HTMLInputElement).value = s.user ?? '';

  setDeviceKind(s.deviceKind === 'switch' ? 'switch' : s.deviceKind === 'firewall' ? 'firewall' : 'host');



  skipSavePrompt = true;



  if (s.keyPath) {

    setAuthMode('key');

    (document.getElementById('keyPath') as HTMLInputElement).value = s.keyPath;

    (document.getElementById('passphrase') as HTMLInputElement).value = '';

    await connectActiveTab({ host: s.host ?? '', port: s.port ?? 22, user: s.user ?? '', keyPath: s.keyPath });

    const tab = tabs.get(activeTabId!);

    if (tab) {

      tab.label = s.name;

      renderTabBar();

    }

  } else {

    setAuthMode('password');

    const cacheKey = passwordCacheKey(s.host ?? '', s.port ?? 22, s.user ?? '');

    const cachedPassword = passwordCache.get(cacheKey);

    if (cachedPassword) {

      await connectActiveTab({ host: s.host ?? '', port: s.port ?? 22, user: s.user ?? '', password: cachedPassword });

      const tab = tabs.get(activeTabId!);

      if (tab) {

        tab.label = s.name;

        renderTabBar();

      }

    } else {

      pendingSessionName = s.name;

      openSessionPicker();

      document.getElementById('picker-grid')!.style.display = 'none';

      document.getElementById('picker-ssh-fields')!.style.display = 'flex';

      const pwField = document.getElementById('password') as HTMLInputElement;

      pwField.value = '';

      pwField.focus();

    }

  }

}

async function useSerialSession(s: SessionProfile) {
  await App.SaveSession({ ...s, lastUsed: new Date().toISOString() });
  ensurePendingTab();
  skipSerialSavePrompt = true;
  await connectSerialInActiveTab(s.serialPort ?? '', s.baud ?? 9600);
}

function renderSessionRow(s: SessionProfile): HTMLElement {
  const row = document.createElement('div');
  row.className = 'session-entry';
  row.style.paddingLeft = '18px';
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/specter-session-id', s.id);
  });

  const label = document.createElement('span');
  const icon = s.type === 'serial' ? '\ud83d\udd0c '
    : s.deviceKind === 'switch' ? '\ud83d\udd00 '
    : s.deviceKind === 'firewall' ? '\ud83d\udee1\ufe0f '
    : '\ud83d\udda5\ufe0f ';
  label.textContent = icon + s.name;
  label.onclick = () => useSession(s);
  label.style.flex = '1';

  const del = document.createElement('span');
  del.textContent = '\u2715';
  del.className = 'delete-btn';
  del.onclick = async (e) => {
    e.stopPropagation();
    await App.DeleteSession(s.id);
    renderSessionList();
  };

  row.appendChild(label);
  row.appendChild(del);

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showSessionContextMenu(e.clientX, e.clientY, s);
  });

  return row;
}

function attachMenuAutoClose(menu: HTMLElement) {
  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

const DEVICE_KINDS: { value: 'host' | 'switch' | 'firewall'; label: string }[] = [
  { value: 'host', label: 'VM / Host' },
  { value: 'switch', label: 'Network switch' },
  { value: 'firewall', label: 'Firewall' },
];

// Flyout submenu for device type, kept separate from the main session
// context menu so that menu doesn't grow a new row every time a device
// kind is added (router, load balancer, AP, ...). Opens anchored to the
// "Device type ▸" item that triggered it.
function showDeviceKindMenu(x: number, y: number, s: SessionProfile) {
  const existing = document.getElementById('session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'session-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-alt);border:1px solid var(--border);border-radius:4px;padding:4px 0;z-index:2000;min-width:140px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;

  const current = s.deviceKind === 'switch' || s.deviceKind === 'firewall' ? s.deviceKind : 'host';
  for (const k of DEVICE_KINDS) {
    const kindItem = document.createElement('div');
    kindItem.textContent = (k.value === current ? '\u2713 ' : '\u2003') + k.label;
    kindItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
    kindItem.onmouseenter = () => { kindItem.style.background = 'var(--hover)'; };
    kindItem.onmouseleave = () => { kindItem.style.background = ''; };
    kindItem.onclick = async () => {
      menu.remove();
      if (k.value === current) return;
      await App.SaveSession({ ...s, deviceKind: k.value });
      renderSessionList();
    };
    menu.appendChild(kindItem);
  }

  document.body.appendChild(menu);
  attachMenuAutoClose(menu);
}

function showSessionContextMenu(x: number, y: number, s: SessionProfile) {
  const existing = document.getElementById('session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'session-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-alt);border:1px solid var(--border);border-radius:4px;padding:4px 0;z-index:2000;min-width:120px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;

  const renameItem = document.createElement('div');
  renameItem.textContent = 'Rename';
  renameItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
  renameItem.onmouseenter = () => { renameItem.style.background = 'var(--hover)'; };
  renameItem.onmouseleave = () => { renameItem.style.background = ''; };
  renameItem.onclick = async () => {
    menu.remove();
    const newName = prompt('Rename session:', s.name);
    if (!newName || newName === s.name) return;
    await App.SaveSession({ ...s, name: newName });
    renderSessionList();
  };

  const deleteItem = document.createElement('div');
  deleteItem.textContent = 'Delete';
  deleteItem.style.cssText = 'padding:6px 12px;cursor:pointer;color:var(--danger);';
  deleteItem.onmouseenter = () => { deleteItem.style.background = 'var(--hover)'; };
  deleteItem.onmouseleave = () => { deleteItem.style.background = ''; };
  deleteItem.onclick = async () => {
    menu.remove();
    await App.DeleteSession(s.id);
    renderSessionList();
  };

  menu.appendChild(renameItem);

  // Single flyout entry instead of one row per device kind, only
  // meaningful for SSH sessions, serial always shows its own icon.
  if (s.type !== 'serial') {
    const kindItem = document.createElement('div');
    kindItem.style.cssText = 'padding:6px 12px;cursor:pointer;display:flex;justify-content:space-between;gap:12px;';
    const kindLabel = document.createElement('span');
    kindLabel.textContent = 'Device type';
    const arrow = document.createElement('span');
    arrow.textContent = '\u25b8';
    arrow.style.opacity = '0.6';
    kindItem.appendChild(kindLabel);
    kindItem.appendChild(arrow);
    kindItem.onmouseenter = () => { kindItem.style.background = 'var(--hover)'; };
    kindItem.onmouseleave = () => { kindItem.style.background = ''; };
    kindItem.onclick = (e) => {
      e.stopPropagation();
      const rect = kindItem.getBoundingClientRect();
      menu.remove();
      showDeviceKindMenu(rect.right, rect.top, s);
    };
    menu.appendChild(kindItem);
  }

  menu.appendChild(deleteItem);
  document.body.appendChild(menu);
  attachMenuAutoClose(menu);
}

function renderGroupNode(
  group: SessionGroup,
  groups: SessionGroup[],
  sessions: SessionProfile[],
  container: HTMLElement,
) {
  const isCollapsed = collapsedGroups.has(group.id);
  const header = document.createElement('div');
  header.className = 'entry';
  header.style.fontWeight = 'bold';
  header.style.userSelect = 'none';
  header.textContent = (isCollapsed ? '\u25b8 ' : '\u25be ') + '\ud83d\udcc1 ' + group.name;
  header.addEventListener('click', () => {
    if (collapsedGroups.has(group.id)) {
      collapsedGroups.delete(group.id);
    } else {
      collapsedGroups.add(group.id);
    }
    renderSessionList();
  });
  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    header.style.background = 'var(--hover)';
  });
  header.addEventListener('dragleave', () => {
    header.style.background = '';
  });
  header.addEventListener('drop', async (e) => {
    e.preventDefault();
    header.style.background = '';
    const sessionId = e.dataTransfer?.getData('text/specter-session-id');
    if (!sessionId) return;
    const sessions = await App.ListSessions();
    const s = sessions.find((x) => x.id === sessionId);
    if (!s) return;
    await App.SaveSession({ ...s, groupId: group.id });
    collapsedGroups.add(group.id);
    renderSessionList();
  });
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showGroupContextMenu(e.clientX, e.clientY, group);
  });
  container.appendChild(header);
  if (isCollapsed) return;
  const childGroups = groups.filter((g) => g.parentId === group.id);
  const childSessions = sessions.filter((s) => s.groupId === group.id);
  for (const cg of childGroups) {
    renderGroupNode(cg, groups, sessions, container);
  }
  for (const s of childSessions) {
    container.appendChild(renderSessionRow(s));
  }
}

function showGroupContextMenu(x: number, y: number, group: SessionGroup) {
  const existing = document.getElementById('session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'session-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-alt);border:1px solid var(--border);border-radius:4px;padding:4px 0;z-index:2000;min-width:140px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;

  const renameItem = document.createElement('div');
  renameItem.textContent = 'Rename folder';
  renameItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
  renameItem.onmouseenter = () => { renameItem.style.background = 'var(--hover)'; };
  renameItem.onmouseleave = () => { renameItem.style.background = ''; };
  renameItem.onclick = async () => {
    menu.remove();
    const newName = prompt('Rename folder:', group.name);
    if (!newName || newName === group.name) return;
    await App.SaveGroup({ ...group, name: newName });
    renderSessionList();
  };

  const deleteItem = document.createElement('div');
  deleteItem.textContent = 'Delete folder';
  deleteItem.style.cssText = 'padding:6px 12px;cursor:pointer;color:var(--danger);';
  deleteItem.onmouseenter = () => { deleteItem.style.background = 'var(--hover)'; };
  deleteItem.onmouseleave = () => { deleteItem.style.background = ''; };
  deleteItem.onclick = async () => {
    menu.remove();
    if (!confirm(`Delete folder "${group.name}"? Sessions inside will be moved out, not deleted.`)) return;
    await App.DeleteGroup(group.id);
    renderSessionList();
  };

  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);

  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

let sessionSearchQuery = '';
const collapsedGroups = new Set<string>();
let foldersInitialized = false;
let recentCollapsed = true;
// SPE-64: defaults OFF. OSC 52 lets whatever's running on the remote
// end write directly to the local OS clipboard with zero confirmation,
// including from a host you haven't decided to trust yet, the exact
// TOFU moment Specter's own host-key verification exists to gate.
// Opt-in via Settings for anyone who wants the convenience.
let osc52Enabled = localStorage.getItem('specter-osc52') === 'on';
let copyOnSelectEnabled = localStorage.getItem('specter-copy-on-select') === 'on';
let rightClickPasteEnabled = localStorage.getItem('specter-rclick-paste') !== 'off';
let highlightEnabled = localStorage.getItem('specter-highlight') !== 'off';

const HIGHLIGHT_RULES: [RegExp, string][] = [
  [/\b(connected|up|ok|success)\b/gi, '38;2;51;204;51'],   // bright green, MobaXterm-style
  [/\b(disabled|down|error|fail|failed)\b/gi, '38;2;229;72;77'], // red
  [/\b(warning)\b/gi, '38;2;210;153;34'],                   // yellow
  [/\b(?:Gi|Te|Fa|Fo|Hu|Po|Eth|Vlan)\d+(?:\/\d+)*\b/g, '38;2;198;120;221'], // magenta, interface/port identifiers
];

// Matches existing ANSI/OSC escape sequences so they can be preserved
// untouched. Covers CSI (colors, cursor movement: \x1b[...m etc.), OSC
// (window title: \x1b]...BEL or \x1b]...ST), and simple single-char
// escapes. Highlighting must never modify bytes inside these, doing so
// previously corrupted real prompts that use ANSI color codes (SPE-45).
// eslint-disable-next-line no-control-regex -- intentional: matching real ANSI/OSC escape sequences requires literal control chars
const ANSI_SEQUENCE_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-9;?]*[a-zA-Z]|[a-zA-Z0-9])/g;

function highlightPlainText(text: string): string {
  let result = text;
  for (const [pattern, code] of HIGHLIGHT_RULES) {
    result = result.replace(pattern, (match) => `\x1b[${code}m${match}\x1b[0m`);
  }
  return result;
}

function applyOutputHighlighting(text: string): string {
  if (!highlightEnabled) return text;
  let result = '';
  let lastIndex = 0;
  for (const match of text.matchAll(ANSI_SEQUENCE_RE)) {
    const idx = match.index!;
    result += highlightPlainText(text.slice(lastIndex, idx));
    result += match[0]; // pass existing escape sequences through untouched
    lastIndex = idx + match[0].length;
  }
  result += highlightPlainText(text.slice(lastIndex));
  return result;
}

function writeToTerminal(tab: Tab, data: string) {
  tab.term!.write(applyOutputHighlighting(data));
}

// --- Disconnected-session panel (SPE-59) ---
// Mirrors MobaXterm's disconnect UI (see design-reference comment on the
// Linear ticket): the failure message and a divider are written into the
// terminal's own scrollback, real content that scrolls, copies, and saves
// like everything else, and a small non-modal panel with Reconnect /
// Save Output / Close Tab is anchored to the bottom of the pane. R / S /
// Enter work as shortcuts while the panel is open, matching MobaXterm's
// keyboard-driven flow.

function terminalTextContent(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n');
}

async function saveTabOutput(tab: Tab) {
  if (!tab.term) return;
  const content = terminalTextContent(tab.term);
  const defaultName = `${tab.label.replace(/[^a-zA-Z0-9._@-]+/g, '_')}.log`;
  try {
    await App.SaveTextFile(defaultName, content);
  } catch (err) {
    console.error('Failed to save terminal output', err);
  }
}

function clearDisconnectPanel(tab: Tab) {
  tab.stopped = false;
  tab.overlay?.remove();
  tab.overlay = null;
}

async function reconnectTab(tab: Tab) {
  if (!tab.reconnect) return;
  clearDisconnectPanel(tab);
  await tab.reconnect();
}

// Manual "Disconnect" (Terminal menu): closes the underlying session but
// keeps the tab open, showing the same SPE-59 panel a real drop would.
// Useful both as a real feature (deliberately kill a session without
// losing the tab/scrollback) and for testing the panel without having
// to pull a cable every time. Reuses CloseSSH/CloseSerial, which mark
// the close as deliberate on the backend (no ssh:closed/serial:closed
// event fires), so the panel is shown here on the frontend side instead.
async function disconnectTab(tab: Tab) {
  if (tab.stopped) return;
  if (tab.mode === 'ssh' && tab.backendId) {
    await App.CloseSSH(tab.backendId);
  } else if (tab.mode === 'serial' && tab.backendId) {
    await App.CloseSerial(tab.backendId);
  } else {
    return; // nothing live to disconnect (pending or local shell tabs)
  }
  showDisconnectPanel(tab, 'Disconnected.');
}

function showDisconnectPanel(tab: Tab, message: string) {
  if (!tab.term || !tab.container) return;
  tab.stopped = true;
  tab.status = 'disconnected';
  renderTabBar();

  const term = tab.term;
  const cols = term.cols || 80;
  const divider = '-'.repeat(cols);
  // Red inline message + divider, written as real terminal content so it
  // scrolls, copies, and saves like everything else in the session.
  term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
  term.write(`\x1b[36m${divider}\x1b[0m\r\n`);

  tab.overlay?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'disconnect-panel';

  const title = document.createElement('div');
  title.className = 'disconnect-title';
  title.textContent = 'Session stopped';
  overlay.appendChild(title);

  const actions: { key: string; label: string; run: () => void; enabled: boolean }[] = [
    { key: 'Enter', label: 'exit tab', run: () => closeTab(tab.id), enabled: true },
    { key: 'R', label: 'restart session', run: () => { reconnectTab(tab); }, enabled: !!tab.reconnect },
    { key: 'S', label: 'save terminal output to file', run: () => { saveTabOutput(tab); }, enabled: true },
  ];

  for (const action of actions) {
    if (!action.enabled) continue;
    const row = document.createElement('div');
    row.className = 'disconnect-action';
    const key = document.createElement('span');
    key.className = 'disconnect-key';
    key.textContent = action.key;
    row.appendChild(key);
    const label = document.createElement('span');
    label.textContent = `to ${action.label}`;
    row.appendChild(label);
    row.onclick = action.run;
    overlay.appendChild(row);
  }

  tab.container.appendChild(overlay);
  tab.overlay = overlay;
}

function sessionMatchesQuery(s: SessionProfile, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (s.name.toLowerCase().includes(q)) return true;
  if (s.host && s.host.toLowerCase().includes(q)) return true;
  if (s.serialPort && s.serialPort.toLowerCase().includes(q)) return true;
  if (s.tags && s.tags.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

async function createNewFolder() {
  const name = prompt('Folder name:');
  if (!name) return;
  await App.SaveGroup({ id: '', name, parentId: '' });
  renderSessionList();
}

async function renderSessionList() {
  const [sessions, groups] = await Promise.all([App.ListSessions(), App.ListGroups()]);
  if (!foldersInitialized) {
    for (const g of groups) collapsedGroups.add(g.id);
    foldersInitialized = true;
  }
  const list = document.getElementById('session-list')!;
  list.innerHTML = '';

  const query = sessionSearchQuery;
  const visibleSessions = sessions.filter((s) => sessionMatchesQuery(s, query));

  if (!query) {
    const recent = sessions
      .filter((s) => s.lastUsed)
      .sort((a, b) => (b.lastUsed! > a.lastUsed! ? 1 : -1))
      .slice(0, 5);
    if (recent.length > 0) {
      const header = document.createElement('div');
      header.className = 'entry';
      header.style.fontWeight = 'bold';
      header.style.userSelect = 'none';
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.gap = '4px';
      const arrow = document.createElement('span');
      arrow.textContent = recentCollapsed ? '\u25b8' : '\u25be';
      // Original document+clock icon (SPE-61-adjacent polish), not a
      // copy of any existing stock icon, replaces the stopwatch emoji
      // that was here before with something that reads more clearly as
      // "recently used" at this size.
      const icon = document.createElement('span');
      icon.style.cssText = 'display:inline-flex;width:14px;height:14px;flex:0 0 auto;';
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M14 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V8.5L14 3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v4.5a1 1 0 0 0 1 1h4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="8" y1="16.5" x2="13.5" y2="16.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="8" y1="19" x2="12" y2="19" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="9.5" r="5.5" fill="var(--bg)" stroke="currentColor" stroke-width="1.6"/><path d="M8 6.3V9.5l2.3 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const label = document.createElement('span');
      label.textContent = 'Recent';
      header.appendChild(arrow);
      header.appendChild(icon);
      header.appendChild(label);
      header.addEventListener('click', () => {
        recentCollapsed = !recentCollapsed;
        renderSessionList();
      });
      list.appendChild(header);
      if (!recentCollapsed) {
        for (const s of recent) {
          list.appendChild(renderSessionRow(s));
        }
      }
    }
  }

  const topGroups = groups.filter((g) => !g.parentId);
  for (const g of topGroups) {
    renderGroupNode(g, groups, visibleSessions, list);
  }

  const ungrouped = visibleSessions.filter((s) => !s.groupId);
  for (const s of ungrouped) {
    list.appendChild(renderSessionRow(s));
  }

  if (!query) {
    const addFolder = document.createElement('div');
    addFolder.className = 'entry';
    addFolder.style.cssText = 'opacity:0.6;cursor:pointer;font-size:12px;';
    addFolder.textContent = '+ New folder';
    addFolder.onclick = createNewFolder;
    list.appendChild(addFolder);
  }
}

// --- Host key trust modal ---

// SPE-63: masked passphrase entry, replacing window.prompt() which has
// no password mode and showed the passphrase in cleartext on-screen
// while typing. Mirrors showTrustPrompt's modal pattern below.
// SPE-65: soft warning for a group/world-readable key file, real
// OpenSSH refuses to use one outright, Specter warns but lets the user
// proceed, since it's their key and Specter didn't create the file.
function showKeyPermWarning(opts: { path: string; mode: string; onProceed: () => void; onCancel: () => void }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1e1e1e;border:2px solid #d29922;border-radius:8px;padding:24px;max-width:480px;color:#ddd;font-family:sans-serif;';
  box.innerHTML = `
    <h3 style="margin-top:0;color:#d29922;">Key file permissions are too open</h3>
    <p><strong>Path:</strong> <code style="word-break:break-all;">${opts.path}</code></p>
    <p><strong>Mode:</strong> <code>${opts.mode}</code></p>
    <p>This private key is readable by other users on this system. OpenSSH itself would refuse to use a key like this. You can proceed anyway, but consider running <code>chmod 600 ${opts.path}</code>.</p>
  `;
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => { document.body.removeChild(overlay); opts.onCancel(); };
  const proceedBtn = document.createElement('button');
  proceedBtn.textContent = 'Use it anyway';
  proceedBtn.style.cssText = 'background:#d29922;color:#1e1e1e;';
  proceedBtn.onclick = () => { document.body.removeChild(overlay); opts.onProceed(); };
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(proceedBtn);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function showPassphrasePrompt(opts: { onSubmit: (passphrase: string) => void; onCancel: () => void }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1e1e1e;border:2px solid #3a3a3a;border-radius:8px;padding:24px;max-width:380px;width:100%;color:#ddd;font-family:sans-serif;';

  const title = document.createElement('h3');
  title.style.cssText = 'margin-top:0;color:#ddd;';
  title.textContent = 'Encrypted key';
  box.appendChild(title);

  const label = document.createElement('p');
  label.textContent = 'This private key is encrypted. Enter its passphrase to continue.';
  box.appendChild(label);

  const input = document.createElement('input');
  input.type = 'password';
  input.autofocus = true;
  input.style.cssText = 'width:100%;box-sizing:border-box;background:#151515;border:1px solid #3a3a3a;color:#ddd;padding:6px 8px;font-size:13px;';
  box.appendChild(input);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => { document.body.removeChild(overlay); opts.onCancel(); };
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Continue';
  submitBtn.style.cssText = 'background:#3178c6;color:white;';
  const submit = () => { document.body.removeChild(overlay); opts.onSubmit(input.value); };
  submitBtn.onclick = submit;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') { document.body.removeChild(overlay); opts.onCancel(); }
  });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(submitBtn);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  input.focus();
}

function showTrustPrompt(opts: {
  host: string; fingerprint: string; keyType: string; changed: boolean;
  onAccept: () => void; onReject: () => void;
}) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
  const box = document.createElement('div');
  box.style.cssText = `background:#1e1e1e;border:2px solid ${opts.changed ? '#e5484d' : '#3a3a3a'};border-radius:8px;padding:24px;max-width:480px;color:#ddd;font-family:sans-serif;`;
  const title = opts.changed ? '⚠️ Host key has CHANGED — possible security risk' : 'Unknown host — verify before connecting';
  box.innerHTML = `
    <h3 style="margin-top:0;color:${opts.changed ? '#e5484d' : '#ddd'}">${title}</h3>
    <p><strong>Host:</strong> ${opts.host}</p>
    <p><strong>Key type:</strong> ${opts.keyType}</p>
    <p><strong>Fingerprint:</strong> <code style="word-break:break-all;">${opts.fingerprint}</code></p>
    ${opts.changed
      ? '<p style="color:#e5484d;">This host previously presented a different key. This could mean the server was reinstalled — or that your connection is being intercepted. Only proceed if you\'re certain.</p>'
      : '<p>Verify this fingerprint matches what the server administrator provided before trusting it.</p>'}
  `;
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
  const rejectBtn = document.createElement('button');
  rejectBtn.textContent = 'Cancel';
  rejectBtn.onclick = () => { document.body.removeChild(overlay); opts.onReject(); };
  const acceptBtn = document.createElement('button');
  acceptBtn.textContent = opts.changed ? 'I understand the risk — trust anyway' : 'Trust and connect';
  acceptBtn.style.cssText = opts.changed ? 'background:#e5484d;color:white;' : 'background:#3178c6;color:white;';
  acceptBtn.onclick = () => { document.body.removeChild(overlay); opts.onAccept(); };
  btnRow.appendChild(rejectBtn);
  btnRow.appendChild(acceptBtn);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function showConnectError(message: string) {

  let el = document.getElementById('connect-error');

  if (!el) {

    el = document.createElement('div');

    el.id = 'connect-error';

    el.style.cssText = 'width:100%;color:#e5484d;font-size:12px;padding:2px 0;';

    document.getElementById('picker-ssh-fields')!.appendChild(el);

  }

  el.textContent = message;

}

function clearConnectError() {
  document.getElementById('connect-error')?.remove();
}

// --- Connect flow (targets the currently active pending tab) ---

// wireSSHEvents attaches the data/close listeners for a live SSH session
// and (re)installs the tab's reconnect closure, used both on first
// connect and after SPE-59's "R to restart session" action.
function wireSSHEvents(tab: Tab, sessionId: string, req: ConnectRequest) {
  runtime.EventsOn('ssh:data:' + sessionId, (data: unknown) => writeToTerminal(tab, data as string));
  runtime.EventsOn('ssh:closed:' + sessionId, (payload: unknown) => {
    showDisconnectPanel(tab, (payload as SessionClosedEvent).message);
  });
  tab.reconnect = () => reconnectSSH(tab, req);
}

// reconnectSSH re-runs Connect() on an already-live tab (as opposed to
// connectActiveTab, which targets a fresh pending tab and creates a new
// terminal). Reuses the existing terminal/container so scrollback from
// the dead session, including the disconnect message, stays visible.
// SPE-99: shown after a successful connect/reconnect that only worked
// via the automatic legacy-algorithm fallback. Not something the
// person requested or predicted in advance, an honest one-time notice
// so "connected automatically" never means "silently weaker security
// without you knowing."
function notifyLegacyCompat(host: string) {
  alert(`Connected to ${host} using legacy compatibility mode: this device only supports older SSH algorithms, so this connection uses reduced security compared to Specter's normal defaults.`);
}

async function reconnectSSH(tab: Tab, req: ConnectRequest): Promise<void> {
  tab.status = 'connecting';
  renderTabBar();

  let result;
  try {
    result = await App.Connect(req);
  } catch (err) {
    showDisconnectPanel(tab, String(err));
    return;
  }

  if (result.needsPassphrase) {
    showPassphrasePrompt({
      onSubmit: (passphrase) => { reconnectSSH(tab, { ...req, passphrase }); },
      onCancel: () => showDisconnectPanel(tab, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.needsKeyPermConfirm) {
    showKeyPermWarning({
      path: result.keyPermPath!, mode: result.keyPermMode!,
      onProceed: () => { reconnectSSH(tab, { ...req, ignoreKeyPermWarning: true }); },
      onCancel: () => showDisconnectPanel(tab, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.needsTrust) {
    showTrustPrompt({
      host: result.host!, fingerprint: result.fingerprint!, keyType: result.keyType!, changed: !!result.changed,
      onAccept: async () => {
        if (result.changed) await App.TrustHostDespiteChange(result.host!);
        else await App.TrustHost(result.host!);
        await reconnectSSH(tab, req);
      },
      onReject: () => showDisconnectPanel(tab, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.sessionId) {
    tab.backendId = result.sessionId;
    tab.status = 'connected';
    renderTabBar();
    tab.term!.write('\r\n\x1b[32mReconnected.\x1b[0m\r\n');
    wireSSHEvents(tab, result.sessionId, req);
    if (result.legacyCompat) notifyLegacyCompat(req.host);
  }
}

async function connectActiveTab(req: ConnectRequest) {
  const tab = tabs.get(activeTabId!)!;
  tab.status = 'connecting';
  tab.label = `${req.user}@${req.host}`;
  renderTabBar();
  clearConnectError();

  let result;
  try {
    result = await App.Connect(req);
  } catch (err) {
    tab.status = 'disconnected';
    renderTabBar();
    showConnectError(String(err));
    return;
  }

  if (result.needsPassphrase) {
    showPassphrasePrompt({
      onSubmit: (passphrase) => { connectActiveTab({ ...req, passphrase }); },
      onCancel: () => { tab.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.needsKeyPermConfirm) {
    showKeyPermWarning({
      path: result.keyPermPath!, mode: result.keyPermMode!,
      onProceed: () => { connectActiveTab({ ...req, ignoreKeyPermWarning: true }); },
      onCancel: () => { tab.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.needsTrust) {
    showTrustPrompt({
      host: result.host!, fingerprint: result.fingerprint!, keyType: result.keyType!, changed: !!result.changed,
      onAccept: async () => {
        if (result.changed) await App.TrustHostDespiteChange(result.host!);
        else await App.TrustHost(result.host!);
        await connectActiveTab(req);
      },
      onReject: () => { tab.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.sessionId) {
    tab.mode = 'ssh';
    tab.backendId = result.sessionId;
    tab.status = 'connected';
    createTerminalForTab(tab);
    wireSSHEvents(tab, result.sessionId, req);
    switchToTab(tab.id);
    closeSessionPicker();
    refreshFileList('.', result.sessionId);
    if (result.legacyCompat) notifyLegacyCompat(req.host);

    if (!skipSavePrompt) {
      const name = `${req.user}@${req.host}`;
      if (confirm(`Save this session as "${name}"?`)) {
        await App.SaveSession({ id: '', name, host: req.host, port: req.port, user: req.user, keyPath: req.keyPath, deviceKind: currentDeviceKind() });
        renderSessionList();
      }
    }
    skipSavePrompt = false;
  }
}

document.getElementById('connect')!.addEventListener('click', async () => {
  const host = (document.getElementById('host') as HTMLInputElement).value;
  const user = (document.getElementById('user') as HTMLInputElement).value;
  const authMode = (document.querySelector('input[name="authmode"]:checked') as HTMLInputElement).value;

  let req: ConnectRequest;
  if (authMode === 'key') {
    const keyPath = (document.getElementById('keyPath') as HTMLInputElement).value;
    const passphrase = (document.getElementById('passphrase') as HTMLInputElement).value;
    req = { host, port: 22, user, keyPath, passphrase };
  } else {
    const password = (document.getElementById('password') as HTMLInputElement).value;
    req = { host, port: 22, user, password };
  }

  await connectActiveTab(req);

  if (authMode !== 'key') {

    const tab = tabs.get(activeTabId!);

    if (tab && tab.status === 'connected') {

      const password = (document.getElementById('password') as HTMLInputElement).value;

      passwordCache.set(passwordCacheKey(host, 22, user), password);

    }

  }
  if (pendingSessionName) {

    const tab = tabs.get(activeTabId!);

    if (tab) {

      tab.label = pendingSessionName;

      renderTabBar();

    }

    pendingSessionName = null;

  }
  // Bug fix: this used to unconditionally call closeSessionPicker()
  // here, but connectActiveTab legitimately returns early (still
  // "in progress" from the user's perspective) when it needs a
  // passphrase/trust/key-permission confirmation via a modal. Closing
  // the picker at that point yanked it shut mid-flow, before success
  // or failure was even known, silently hiding the eventual error
  // (showConnectError correctly wrote it into the picker's own DOM,
  // just inside a container the user could no longer see). Closing on
  // success now happens inside connectActiveTab itself, right where
  // success is actually determined, not here.
});

// SPE-31: pre-1809 Windows (and any other local-shell startup failure)
// must show a clear error, not fail silently. Previously this had no
// error handling at all, a rejected StartLocalTerminal() call (e.g.
// ConPty's ErrConPtyUnsupported on old Windows) left the tab stuck in
// 'pending' forever with zero feedback, not a crash, but just as
// confusing for a first impression. Creates the terminal container up
// front so there's always somewhere to show the message, reuses the
// same disconnect panel SPE-59 built rather than a separate error UI.
async function startLocalShellInActiveTab(shell: string, label: string) {
  const tab = tabs.get(activeTabId!)!;
  tab.label = label;
  tab.mode = 'local';
  createTerminalForTab(tab);
  switchToTab(tab.id);

  let id: string;
  try {
    id = await App.StartLocalTerminal(shell);
  } catch (err) {
    showDisconnectPanel(tab, String(err));
    return;
  }

  tab.backendId = id;
  tab.status = 'connected';
  renderTabBar();
  runtime.EventsOn('local:data:' + id, (data: unknown) => writeToTerminal(tab, data as string));
}

async function newLocalShellTab(shell: string, label: string) {
  const tab = createPendingTab();
  switchToTab(tab.id);
  await startLocalShellInActiveTab(shell, label);
}

// wireSerialEvents mirrors wireSSHEvents for serial console sessions,
// the direct-hardware-console analogue of a dropped SSH session (SPE-59).
function wireSerialEvents(tab: Tab, id: string, portName: string, baud: number) {
  runtime.EventsOn('serial:data:' + id, (data: unknown) => writeToTerminal(tab, data as string));
  runtime.EventsOn('serial:closed:' + id, (payload: unknown) => {
    showDisconnectPanel(tab, (payload as SessionClosedEvent).message);
  });
  tab.reconnect = () => reconnectSerial(tab, portName, baud);
}

async function reconnectSerial(tab: Tab, portName: string, baud: number): Promise<void> {
  tab.status = 'connecting';
  renderTabBar();
  let id: string;
  try {
    id = await App.ConnectSerial(portName, baud);
  } catch (err) {
    showDisconnectPanel(tab, String(err));
    return;
  }
  tab.backendId = id;
  tab.status = 'connected';
  renderTabBar();
  tab.term!.write('\r\n\x1b[32mReconnected.\x1b[0m\r\n');
  wireSerialEvents(tab, id, portName, baud);
}

// Same bug class as the SSH connect flow above and SPE-31's local-shell
// fix: no error handling at all previously, and the picker was closed
// before this even ran, so a bad port left the user with zero feedback
// anywhere. Now shows the error via showConnectError (picker stays
// open, matching the SSH flow) rather than an unhandled rejection.
async function connectSerialInActiveTab(portName: string, baud: number) {
  const tab = tabs.get(activeTabId!)!;
  tab.label = portName;

  let id: string;
  try {
    id = await App.ConnectSerial(portName, baud);
  } catch (err) {
    showConnectError(String(err));
    return;
  }

  tab.mode = 'serial';
  tab.backendId = id;
  tab.status = 'connected';
  createTerminalForTab(tab);
  wireSerialEvents(tab, id, portName, baud);
  switchToTab(tab.id);
  closeSessionPicker();

  if (!skipSerialSavePrompt) {
    if (confirm(`Save this serial session as "${portName}"?`)) {
      await App.SaveSession({ id: '', name: portName, type: 'serial', serialPort: portName, baud });
      renderSessionList();
    }
  }
  skipSerialSavePrompt = false;
}



function checkCapsLock(e: KeyboardEvent) {

  const isCapsOn = e.getModifierState && e.getModifierState('CapsLock');

  document.getElementById('caps-lock-warning')!.style.display = isCapsOn ? 'block' : 'none';

}

document.addEventListener('keydown', checkCapsLock);

document.addEventListener('keydown', (e) => {
  // Global fallback for when no terminal has focus (the "No session
  // yet" landing screen, sidebar search box, etc.), the per-terminal
  // version above only fires while an xterm instance actually has
  // focus. Same Ctrl+Shift+B, not plain Ctrl+B (tmux's prefix key).
  if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
  // SPE-77 zoom, same global-fallback reasoning.
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    zoomBy(1);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault();
    zoomBy(-1);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    applyFontSize(FONT_SIZE_DEFAULT);
  }
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  }
});

document.getElementById('zoom-slider')!.addEventListener('input', (e) => {
  applyFontSize(Number((e.target as HTMLInputElement).value));
});
document.getElementById('zoom-in-btn')!.addEventListener('click', () => zoomBy(1));
document.getElementById('zoom-out-btn')!.addEventListener('click', () => zoomBy(-1));
document.getElementById('zoom-reset-btn')!.addEventListener('click', () => applyFontSize(FONT_SIZE_DEFAULT));

document.addEventListener('keyup', checkCapsLock);

document.getElementById('password')!.addEventListener('focus', () => {

  // Chrome/WebKit don't expose getModifierState on a plain focus event,

  // so send a synthetic check on the next keydown; also immediately hide

  // any stale warning left over from before this field was focused.

  document.getElementById('caps-lock-warning')!.style.display = 'none';

});



document.getElementById('picker-ssh-fields')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('connect')!.click();
  }
});

document.getElementById('browse-key')!.addEventListener('click', async () => {
  const path = await App.SelectKeyFile();
  if (path) (document.getElementById('keyPath') as HTMLInputElement).value = path;
});

const authRadios = document.querySelectorAll('input[name="authmode"]') as NodeListOf<HTMLInputElement>;
authRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    const isKey = radio.value === 'key' && radio.checked;
    document.getElementById('auth-password-fields')!.style.display = isKey ? 'none' : 'inline';
    document.getElementById('auth-key-fields')!.style.display = isKey ? 'inline' : 'none';
  });
});

// --- Init: start with one pending tab ---
document.getElementById('app')!.classList.add('editor-collapsed');
document.getElementById('editor-expand-btn')!.style.display = 'flex';
let remoteFilesCollapsed = false;
document.getElementById('remote-files-header')!.addEventListener('click', () => {
  remoteFilesCollapsed = !remoteFilesCollapsed;
  document.getElementById('file-list')!.style.display = remoteFilesCollapsed ? 'none' : 'block';
  document.getElementById('remote-files-label')!.textContent = (remoteFilesCollapsed ? '\u25b8 ' : '\u25be ') + 'Remote files';
});
document.getElementById('remote-files-label')!.textContent = '\u25be Remote files';

const initialTab = createPendingTab();
switchToTab(initialTab.id);
document.getElementById('session-search')!.addEventListener('input', (e) => {
  sessionSearchQuery = (e.target as HTMLInputElement).value;
  renderSessionList();
});


const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
themeSelect.value = currentTheme();
applyTheme(currentTheme());
themeSelect.addEventListener('change', () => {
  applyTheme(themeSelect.value as ThemeName);
});

// SPE-96: applied synchronously from localStorage on startup (like
// theme above), rather than waiting on the async GetSettings() round
// trip, no reason a same-machine layout preference needs an IPC call.
function currentSidebarPosition(): 'left' | 'right' {
  return localStorage.getItem('specter-sidebar-position') === 'right' ? 'right' : 'left';
}
// Deliberately minimal, safe to call synchronously at startup: just the
// CSS class + localStorage, nothing that touches currentColumnTemplate
// (a let declared much later in this file). Confirmed the hard way that
// referencing a let before its declaration line has run throws a
// temporal-dead-zone ReferenceError that silently halts ALL script
// execution after it, every button below this point stopped working
// entirely, not just this feature.
function applySidebarPosition(pos: 'left' | 'right') {
  document.getElementById('app')!.classList.toggle('sidebar-right', pos === 'right');
  localStorage.setItem('specter-sidebar-position', pos);
}
const sidebarPositionSelect = document.getElementById('sidebar-position-select') as HTMLSelectElement;
sidebarPositionSelect.value = currentSidebarPosition();
applySidebarPosition(currentSidebarPosition());
sidebarPositionSelect.addEventListener('change', () => {
  // The currentColumnTemplate reset (safe here: this only runs on user
  // interaction, long after the whole script, including that later let
  // declaration, has finished loading) stays deferred to this handler,
  // not the startup call above, same pattern toggleSidebar/
  // toggleEditorPane already use for the identical reason.
  const app = document.getElementById('app')!;
  app.style.gridTemplateColumns = '';
  currentColumnTemplate = ['220px', '5px', '1fr', '5px', '1fr'];
  applySidebarPosition(sidebarPositionSelect.value as 'left' | 'right');
  refitActiveTerminal();
});

// SPE-98: one-click toggle in the title bar, alongside applyTheme,
// keeping the Settings dropdown in sync so neither path shows a stale
// value if the other one was used most recently.
function toggleThemeQuick() {
  const next: ThemeName = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  themeSelect.value = next;
}
document.getElementById('theme-toggle-btn')!.addEventListener('click', toggleThemeQuick);

// SPE-61: terminal color scheme, font, and wallpaper. Loaded from the
// backend-persisted settings.json (loadSettingsAndApply), independent
// of the dark/light UI toggle above once the user explicitly picks one.
const colorSchemeSelect = document.getElementById('colorscheme-select') as HTMLSelectElement;
colorSchemeSelect.addEventListener('change', () => {
  applyColorScheme(colorSchemeSelect.value as ColorScheme);
});

const fontSelect = document.getElementById('font-select') as HTMLSelectElement;
fontSelect.addEventListener('change', () => {
  applyFont(fontSelect.value);
});

document.getElementById('wallpaper-browse')!.addEventListener('click', async () => {
  const path = await App.SelectImageFile();
  if (!path) return;
  await setWallpaper(path);
});

const wallpaperOpacitySlider = document.getElementById('wallpaper-opacity') as HTMLInputElement;
wallpaperOpacitySlider.addEventListener('input', () => {
  appSettings.wallpaperOpacity = Number(wallpaperOpacitySlider.value) / 100;
  applyWallpaperVisual();
});
wallpaperOpacitySlider.addEventListener('change', () => {
  App.SaveSettings(appSettings);
});

document.getElementById('wallpaper-clear')!.addEventListener('click', () => {
  clearWallpaper();
});

loadSettingsAndApply();

// Check-for-updates (not auto-update): one GitHub releases API check on
// launch, dismissible per-version so it doesn't nag every time once
// acknowledged, re-appears if a further newer version comes out later.
// manual=true (from the Settings menu item) always shows a result, even
// "you're up to date", and ignores any prior dismissal, since an
// explicit click should never appear to do nothing.
async function checkForUpdate(manual = false) {
  let info: UpdateInfo;
  try {
    info = await App.CheckForUpdate();
  } catch (err) {
    if (manual) alert(`Could not check for updates: ${err}`);
    return;
  }
  if (!info.available) {
    if (manual) alert(`You're up to date (${info.currentVersion}).`);
    return;
  }
  if (!manual && localStorage.getItem('specter-update-dismissed') === info.latestVersion) return;

  const banner = document.getElementById('update-banner')!;
  document.getElementById('update-banner-text')!.textContent =
    `A new version of Specter is available: ${info.latestVersion} (you're on ${info.currentVersion})`;
  banner.style.display = 'flex';

  const downloadBtn = document.getElementById('update-banner-download') as HTMLButtonElement;
  downloadBtn.textContent = 'Download';
  downloadBtn.disabled = false;
  downloadBtn.addEventListener('click', async () => {
    if (!info.assetUrl) {
      // No matching asset found for this platform (shouldn't normally
      // happen, but a real release could legitimately be missing one,
      // exactly like the NSIS installer did once tonight). Fall back to
      // the browser rather than doing nothing.
      runtime.BrowserOpenURL(info.releaseUrl);
      return;
    }
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Downloading\u2026';
    try {
      await App.DownloadAndInstallUpdate(info.assetUrl);
      downloadBtn.textContent = 'Downloaded';
      // On Windows this is genuinely done, the installer is now open on
      // top of Specter. On macOS/Linux, a file manager window just
      // opened showing the extracted files, there's no single-file
      // "launch" without a real installer format.
    } catch (err) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download';
      alert(`Update download failed: ${err}\n\nYou can also grab it manually from the releases page.`);
    }
  });
  document.getElementById('update-banner-dismiss')!.addEventListener('click', () => {
    localStorage.setItem('specter-update-dismissed', info.latestVersion);
    banner.style.display = 'none';
  });
}
checkForUpdate();

App.GetVersion().then((v) => {
  document.getElementById('menu-version')!.textContent = v === 'dev' ? '(dev build)' : v;
});
document.getElementById('menu-check-updates')!.addEventListener('click', () => {
  closeAllMenus();
  checkForUpdate(true);
});

const osc52Toggle = document.getElementById('osc52-toggle') as HTMLInputElement;
osc52Toggle.checked = osc52Enabled;
osc52Toggle.addEventListener('change', () => {
  osc52Enabled = osc52Toggle.checked;
  localStorage.setItem('specter-osc52', osc52Enabled ? 'on' : 'off');
});

const copyOnSelectToggle = document.getElementById('copy-on-select-toggle') as HTMLInputElement;
copyOnSelectToggle.checked = copyOnSelectEnabled;
copyOnSelectToggle.addEventListener('change', () => {
  copyOnSelectEnabled = copyOnSelectToggle.checked;
  localStorage.setItem('specter-copy-on-select', copyOnSelectEnabled ? 'on' : 'off');
});

const rclickPasteToggle = document.getElementById('rclick-paste-toggle') as HTMLInputElement;
rclickPasteToggle.checked = rightClickPasteEnabled;
rclickPasteToggle.addEventListener('change', () => {
  rightClickPasteEnabled = rclickPasteToggle.checked;
  localStorage.setItem('specter-rclick-paste', rightClickPasteEnabled ? 'on' : 'off');
});

const warnMultilinePasteToggle = document.getElementById('warn-multiline-paste-toggle') as HTMLInputElement;
warnMultilinePasteToggle.checked = warnMultilinePasteEnabled;
warnMultilinePasteToggle.addEventListener('change', () => {
  warnMultilinePasteEnabled = warnMultilinePasteToggle.checked;
  localStorage.setItem('specter-warn-multiline-paste', warnMultilinePasteEnabled ? 'on' : 'off');
});

// SPE-79: unlike the toggles above, this one lives in the Go-backed
// config.Settings (App.SaveSettings), not localStorage, since Connect()
// needs to read it fresh from settings.json at connect time, not just
// the frontend's own in-memory state.
const keepaliveToggle = document.getElementById('ssh-keepalive-toggle') as HTMLInputElement;
keepaliveToggle.addEventListener('change', () => {
  appSettings.sshKeepaliveDisabled = !keepaliveToggle.checked;
  App.SaveSettings(appSettings);
});

const showTabNumbersToggle = document.getElementById('show-tab-numbers-toggle') as HTMLInputElement;
showTabNumbersToggle.checked = showTabNumbersEnabled;
showTabNumbersToggle.addEventListener('change', () => {
  showTabNumbersEnabled = showTabNumbersToggle.checked;
  localStorage.setItem('specter-show-tab-numbers', showTabNumbersEnabled ? 'on' : 'off');
  renderTabBar();
});

const highlightToggle = document.getElementById('highlight-toggle') as HTMLInputElement;
highlightToggle.checked = highlightEnabled;
highlightToggle.addEventListener('change', () => {
  highlightEnabled = highlightToggle.checked;
  localStorage.setItem('specter-highlight', highlightEnabled ? 'on' : 'off');
});

// --- Menu bar ---

function closeAllMenus() {
  document.querySelectorAll('#menubar .menu-dropdown').forEach((el) => el.classList.remove('open'));
  document.querySelectorAll('#menubar .menu-item').forEach((el) => el.classList.remove('open'));
}

document.querySelectorAll('#menubar .menu-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = item.querySelector('.menu-dropdown')!;
    const wasOpen = dropdown.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) {
      dropdown.classList.add('open');
      item.classList.add('open');
    }
  });
});

// Bug fix: clicking anything inside an open dropdown (a <select>, a
// checkbox, the wallpaper Browse button) bubbled up to the document-level
// closeAllMenus() listener below and closed the whole panel immediately,
// only the .menu-item click (opening it) was protected with
// stopPropagation, not the dropdown's own contents. Apparently invisible
// on Linux/WebKitGTK's native <select> popup timing, but immediately
// visible on Windows/WebView2, reported as dropdowns "disappearing
// immediately" there.
document.querySelectorAll('#menubar .menu-dropdown').forEach((dropdown) => {
  dropdown.addEventListener('click', (e) => e.stopPropagation());
});

// Frameless window (no OS title bar): #menubar doubles as the title bar
// via --wails-draggable:drag in CSS, these are the real window controls.
document.getElementById('win-minimize')!.addEventListener('click', () => {
  runtime.WindowMinimise();
});
document.getElementById('win-maximize')!.addEventListener('click', () => {
  runtime.WindowToggleMaximise();
});
document.getElementById('win-close')!.addEventListener('click', () => {
  runtime.Quit();
});
document.getElementById('titlebar-spacer')!.addEventListener('dblclick', () => {
  runtime.WindowToggleMaximise();
});

document.addEventListener('click', () => closeAllMenus());

// Terminal menu
document.getElementById('menu-new-tab')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = createPendingTab();
  switchToTab(tab.id);
});
document.getElementById('menu-new-local-shell')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('', 'Local shell');
});
document.getElementById('menu-close-tab')!.addEventListener('click', () => {
  closeAllMenus();
  if (activeTabId) closeTab(activeTabId);
});
document.getElementById('menu-disconnect-tab')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab) disconnectTab(tab);
});
document.getElementById('menu-clear-screen')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  tab?.term?.clear();
});

// Sessions menu
function resetPickerView() {
  document.getElementById('picker-grid')!.style.display = 'grid';
  document.getElementById('picker-ssh-fields')!.style.display = 'none';
  document.getElementById('picker-serial-fields')!.style.display = 'none';
}
function openSessionPicker() {
  resetPickerView();
  // SPE-83: pre-fill with the OS username, matching MobaXterm's "same
  // as Windows login" default, only if the field is currently empty,
  // never overwrite something the person already typed or a saved
  // session's own stored username.
  const userField = document.getElementById('user') as HTMLInputElement;
  if (!userField.value) {
    App.GetOSUsername().then((name) => {
      if (name && !userField.value) userField.value = name;
    }).catch(() => {});
  }
  document.getElementById('session-picker-overlay')!.classList.add('open');
}
function closeSessionPicker() {
  document.getElementById('session-picker-overlay')!.classList.remove('open');
  resetPickerView();
}
function ensurePendingTab() {
  // The picker always operates on the current tab if it's already
  // pending (opened from a tab's own landing view); otherwise it
  // creates a fresh pending tab first (opened from the Sessions menu).
  const current = activeTabId ? tabs.get(activeTabId) : null;
  if (current && current.mode === 'pending') return current;
  const tab = createPendingTab();
  switchToTab(tab.id);
  return tab;
}

document.getElementById('menu-new-session')!.addEventListener('click', () => {
  closeAllMenus();
  ensurePendingTab();
  openSessionPicker();
});
document.getElementById('new-session-btn')!.addEventListener('click', () => {
  ensurePendingTab();
  openSessionPicker();
});
document.getElementById('session-picker-close')!.addEventListener('click', closeSessionPicker);
document.getElementById('session-picker-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('session-picker-overlay')) closeSessionPicker();
});
document.getElementById('picker-ssh')!.addEventListener('click', () => {
  document.getElementById('picker-grid')!.style.display = 'none';
  document.getElementById('picker-ssh-fields')!.style.display = 'flex';
});
document.getElementById('picker-serial')!.addEventListener('click', () => {
  document.getElementById('picker-grid')!.style.display = 'none';
  document.getElementById('picker-serial-fields')!.style.display = 'flex';
});
document.getElementById('serial-connect')!.addEventListener('click', async () => {
  const portName = (document.getElementById('serial-port') as HTMLInputElement).value;
  const baud = parseInt((document.getElementById('serial-baud') as HTMLSelectElement).value, 10);
  if (!portName) return;
  await connectSerialInActiveTab(portName, baud);
});
document.getElementById('picker-shell')!.addEventListener('click', () => {
  ensurePendingTab();
  closeSessionPicker();
  startLocalShellInActiveTab('', 'Local shell');
});
document.getElementById('menu-new-folder')!.addEventListener('click', () => {
  closeAllMenus();
  createNewFolder();
});

// View menu
function toggleSidebar() {
  document.getElementById('app')!.style.gridTemplateColumns = '';
  currentColumnTemplate = ['220px', '5px', '1fr', '5px', '1fr'];
  const collapsed = document.getElementById('app')!.classList.toggle('sidebar-collapsed');
  document.getElementById('sidebar-expand-btn')!.style.display = collapsed ? 'flex' : 'none';
  refitActiveTerminal();
}
document.getElementById('menu-toggle-sidebar')!.addEventListener('click', () => {
  closeAllMenus();
  toggleSidebar();
});

// SPE-95: distinct from window maximize, hides all chrome (menu bar,
// title bar) and uses the whole screen, matching F11 convention. F11
// itself is safe to claim globally, unlike some of the other shortcuts
// tonight (Ctrl+B/tmux etc.), it's not a meaningful readline/shell
// binding anywhere.
async function toggleFullscreen() {
  const isFull = await runtime.WindowIsFullscreen();
  if (isFull) runtime.WindowUnfullscreen();
  else runtime.WindowFullscreen();
}
document.getElementById('menu-toggle-fullscreen')!.addEventListener('click', () => {
  closeAllMenus();
  toggleFullscreen();
});
document.getElementById('sidebar-collapse-btn')!.addEventListener('click', toggleSidebar);
document.getElementById('sidebar-expand-btn')!.addEventListener('click', toggleSidebar);

// Tools menu: platform-aware, hide Command Prompt/PowerShell on non-Windows
App.GetPlatform().then((platform) => {
  if (platform !== 'windows') {
    document.getElementById('menu-tool-cmd')!.classList.add('disabled');
    document.getElementById('menu-tool-powershell')!.classList.add('disabled');
  }
});
document.getElementById('menu-tool-terminal')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('', 'Terminal');
});
document.getElementById('menu-tool-cmd')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('cmd.exe', 'Command Prompt');
});
document.getElementById('menu-tool-powershell')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('powershell.exe', 'PowerShell');
});
document.getElementById('menu-tool-text-editor')!.addEventListener('click', () => {
  closeAllMenus();
  document.getElementById('app')!.classList.remove('editor-collapsed');
  document.getElementById('editor-expand-btn')!.style.display = 'none';
  openFilePath = null;
  openFileSessionId = null;
  document.getElementById('editor-path')!.textContent = 'Untitled';
  editor.setValue('');
  monaco.editor.setModelLanguage(editor.getModel()!, 'plaintext');
});

renderSessionList();let currentColumnTemplate = ['220px', '5px', '1fr', '5px', '1fr'];

function setupPaneResize(handleId: string, columnIndex: number, minWidth: number) {
  const handle = document.getElementById(handleId)!;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const app = document.getElementById('app')!;
    const startX = e.clientX;
    // Only read the starting width of the column actually being dragged.
    // Reading/pinning ALL columns here would destroy the editor column's
    // 1fr flexibility on the very first drag, causing it to stop
    // absorbing remaining space and instead shift/shrink unexpectedly
    // whenever the OTHER handle was dragged afterward.
    const startWidth = parseFloat(getComputedStyle(app).gridTemplateColumns.split(' ')[columnIndex]);
    handle.classList.add('dragging');

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(minWidth, startWidth + delta);
      currentColumnTemplate[columnIndex] = `${newWidth}px`;
      app.style.gridTemplateColumns = currentColumnTemplate.join(' ');
      refitActiveTerminal();
    };
    const onMouseUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

setupPaneResize('resize-sidebar', 0, 150);
setupPaneResize('resize-editor', 2, 200);

renderSessionList();renderSessionList();
SPECTER_EOF_4

echo "Wrote $(wc -l < frontend/src/main.ts) lines to main.ts (expect 2675)"
