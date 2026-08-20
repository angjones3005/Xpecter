//go:build darwin

package main

import "os/exec"

func openExternalPath(path string) error {
	return exec.Command("open", path).Start()
}
