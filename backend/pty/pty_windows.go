//go:build windows

package pty

import (
	"os"

	"github.com/UserExistsError/conpty"
)

// ConPTY requires Windows 10 1809 (build 17763) or newer. On older Windows
// this will fail to start; there's no good fallback short of bundling a
// third-party PTY layer, which isn't worth it given how old that Windows
// build cutoff is at this point.

type windowsTerminal struct {
	cpty *conpty.ConPty
}

func newPlatformTerminal(onData func([]byte), shell string, dir string) (terminalImpl, error) {
	if shell == "" {
		shell = os.Getenv("COMSPEC")
		if shell == "" {
			shell = "powershell.exe"
		}
	}

	// The UserExistsError/conpty wrapper doesn't expose a per-process
	// environment option, so this sets TERM/COLORTERM on Specter's own
	// process instead, once per call is harmless. ConPTY-spawned
	// children inherit the parent's environment by default (the same
	// CreateProcess behavior os/exec relies on when Env is left unset
	// on Unix, see withColorEnv in pty.go), so this should reach the
	// child shell the same way. PowerShell/cmd.exe don't gate their own
	// native coloring on TERM, this mainly matters for tools that do
	// check it when run inside a local shell tab (WSL bash, git-bash,
	// etc.). Confirm on a real Windows build before relying on this,
	// the wrapper's actual behavior here wasn't verifiable offline.
	if os.Getenv("TERM") == "" {
		_ = os.Setenv("TERM", "xterm-256color")
	}
	if os.Getenv("COLORTERM") == "" {
		_ = os.Setenv("COLORTERM", "truecolor")
	}

	var opts []conpty.ConPtyOption
	if dir != "" {
		opts = append(opts, conpty.ConPtyWorkDir(dir))
	}
	cpty, err := conpty.Start(shell, opts...)
	if err != nil {
		return nil, err
	}

	t := &windowsTerminal{cpty: cpty}

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := cpty.Read(buf)
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

func (t *windowsTerminal) Write(data []byte) error {
	_, err := t.cpty.Write(data)
	return err
}

func (t *windowsTerminal) Resize(cols, rows int) error {
	return t.cpty.Resize(cols, rows)
}

func (t *windowsTerminal) Close() error {
	return t.cpty.Close()
}
