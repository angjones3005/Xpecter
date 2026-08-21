package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestCleanupStaleRemoteFiles(t *testing.T) {
	stale, err := os.MkdirTemp(os.TempDir(), "specter-remote-file-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(stale)

	old := time.Now().Add(-48 * time.Hour)
	if err := os.WriteFile(filepath.Join(stale, "sample.pdf"), []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}

	cleanupStaleRemoteFiles()
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale remote temp directory still exists, stat error: %v", err)
	}
}

func TestCleanupStaleRemoteFilesKeepsRecentDirectory(t *testing.T) {
	recent, err := os.MkdirTemp(os.TempDir(), "specter-remote-file-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(recent)

	cleanupStaleRemoteFiles()
	if _, err := os.Stat(recent); err != nil {
		t.Fatalf("recent remote temp directory was removed: %v", err)
	}
}

func TestRemoteTempFilePathUsesRemoteBaseName(t *testing.T) {
	got := remoteTempFilePath(`C:\Temp\remote`, "/home/angelo/report.pdf")
	want := filepath.Join(`C:\Temp\remote`, "report.pdf")
	if got != want {
		t.Fatalf("remoteTempFilePath() = %q, want %q", got, want)
	}
}

// Wails marshals a bound method returning at most one value plus an
// error: internal/binding.BoundMethod.Call switches on the output count
// and handles only 1 and 2. A method with three returns matches neither
// case, so it reaches the frontend as null with its error discarded, and
// nothing in the Go build or the TypeScript build says a word about it.
// ImportMobaXtermSessions shipped that way. This catches the next one.
func TestBoundMethodsReturnAtMostTwoValues(t *testing.T) {
	appType := reflect.TypeOf(&App{})
	for i := 0; i < appType.NumMethod(); i++ {
		method := appType.Method(i)
		if count := method.Type.NumOut(); count > 2 {
			t.Errorf("App.%s returns %d values; Wails marshals at most 2 (value plus error), so the frontend would receive null", method.Name, count)
		}
	}
}
