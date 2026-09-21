//go:build windows

package main

import "testing"

func TestExplorerSelectCommandLine(t *testing.T) {
	got := explorerSelectCommandLine(`C:\Users\me\Notes and things\todo.md`)
	want := `explorer.exe /select,"C:\Users\me\Notes and things\todo.md"`
	if got != want {
		t.Fatalf("explorerSelectCommandLine = %q, want %q", got, want)
	}
}
