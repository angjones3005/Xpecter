//go:build windows

package sshclient

import (
	"fmt"
	"net"
	"os"

	"github.com/Microsoft/go-winio"
)

var sshAgentPipes = []string{
	`\\.\pipe\openssh-ssh-agent`,
	`\\.\pipe\pageant`,
}

func dialSSHAgent() (net.Conn, error) {
	candidates := make([]string, 0, len(sshAgentPipes)+1)
	if socket := os.Getenv("SSH_AUTH_SOCK"); socket != "" {
		candidates = append(candidates, socket)
	}
	candidates = append(candidates, sshAgentPipes...)

	var lastErr error
	for _, pipe := range candidates {
		conn, err := winio.DialPipe(pipe, nil)
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("connecting to Windows SSH agent or Pageant: %w", lastErr)
}
