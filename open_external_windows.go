//go:build windows

package main

import "os/exec"

func openExternalPath(path string) error {
	return exec.Command("cmd", "/c", "start", "", path).Start()
}
