package main

import (
	"os"
	"path/filepath"
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
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stale, "sample.pdf"), []byte("data"), 0o600); err != nil {
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
