//go:build !windows

package pty

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type unixTerminal struct {
	f   *os.File
	cmd *exec.Cmd
}

func newPlatformTerminal(onData func([]byte)) (terminalImpl, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	cmd := exec.Command(shell)
	f, err := pty.Start(cmd)
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
	t.f.Close()
	if t.cmd.Process != nil {
		return t.cmd.Process.Kill()
	}
	return nil
}
