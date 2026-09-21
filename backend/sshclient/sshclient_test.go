package sshclient

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func newEd25519Key(t *testing.T) ssh.PublicKey {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func newRSAKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	key, err := ssh.NewPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func writeKnownHosts(t *testing.T, lines ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "known_hosts")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func verifierFor(t *testing.T, path string) *hostKeyVerifier {
	t.Helper()
	base, err := knownhosts.New(path)
	if err != nil {
		t.Fatal(err)
	}
	return &hostKeyVerifier{path: path, base: base}
}

// The trust-despite-change override must retire the old key, or both
// stay trusted and the override has changed nothing. The file is
// written as Line() writes it ("host" for port 22, "[host]:2222"
// otherwise) and the callback is asked with the "host:port" address it
// is given at connect time, which is the spelling that never matched
// before.
func TestStaleHostLinesFindsTheOldKeyForEverySpelling(t *testing.T) {
	old := newEd25519Key(t)
	fresh := newEd25519Key(t)
	other := newEd25519Key(t)
	hashed := knownhosts.HashHostname("[hashed.example]:2222")
	path := writeKnownHosts(t,
		"# a comment",
		knownhosts.Line([]string{"plain.example:22"}, old),
		knownhosts.Line([]string{"ported.example:2222"}, old),
		"plain.example,10.0.0.5 "+strings.TrimPrefix(knownhosts.Line([]string{"x:22"}, old), "x "),
		hashed+" "+strings.TrimPrefix(knownhosts.Line([]string{"x:22"}, old), "x "),
		"*.example "+strings.TrimPrefix(knownhosts.Line([]string{"x:22"}, old), "x "),
		knownhosts.Line([]string{"untouched.example:22"}, other),
	)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]int{
		"plain.example:22":    {2, 4},
		"ported.example:2222": {3},
		"hashed.example:2222": {5},
	}
	for hostname, want := range cases {
		stale, err := staleHostLines(path, string(data), hostname, pendingKey{key: fresh, addr: "10.0.0.5:22"})
		if err != nil {
			t.Fatalf("%s: %v", hostname, err)
		}
		if len(stale) != len(want) {
			t.Errorf("%s: stale lines %v, want %v", hostname, stale, want)
			continue
		}
		for _, line := range want {
			if !stale[line] {
				t.Errorf("%s: line %d not marked stale (got %v)", hostname, line, stale)
			}
		}
	}
	// The wildcard line matched plain.example too, and must be kept.
	stale, _ := staleHostLines(path, string(data), "plain.example:22", pendingKey{key: fresh, addr: "10.0.0.5:22"})
	if stale[6] {
		t.Error("a wildcard line was retired for one host's changed key")
	}
	// A key that is already on record has nothing to retire.
	stale, _ = staleHostLines(path, string(data), "untouched.example:22", pendingKey{key: other, addr: "10.0.0.6:22"})
	if len(stale) != 0 {
		t.Errorf("an already-trusted key retired lines %v", stale)
	}
}

func TestAppendKnownHostsLine(t *testing.T) {
	got := appendKnownHostsLine("one\ntwo\nthree\n", map[int]bool{2: true}, "new")
	if got != "one\nthree\nnew\n" {
		t.Errorf("with a stale line: %q", got)
	}
	// No trailing newline on the last line used to glue the new entry
	// onto it, corrupting both.
	got = appendKnownHostsLine("one\ntwo", nil, "new")
	if got != "one\ntwo\nnew\n" {
		t.Errorf("without a trailing newline: %q", got)
	}
	if got := appendKnownHostsLine("", nil, "new"); got != "new\n" {
		t.Errorf("empty file: %q", got)
	}
	if got := appendKnownHostsLine("one\n\n\n", nil, "new"); got != "one\nnew\n" {
		t.Errorf("trailing blank lines: %q", got)
	}
}

// An RSA key on record and an ed25519 key offered is a key this machine
// has not seen, not a changed key. Reporting it as changed put the MITM
// warning in front of a perfectly good server, and the override then
// left both keys trusted.
func TestCallbackTreatsADifferentKeyTypeAsUnknown(t *testing.T) {
	rsaKey := newRSAKey(t)
	path := writeKnownHosts(t, knownhosts.Line([]string{"host.example:22"}, rsaKey))
	v := verifierFor(t, path)
	cb := v.callback()
	remote := &net.TCPAddr{IP: net.IPv4(10, 0, 0, 5), Port: 22}

	err := cb("host.example:22", remote, newEd25519Key(t))
	var unknown *HostKeyUnknownError
	if !errors.As(err, &unknown) {
		t.Fatalf("a new key type was reported as %T (%v), want HostKeyUnknownError", err, err)
	}

	err = cb("host.example:22", remote, newRSAKey(t))
	var changed *HostKeyChangedError
	if !errors.As(err, &changed) {
		t.Fatalf("a different RSA key was reported as %T (%v), want HostKeyChangedError", err, err)
	}

	if err := cb("host.example:22", remote, rsaKey); err != nil {
		t.Fatalf("the recorded key was refused: %v", err)
	}
	pendingKeysMu.Lock()
	delete(pendingKeys, "host.example:22")
	pendingKeysMu.Unlock()
}

func TestRecordedKeyTypesAndAlgorithmOrder(t *testing.T) {
	rsaKey := newRSAKey(t)
	path := writeKnownHosts(t,
		knownhosts.Line([]string{"rsa.example:22"}, rsaKey),
		knownhosts.Line([]string{"[both.example]:2222"}, newEd25519Key(t)),
		knownhosts.Line([]string{"[both.example]:2222"}, rsaKey),
	)
	v := verifierFor(t, path)

	if got := v.recordedKeyTypes("rsa.example:22"); len(got) != 1 || got[0] != ssh.KeyAlgoRSA {
		t.Errorf("recordedKeyTypes(rsa) = %v", got)
	}
	if got := v.recordedKeyTypes("both.example:2222"); len(got) != 2 || got[0] != ssh.KeyAlgoED25519 || got[1] != ssh.KeyAlgoRSA {
		t.Errorf("recordedKeyTypes(both) = %v", got)
	}
	if got := v.recordedKeyTypes("nobody.example:22"); len(got) != 0 {
		t.Errorf("recordedKeyTypes(unknown host) = %v, want none", got)
	}
	// The probe key must never end up in the trust prompt's cache.
	pendingKeysMu.Lock()
	_, leaked := pendingKeys["nobody.example:22"]
	pendingKeysMu.Unlock()
	if leaked {
		t.Error("recordedKeyTypes left a pending key behind")
	}

	pool := ssh.SupportedAlgorithms().HostKeys
	algos := hostKeyAlgorithms([]string{ssh.KeyAlgoRSA}, pool)
	if algos[0] != ssh.KeyAlgoRSASHA512 || algos[1] != ssh.KeyAlgoRSASHA256 {
		t.Errorf("an RSA host does not lead with the SHA-2 RSA algorithms: %v", algos)
	}
	if len(algos) != len(pool) {
		t.Errorf("hostKeyAlgorithms changed the set: got %d algorithms, pool has %d", len(algos), len(pool))
	}
	for _, alg := range algos {
		if alg == ssh.KeyAlgoRSA {
			t.Errorf("SHA-1 RSA was offered although it is not in the pool: %v", algos)
		}
	}
	// Nothing on record: the pool in its own order.
	plain := hostKeyAlgorithms(nil, pool)
	for i := range pool {
		if plain[i] != pool[i] {
			t.Fatalf("with nothing recorded the order changed: %v", plain)
		}
	}
}

func TestKnownHostsLineIsWildcard(t *testing.T) {
	cases := map[string]bool{
		"*.example ssh-ed25519 AAAA":                 true,
		"host?.example ssh-ed25519 AAAA":             true,
		"host.example,10.0.0.5 ssh-ed25519 AAAA":     false,
		"|1|c2FsdA==|aGFzaA== ssh-ed25519 AAAA":      false,
		"@cert-authority *.example ssh-ed25519 AAAA": true,
		"@revoked host.example ssh-ed25519 AAAA":     false,
		"":                                           false,
		"[host.example]:2222 ssh-ed25519 AAAA":       false,
	}
	for line, want := range cases {
		if got := knownHostsLineIsWildcard(line); got != want {
			t.Errorf("knownHostsLineIsWildcard(%q) = %v, want %v", line, got, want)
		}
	}
}

// A keepalive tear-down is the drop the disconnect panel exists for; it
// must not be reported as the user's own close.
func TestCloseReasonNamesAKeepaliveDrop(t *testing.T) {
	s := &Session{}
	s.dropped.Store(true)
	reason := s.closeReason(errors.New("read: connection reset"))
	if reason.Deliberate {
		t.Fatal("a keepalive drop was reported as deliberate")
	}
	if !errors.Is(reason.Err, ErrKeepaliveTimeout) {
		t.Fatalf("Err = %v, want ErrKeepaliveTimeout", reason.Err)
	}
	if reason.EOF {
		t.Fatal("a keepalive drop was reported as a clean EOF")
	}

	closed := &Session{}
	closed.closing.Store(true)
	if reason := closed.closeReason(errors.New("closed")); !reason.Deliberate {
		t.Fatal("a Close() was not reported as deliberate")
	}
}

// Close after the transport has already gone must succeed, and a
// second Close must be a no-op, or a dead session's tab cannot be
// closed at all.
func TestCloseTolerantOfADeadTransportAndRepeatable(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	_ = serverConn.Close()
	_ = clientConn.Close()
	// An ssh.Client over a closed pipe: Close returns net.ErrClosed
	// from the connection underneath, which is what a dropped session
	// looks like.
	client := &ssh.Client{Conn: closedConn{clientConn}}
	s := &Session{client: client}
	if err := s.Close(); err != nil {
		t.Fatalf("Close on a dead transport: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	if !s.closing.Load() {
		t.Fatal("closing not set")
	}
}

// closedConn is the least ssh.Conn that reports a closed transport.
type closedConn struct{ net.Conn }

func (c closedConn) User() string          { return "" }
func (c closedConn) SessionID() []byte     { return nil }
func (c closedConn) ClientVersion() []byte { return nil }
func (c closedConn) ServerVersion() []byte { return nil }
func (c closedConn) Close() error          { return c.Conn.Close() }
func (c closedConn) Wait() error           { return nil }
func (c closedConn) SendRequest(string, bool, []byte) (bool, []byte, error) {
	return false, nil, net.ErrClosed
}
func (c closedConn) OpenChannel(string, []byte) (ssh.Channel, <-chan *ssh.Request, error) {
	return nil, nil, net.ErrClosed
}

// A peer that accepts the TCP connection and never speaks used to hold
// Connect forever. The handshake is bounded.
func TestHandshakeGivesUpOnASilentPeer(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer func() { _ = serverConn.Close() }()
	cfg := &ssh.ClientConfig{HostKeyCallback: ssh.InsecureIgnoreHostKey()}
	done := make(chan error, 1)
	go func() {
		_, err := handshakeWithin(clientConn, "silent:22", cfg, 200*time.Millisecond)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "did not complete") {
			t.Fatalf("err = %v, want a handshake timeout", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("handshake never returned")
	}
}

func TestPasswordAsKeyboardInteractiveAnswersEveryPrompt(t *testing.T) {
	// The AuthMethod is opaque; the challenge it wraps is what matters.
	answers, err := keyboardInteractiveAnswers("s3cret")("", "", []string{"Password:", "Verification code:"}, []bool{false, false})
	if err != nil {
		t.Fatal(err)
	}
	if len(answers) != 2 || answers[0] != "s3cret" || answers[1] != "s3cret" {
		t.Fatalf("answers = %v", answers)
	}
}

func TestParseJumpHost(t *testing.T) {
	cases := map[string][2]string{
		"bastion":                 {"me", "bastion:22"},
		"ops@bastion":             {"ops", "bastion:22"},
		"ops@bastion:2222":        {"ops", "bastion:2222"},
		"[fe80::1]:2222":          {"me", "[fe80::1]:2222"},
		"  ops@bastion.example  ": {"ops", "bastion.example:22"},
	}
	for spec, want := range cases {
		user, addr := parseJumpHost(spec, "me")
		if user != want[0] || addr != want[1] {
			t.Errorf("parseJumpHost(%q) = %q, %q; want %q, %q", spec, user, addr, want[0], want[1])
		}
	}
}
