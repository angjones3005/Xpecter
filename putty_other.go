//go:build !windows

package main

import (
	"errors"

	"xpecter/backend/config"
)

func readPuTTYSessions() ([]config.SessionProfile, error) {
	return nil, errors.New("PuTTY keeps its sessions in the Windows registry; import them on the Windows machine and carry them over with Export configuration")
}
