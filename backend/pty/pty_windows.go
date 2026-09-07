//go:build windows

package pty

import (
	"os"
	"os/exec"

	"github.com/UserExistsError/conpty"
)

// ConPTY requires Windows 10 1809 (build 17763) or newer. On older Windows
// this will fail to start; there's no good fallback short of bundling a
// third-party PTY layer, which isn't worth it given how old that Windows
// build cutoff is at this point.

type windowsTerminal struct {
	cpty *conpty.ConPty
}

// defaultShell picks what a local shell opens when nothing named one.
//
// SPE-131: this used to read COMSPEC, which on every Windows install is
// cmd.exe, so "New Local Shell", Tools > Terminal, and any saved
// profile with an empty command all opened a Command Prompt, sitting
// next to a menu that already offers Command Prompt explicitly. Nothing
// said which you had: a saved profile could carry a PowerShell icon and
// still open cmd, and pasting a PowerShell one-liner into it fails with
// something as unhelpful as ")) was unexpected at this time."
//
// pwsh.exe first, for anyone with PowerShell 7 installed. powershell.exe
// next, which ships with every supported Windows. COMSPEC only after
// both of those are missing, which in practice means a machine with no
// PowerShell at all. Choosing cmd is still possible, it just has to be
// chosen now rather than arrived at.
//
// LookPath rather than a bare name so the resolved path is what conpty
// starts, and so a missing pwsh is detected here rather than becoming a
// failed spawn later.
func defaultShell() string {
	for _, candidate := range []string{"pwsh.exe", "powershell.exe"} {
		if resolved, err := exec.LookPath(candidate); err == nil {
			return resolved
		}
	}
	if comspec := os.Getenv("COMSPEC"); comspec != "" {
		return comspec
	}
	return "cmd.exe"
}

func newPlatformTerminal(onData func([]byte), shell string, dir string, cols int, rows int) (terminalImpl, error) {
	if shell == "" {
		shell = defaultShell()
	}

	// The UserExistsError/conpty wrapper doesn't expose a per-process
	// environment option, so this sets TERM/COLORTERM on Xpecter's own
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

	// Sized explicitly. conpty.Start otherwise uses its own
	// defaultConsoleWidth of 80, and the shell believes that for the
	// whole session unless something later happens to resize it.
	opts := []conpty.ConPtyOption{conpty.ConPtyDimensions(cols, rows)}
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
