package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"xpecter/backend/idgen"
	"xpecter/backend/sftpclient"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// --- Saving a file the login user cannot write ---
//
// SFTP runs as the user who logged in, so a file in /etc fails at save
// with "permission denied" and the only way round it was a terminal
// and sudo. This is that workaround, done for you: the buffer goes to a
// temporary file the user can write, and one sudo command copies it
// over the target. cat into the existing file, rather than mv over it,
// keeps the target's owner, mode and inode, so a config file stays a
// config file and a running daemon keeps its handle on it.

// shQuote is a POSIX single-quoted string: the one quoting the shell
// reads literally, with a quote inside it spelled '\” (close, an
// escaped quote, reopen).
func shQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// sudoCopyCommand is the command run as root. -S reads the password
// from stdin, -p ” asks for it silently; a NOPASSWD rule never reads
// it at all. The temporary file is removed whether or not the copy
// succeeded.
func sudoCopyCommand(tmpPath, target string) string {
	script := fmt.Sprintf("cat %s > %s; status=$?; rm -f %s; exit $status", shQuote(tmpPath), shQuote(target), shQuote(tmpPath))
	return "sudo -S -p '' sh -c " + shQuote(script)
}

// SaveRemoteFileAsRoot writes content to path on the host of id with
// root's permissions, via sudo. sudoPassword is the login user's
// password, which sudo asks for; it is sent once and not kept.
func (a *App) SaveRemoteFileAsRoot(id string, path string, content string, sudoPassword string) error {
	sess, err := a.session(id)
	if err != nil {
		return err
	}
	if strings.TrimSpace(path) == "" {
		return errors.New("a path is required")
	}
	client := sess.SSHClient()
	tmpPath := "/tmp/.xpecter-sudo-" + idgen.New()
	if err := stagePrivateFile(client, tmpPath, content); err != nil {
		return fmt.Errorf("could not stage the file on the host: %w", err)
	}
	if err := runSudoCopy(client, tmpPath, path, sudoPassword); err != nil {
		// Best-effort tidy-up: the script removes it on its own path,
		// this covers sudo never having run.
		_ = sftpclient.Remove(client, tmpPath, false)
		return err
	}
	return nil
}

// stagePrivateFile writes content to a new file only its owner can
// read. The buffer may be /etc/shadow or a private key, and an SFTP
// server creates files under its umask, which is world-readable almost
// everywhere; the mode is fixed before a byte of content is written.
func stagePrivateFile(client *ssh.Client, tmpPath, content string) error {
	c, err := sftp.NewClient(client)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()
	f, err := c.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return err
	}
	if err := c.Chmod(tmpPath, 0o600); err != nil {
		_ = f.Close()
		_ = c.Remove(tmpPath)
		return err
	}
	if _, err := f.Write([]byte(content)); err != nil {
		_ = f.Close()
		_ = c.Remove(tmpPath)
		return err
	}
	return f.Close()
}

// runSudoCopy runs the copy in its own SSH session with a PTY, because
// sudo on a host with "Defaults requiretty" refuses to run without
// one. The password goes in on stdin, which is the PTY, and the echo is
// turned off so it never appears in the output.
func runSudoCopy(client *ssh.Client, tmpPath, target, sudoPassword string) error {
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer func() { _ = session.Close() }()
	modes := ssh.TerminalModes{ssh.ECHO: 0}
	if err := session.RequestPty("dumb", 24, 80, modes); err != nil {
		return err
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		return err
	}
	var output bytes.Buffer
	session.Stdout = &output
	session.Stderr = &output
	if err := session.Start(sudoCopyCommand(tmpPath, target)); err != nil {
		return err
	}
	// The password is written after a beat, once sudo is listening,
	// followed by an end-of-file. A wrong password makes sudo prompt
	// again, and the EOF is what makes it give up there and then rather
	// than sit on the PTY until the timeout below. A host with NOPASSWD
	// reads neither.
	go func() {
		time.Sleep(300 * time.Millisecond)
		_, _ = stdin.Write([]byte(sudoPassword + "\n\x04"))
	}()
	done := make(chan error, 1)
	go func() { done <- session.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("sudo failed: %s", sudoFailureText(output.String(), err))
		}
		return nil
	case <-time.After(30 * time.Second):
		return errors.New("sudo did not finish within 30 seconds")
	}
}

// sudoFailureText makes sudo's own complaint readable: a rejected
// password in plain words, otherwise the last non-empty line of what it
// printed, or the exit error when it printed nothing.
func sudoFailureText(output string, err error) string {
	if strings.Contains(output, "Sorry, try again") || strings.Contains(output, "incorrect password attempt") {
		return "the password was not accepted"
	}
	lines := strings.Split(strings.ReplaceAll(output, "\r", ""), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return err.Error()
}
