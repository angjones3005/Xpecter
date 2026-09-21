//go:build darwin

package main

import "os/exec"

func openExternalPath(path string) error {
	return exec.Command("open", path).Start()
}

// revealInFileManager opens a folder in Finder, or reveals a file in
// its folder: `open -R` is Finder's own "reveal".
func revealInFileManager(path string, isDir bool) error {
	if isDir {
		return exec.Command("open", path).Start()
	}
	return exec.Command("open", "-R", path).Start()
}
