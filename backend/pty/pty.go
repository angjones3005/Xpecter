// Package pty spawns a local shell and streams its output, so the same
// terminal component used for SSH sessions can also drive a local tab.
//
// Unix uses github.com/creack/pty. Windows needs ConPTY (Windows 10+)
// via github.com/UserExistsError/conpty; see pty_windows.go, which is
// a stub in this scaffold and needs filling in before a Windows build works.
package pty

type LocalTerminal struct {
	impl terminalImpl
}

type terminalImpl interface {
	Write(data []byte) error
	Resize(cols, rows int) error
	Close() error
}

// New spawns a local shell. If shell is empty, the platform default is
// used (COMSPEC/PowerShell fallback on Windows, $SHELL/bash on Unix).
// A non-empty shell requests a specific executable, e.g. "cmd.exe" or
// "powershell.exe" on Windows, used by the Tools menu's quick launchers.
func New(onData func([]byte), shell string) (*LocalTerminal, error) {
	impl, err := newPlatformTerminal(onData, shell)
	if err != nil {
		return nil, err
	}
	return &LocalTerminal{impl: impl}, nil
}

func (l *LocalTerminal) Write(data []byte) error     { return l.impl.Write(data) }
func (l *LocalTerminal) Resize(cols, rows int) error { return l.impl.Resize(cols, rows) }
func (l *LocalTerminal) Close() error                { return l.impl.Close() }
