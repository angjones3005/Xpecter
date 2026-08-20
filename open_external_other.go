//go:build !windows && !darwin && !linux

package main

import "fmt"

func openExternalPath(path string) error {
	return fmt.Errorf("opening files externally is unsupported on this platform: %s", path)
}
