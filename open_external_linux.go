//go:build linux

package main

import (
	"net/url"
	"os/exec"
	"path/filepath"
)

func openExternalPath(path string) error {
	return exec.Command("xdg-open", path).Start()
}

// revealInFileManager opens a folder in the desktop's file manager, or
// that folder with a file selected. Selecting goes through the
// org.freedesktop.FileManager1 D-Bus interface, which Nautilus, Dolphin,
// Nemo and Thunar all implement; a desktop without it, or without
// dbus-send, gets the containing folder instead.
func revealInFileManager(path string, isDir bool) error {
	if isDir {
		return exec.Command("xdg-open", path).Start()
	}
	uri := (&url.URL{Scheme: "file", Path: path}).String()
	show := exec.Command("dbus-send", "--session", "--print-reply", "--reply-timeout=2000",
		"--dest=org.freedesktop.FileManager1", "/org/freedesktop/FileManager1",
		"org.freedesktop.FileManager1.ShowItems", "array:string:"+uri, "string:")
	if err := show.Run(); err == nil {
		return nil
	}
	return exec.Command("xdg-open", filepath.Dir(path)).Start()
}
