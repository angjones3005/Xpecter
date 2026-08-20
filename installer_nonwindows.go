//go:build !windows

package main

import "os/exec"

func launchInstaller(path string) error {
	return exec.Command(path).Start()
}
