//go:build !windows && !darwin && !linux

package main

import "fmt"

func openExternalPath(path string) error {
	return fmt.Errorf("opening files externally is unsupported on this platform: %s", path)
}

func revealInFileManager(path string, isDir bool) error {
	return fmt.Errorf("opening a file manager is unsupported on this platform: %s", path)
}
