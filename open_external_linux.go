//go:build linux

package main

import "os/exec"

func openExternalPath(path string) error {
	return exec.Command("xdg-open", path).Start()
}
