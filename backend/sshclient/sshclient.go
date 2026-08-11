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
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type Config struct {
	Host     string
	Port     int
	User     string
	Password string
	KeyPath  string
}

type Session struct {
	id     string
	client *ssh.Client
	sess   *ssh.Session
	stdin  io.WriteCloser
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

// pendingKeys caches the offending public key by hostname between the
// failed Connect attempt and the frontend's trust decision, so we don't
// need to round-trip raw key bytes through the JS bridge.
var (
	pendingKeysMu sync.Mutex
	pendingKeys   = map[string]pendingKey{}
)

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
		f.Close()
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
	defer f.Close()
	_, err = f.WriteString(line + "\n")
	return err
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
		key, err := os.ReadFile(cfg.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("reading key: %w", err)
		}
		signer, err := ssh.ParsePrivateKey(key)
		if err != nil {
			return nil, fmt.Errorf("parsing key: %w", err)
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
	if err != nil {
		return nil, err
	}

	return &Session{id: newID(), client: client}, nil
}

func (s *Session) ID() string             { return s.id }
func (s *Session) SSHClient() *ssh.Client { return s.client }

func (s *Session) StartShell(onData func([]byte)) error {
	sess, err := s.client.NewSession()
	if err != nil {
		return err
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
	if err := sess.RequestPty("xterm-256color", 40, 120, modes); err != nil {
		sess.Close()
		return err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		return err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		return err
	}
	if err := sess.Shell(); err != nil {
		sess.Close()
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
	if s.sess != nil {
		s.sess.Close()
	}
	return s.client.Close()
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
