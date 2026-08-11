// Package sshclient wraps golang.org/x/crypto/ssh to provide an
// interactive shell session suitable for streaming to a frontend terminal.
package sshclient

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"os"
	"time"

	"golang.org/x/crypto/ssh"
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

	sshCfg := &ssh.ClientConfig{
		User:    cfg.User,
		Auth:    authMethods,
		Timeout: 10 * time.Second,
		// NOTE: replace with a real known_hosts callback before shipping.
		// InsecureIgnoreHostKey is fine for local scaffolding only.
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	client, err := ssh.Dial("tcp", addr, sshCfg)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}

	return &Session{id: newID(), client: client}, nil
}

func (s *Session) ID() string {
	return s.id
}

func (s *Session) SSHClient() *ssh.Client {
	return s.client
}

// StartShell opens an interactive PTY-backed shell and calls onData for
// every chunk of output produced by the remote shell.
func (s *Session) StartShell(onData func([]byte)) error {
	sess, err := s.client.NewSession()
	if err != nil {
		return err
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
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
