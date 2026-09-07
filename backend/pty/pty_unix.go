//go:build !windows

package pty

import (
	"os"
	"os/exec"
	"strings"

	"github.com/creack/pty"
)

type unixTerminal struct {
	f   *os.File
	cmd *exec.Cmd
}

func newPlatformTerminal(onData func([]byte), shell string, dir string, cols int, rows int) (terminalImpl, error) {
	if shell == "" {
		shell = os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/bash"
		}
	}

	// shell may be a full command line (e.g. "/bin/bash --login", or a
	// saved local shell profile's Command field, SPE-102), not just a
	// bare executable. exec.Command needs the executable and its
	// arguments split apart; ConPTY on Windows (pty_windows.go) already
	// accepts a full command line natively, so this split is Unix-only.
	// Whitespace-only split, no quoted-argument support yet: sufficient
	// for every command shipped so far, documented v1 limitation.
	parts := strings.Fields(shell)
	if len(parts) == 0 {
		// Guards against a profile saved with a blank/whitespace-only
		// Command; fail toward the same safe default as an empty shell.
		parts = []string{"/bin/bash"}
	}
	cmd := exec.Command(parts[0], parts[1:]...)
	// Dir is a standard os/exec.Cmd field, empty string means "inherit
	// the current process's working directory", exec's own documented
	// default, so leaving dir unset here behaves identically to before
	// this option existed.
	cmd.Dir = dir
	// See withColorEnv in pty.go: matches the color-capable terminal
	// identity SSH sessions already get explicitly.
	cmd.Env = withColorEnv(os.Environ())
	// StartWithSize rather than Start: an unsized PTY comes up 0x0, and
	// a shell that queries it before the first resize arrives lays its
	// output out against nothing. Same reasoning as the ConPTY side,
	// where the default is 80 rather than 0 but just as wrong.
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, err
	}

	t := &unixTerminal{f: f, cmd: cmd}

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := f.Read(buf)
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

	return t, nil
}

func (t *unixTerminal) Write(data []byte) error {
	_, err := t.f.Write(data)
	return err
}

func (t *unixTerminal) Resize(cols, rows int) error {
	return pty.Setsize(t.f, &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	})
}

func (t *unixTerminal) Close() error {
	_ = t.f.Close()
	if t.cmd.Process != nil {
		return t.cmd.Process.Kill()
	}
	return nil
}
