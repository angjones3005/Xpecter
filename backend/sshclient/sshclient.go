// Package sshclient wraps golang.org/x/crypto/ssh to provide an
// interactive shell session, with real host key verification against the
// user's standard ~/.ssh/known_hosts file (no more InsecureIgnoreHostKey).
package sshclient

import (
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
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"

	"xpecter/backend/idgen"
)

var ErrPassphraseRequired = errors.New("private key is encrypted, passphrase required")

type Config struct {
	Host          string
	Port          int
	User          string
	Password      string
	KeyPath       string
	Passphrase    string
	UseAgent      bool
	InternalAgent bool
	X11           bool
	// IgnoreKeyPermWarning skips the KeyPermissionWarning check below,
	// set only after the user has explicitly acknowledged it once
	// (SPE-65). Xpecter didn't create the user's key file, so this is a
	// soft warning with real user choice, not a hard block like OpenSSH
	// itself does.
	IgnoreKeyPermWarning bool
	// DisableKeepalive turns off the periodic no-op probe (SPE-79),
	// read from the persisted Settings.SSHKeepaliveDisabled preference
	// at connect time in app.go's Connect(), not something the caller
	// usually sets directly.
	DisableKeepalive bool
	// JumpHost, when set, is a bastion to tunnel through, in OpenSSH's
	// ProxyJump spelling ("[user@]host[:port]"). The target is dialled
	// over an SSH channel on the jump host rather than reached directly,
	// so a machine only visible from the bastion becomes reachable. Empty
	// is an ordinary direct connection. One hop; the same credentials are
	// offered to both the bastion and the target.
	JumpHost string
	// TerminalSpeed sets the PTY's input and output baud (ispeed/ospeed
	// in the pty-req). SSH is not itself rate-limited by it, but some
	// console servers and serial-bridging setups read it and behave
	// differently — it is the honest analogue of a serial baud rate. 0
	// means the long-standing default of 14400.
	TerminalSpeed int
}

type Session struct {
	id        string
	client    *ssh.Client
	sess      *ssh.Session
	stdin     io.WriteCloser
	agentConn net.Conn
	closing   atomic.Bool
	// usedLegacyCompat records whether this session had to fall back to
	// the widened SPE-99 algorithm set to connect, exposed via
	// UsedLegacyCompat() below.
	usedLegacyCompat bool
	// termSpeed is Config.TerminalSpeed carried to StartShell, where the
	// pty-req is actually built.
	termSpeed int
	// jumpClient is the bastion connection this session tunnels through,
	// held so it can be torn down with the session. nil for a direct
	// connection.
	jumpClient *ssh.Client
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
// a key under. Xpecter treats it as a soft warning rather than a hard
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
	pendingKeysMu        sync.Mutex
	pendingKeys          = map[string]pendingKey{}
	internalAgentMu      sync.Mutex
	internalAgentSigners = map[string]ssh.Signer{}
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
	if cfg.InternalAgent && cfg.KeyPath == "" {
		return nil, fmt.Errorf("xpecter internal SSH agent requires a private key path")
	}
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
		var signer ssh.Signer
		if cfg.InternalAgent {
			internalAgentMu.Lock()
			signer = internalAgentSigners[cfg.KeyPath]
			internalAgentMu.Unlock()
		}
		if signer == nil {
			key, err := os.ReadFile(cfg.KeyPath)
			if err != nil {
				return nil, fmt.Errorf("reading key: %w", err)
			}
			signer, err = ssh.ParsePrivateKey(key)
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
			if cfg.InternalAgent {
				internalAgentMu.Lock()
				internalAgentSigners[cfg.KeyPath] = signer
				internalAgentMu.Unlock()
			}
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}
	if cfg.Password != "" {
		authMethods = append(authMethods, ssh.Password(cfg.Password))
	}
	var agentConn net.Conn
	if cfg.UseAgent {
		var err error
		agentConn, err = dialSSHAgent()
		if err != nil {
			return nil, err
		}
		agentClient := agent.NewClient(agentConn)
		authMethods = append(authMethods, ssh.PublicKeysCallback(agentClient.Signers))
	}

	hkCallback, err := hostKeyCallback()
	if err != nil {
		if agentConn != nil {
			_ = agentConn.Close()
		}
		return nil, fmt.Errorf("setting up host key verification: %w", err)
	}

	sshCfg := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            authMethods,
		Timeout:         10 * time.Second,
		HostKeyCallback: hkCallback,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))

	// A plain TCP dial. The target uses this directly, or through the
	// jump host's tunnel below; either way establish() wraps it with the
	// SPE-99 legacy-algorithm fallback, so bastion and target each get
	// that fallback on their own terms.
	directDial := func(a string, c *ssh.ClientConfig) (*ssh.Client, error) {
		return ssh.Dial("tcp", a, c)
	}

	var jump *ssh.Client
	dialTarget := directDial
	if strings.TrimSpace(cfg.JumpHost) != "" {
		juser, jaddr := parseJumpHost(cfg.JumpHost, cfg.User)
		jumpCfg := &ssh.ClientConfig{
			User:    juser,
			Auth:    authMethods,
			Timeout: 10 * time.Second,
			// The bastion is verified against known_hosts exactly like
			// the target: an unknown bastion key raises the same
			// HostKeyUnknownError, and the existing trust prompt names
			// the bastion, so trusting it and retrying just works.
			HostKeyCallback: hkCallback,
		}
		var jerr error
		jump, _, jerr = establish(jaddr, jumpCfg, directDial)
		if jerr != nil {
			if agentConn != nil {
				_ = agentConn.Close()
			}
			// Wrapped with %w so the frontend's errors.As still finds a
			// HostKeyUnknownError inside and routes it to the trust flow.
			return nil, fmt.Errorf("jump host %s: %w", jaddr, jerr)
		}
		dialTarget = func(a string, c *ssh.ClientConfig) (*ssh.Client, error) {
			conn, err := jump.Dial("tcp", a)
			if err != nil {
				return nil, err
			}
			ncc, chans, reqs, err := ssh.NewClientConn(conn, a, c)
			if err != nil {
				_ = conn.Close()
				return nil, err
			}
			return ssh.NewClient(ncc, chans, reqs), nil
		}
	}

	client, usedLegacyCompat, err := establish(addr, sshCfg, dialTarget)
	if err != nil {
		if jump != nil {
			_ = jump.Close()
		}
		if agentConn != nil {
			_ = agentConn.Close()
		}
		return nil, err
	}

	sess := &Session{
		id: idgen.New(), client: client, agentConn: agentConn,
		usedLegacyCompat: usedLegacyCompat, termSpeed: cfg.TerminalSpeed, jumpClient: jump,
	}
	if !cfg.DisableKeepalive {
		go sess.keepaliveLoop()
	}
	return sess, nil
}

// establish connects an SSH client to addr with cfg, and on an algorithm
// negotiation failure retries once with the widened SPE-99 algorithm set,
// returning whether that fallback was used. dial is how the raw
// connection is made — straight TCP, or through a jump host — so both
// hops share one definition of "connect, with the old-device fallback".
func establish(addr string, cfg *ssh.ClientConfig, dial func(string, *ssh.ClientConfig) (*ssh.Client, error)) (*ssh.Client, bool, error) {
	client, err := dial(addr, cfg)
	if err == nil {
		return client, false, nil
	}
	var algErr *ssh.AlgorithmNegotiationError
	if errors.As(err, &algErr) {
		// The library's own modern and insecure lists, combined rather
		// than hardcoded, so the fallback tracks whatever the installed
		// x/crypto/ssh actually implements. Modern first, so a peer that
		// supports them still gets them.
		supported := ssh.SupportedAlgorithms()
		insecure := ssh.InsecureAlgorithms()
		legacy := *cfg
		legacy.Config = ssh.Config{
			Ciphers:      append(append([]string{}, supported.Ciphers...), insecure.Ciphers...),
			KeyExchanges: append(append([]string{}, supported.KeyExchanges...), insecure.KeyExchanges...),
			MACs:         append(append([]string{}, supported.MACs...), insecure.MACs...),
		}
		legacy.HostKeyAlgorithms = append(append([]string{}, supported.HostKeys...), insecure.HostKeys...)
		client, err = dial(addr, &legacy)
		if err == nil {
			return client, true, nil
		}
	}
	return nil, false, err
}

// parseJumpHost splits OpenSSH's "[user@]host[:port]" ProxyJump spelling
// into a username (the target's, when the spec names none) and a
// host:port with 22 filled in. A bare IPv6 literal must be bracketed to
// carry a port, the same rule OpenSSH itself keeps.
func parseJumpHost(spec, defaultUser string) (user, addr string) {
	user = defaultUser
	host := strings.TrimSpace(spec)
	if at := strings.LastIndex(host, "@"); at >= 0 {
		if u := strings.TrimSpace(host[:at]); u != "" {
			user = u
		}
		host = host[at+1:]
	}
	if _, _, err := net.SplitHostPort(host); err != nil {
		host = net.JoinHostPort(host, "22")
	}
	return user, host
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
func (s *Session) StartShell(cols, rows int, onData func([]byte), onClose func(CloseReason)) error {
	sess, err := s.client.NewSession()
	if err != nil {
		return err
	}
	// ISPEED/OSPEED is the PTY's baud, configurable per session (the SSH
	// analogue of a serial baud rate); 0 keeps the long-standing 14400.
	speed := uint32(s.termSpeed)
	if speed == 0 {
		speed = 14400
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: speed, ssh.TTY_OP_OSPEED: speed}
	// SPE-126: the size the caller actually has on screen, rather than
	// the hardcoded 120x40 this used to request. A lot of remote
	// software reads the PTY size once, when the PTY is allocated, and
	// formats everything it prints for the rest of the session to that
	// number: a FortiGate's `execute dhcp lease-list` decides its column
	// layout there and then. Asking for 120 columns from a window that
	// has 100 meant every wide table came back pre-formatted too wide
	// and wrapped into a mess, and no later window-change could undo
	// that decision, which is why it only looked right maximised.
	// The fallbacks preserve the old numbers for any caller that
	// genuinely has no terminal to measure yet.
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 40
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
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
	// SPE-126: no longer an error. Now that the shell is started
	// separately from the connection, a resize can legitimately arrive
	// in the gap between the two (the frontend fits the pane on its way
	// to measuring it), and there is nothing to report: the size that
	// call carried is the one StartShell is about to request anyway.
	if s.sess == nil {
		return nil
	}
	return s.sess.WindowChange(rows, cols)
}

func (s *Session) Close() error {
	s.closing.Store(true)
	if s.sess != nil {
		_ = s.sess.Close()
	}
	if s.agentConn != nil {
		_ = s.agentConn.Close()
	}
	err := s.client.Close()
	// The bastion outlives the target's channel and has to be closed too,
	// or its TCP connection and goroutines leak for the life of the app.
	if s.jumpClient != nil {
		_ = s.jumpClient.Close()
	}
	return err
}
