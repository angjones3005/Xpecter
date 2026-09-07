// Package pty spawns a local shell and streams its output, so the same
// terminal component used for SSH sessions can also drive a local tab.
//
// Unix uses github.com/creack/pty. Windows needs ConPTY (Windows 10+)
// via github.com/UserExistsError/conpty; see pty_windows.go, which is
// a stub in this scaffold and needs filling in before a Windows build works.
package pty

import "strings"

type LocalTerminal struct {
	impl terminalImpl
}

type terminalImpl interface {
	Write(data []byte) error
	Resize(cols, rows int) error
	Close() error
}

// Fallbacks for a caller that doesn't know the pane size yet. Only the
// width really matters: a shell lays its output out against the column
// count and gets every subsequent cursor position wrong if that number
// is not the terminal's own. The rows figure is corrected by the first
// resize and nothing reflows on it.
const (
	defaultCols = 200
	defaultRows = 40
)

// New spawns a local shell. If shell is empty, the platform default is
// used (COMSPEC/PowerShell fallback on Windows, $SHELL/bash on Unix).
// A non-empty shell requests a specific executable, e.g. "cmd.exe" or
// "powershell.exe" on Windows, used by the Tools menu's quick launchers.
// If dir is empty, the shell starts in Xpecter's own current working
// directory (each platform's own documented default for an unset
// working directory), same as before this option existed.
//
// cols and rows size the PTY at spawn. They are not optional in
// practice: ConPTY defaults to 80 columns and creack/pty to 0, and a
// shell started at either while the terminal draws 200 lays its
// redraws out against a width the screen does not have. PSReadLine
// wrapping a typed line at column 80 inside a 200-column grid is what
// makes a long or multi-line command overwrite its own prompt. Anything
// <= 0 falls back to the constants above rather than to the library
// default, which is the value that caused that.
func New(onData func([]byte), shell string, dir string, cols int, rows int) (*LocalTerminal, error) {
	if cols <= 0 {
		cols = defaultCols
	}
	if rows <= 0 {
		rows = defaultRows
	}
	impl, err := newPlatformTerminal(onData, shell, dir, cols, rows)
	if err != nil {
		return nil, err
	}
	return &LocalTerminal{impl: impl}, nil
}

func (l *LocalTerminal) Write(data []byte) error     { return l.impl.Write(data) }
func (l *LocalTerminal) Resize(cols, rows int) error { return l.impl.Resize(cols, rows) }
func (l *LocalTerminal) Close() error                { return l.impl.Close() }

// withColorEnv returns env with TERM and COLORTERM added, unless
// already present, so a locally spawned shell gets the same
// color-capable terminal identity that SSH sessions already get
// explicitly (sshclient.go's StartShell calls
// RequestPty("xterm-256color", ...)). Without this, a local shell tab
// just inherits whatever TERM Xpecter's own process happened to have,
// which is often empty when Xpecter's launched from a dock/Start menu
// icon rather than a terminal, silently degrading ls --color, git
// diff, prompt themes, and syntax highlighters to no-color even though
// the same commands look fully colored over SSH. Respects an
// already-set TERM/COLORTERM (e.g. the user's own shell profile)
// rather than clobbering it.
func withColorEnv(env []string) []string {
	hasTerm, hasColorTerm := false, false
	for _, e := range env {
		if strings.HasPrefix(e, "TERM=") {
			hasTerm = true
		}
		if strings.HasPrefix(e, "COLORTERM=") {
			hasColorTerm = true
		}
	}
	if !hasTerm {
		env = append(env, "TERM=xterm-256color")
	}
	if !hasColorTerm {
		env = append(env, "COLORTERM=truecolor")
	}
	return env
}
