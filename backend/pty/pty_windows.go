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
