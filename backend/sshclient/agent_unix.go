//go:build !windows

package sshclient

import (
	"fmt"
	"net"
	"os"
)

func dialSSHAgent() (net.Conn, error) {
	socket := os.Getenv("SSH_AUTH_SOCK")
	if socket == "" {
		return nil, fmt.Errorf("SSH agent requested but SSH_AUTH_SOCK is not set")
	}
	conn, err := net.Dial("unix", socket)
	if err != nil {
		return nil, fmt.Errorf("connecting to SSH agent at %s: %w", socket, err)
	}
	return conn, nil
}
