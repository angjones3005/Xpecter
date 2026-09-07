package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestCleanupStaleRemoteFiles(t *testing.T) {
	stale, err := os.MkdirTemp(os.TempDir(), "xpecter-remote-file-")
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
	recent, err := os.MkdirTemp(os.TempDir(), "xpecter-remote-file-")
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

// A name typed into the workspace tree is a name, not a path. The tree
// is rooted at one folder and both create calls join onto a directory
// it chose, so anything that could climb out of that folder has to be
// refused before the join, not after it.
func TestValidLocalNameRejectsAnythingButAName(t *testing.T) {
	for _, bad := range []string{"", "   ", ".", "..", "a/b", `a\b`, "../escape", "/etc/passwd"} {
		if _, err := validLocalName(bad); err == nil {
			t.Errorf("validLocalName(%q) was accepted, want an error", bad)
		}
	}
	for _, good := range []string{"notes.skald", "  notes.skald  ", ".gitignore", "a b.txt"} {
		got, err := validLocalName(good)
		if err != nil {
			t.Errorf("validLocalName(%q) = error %v, want it accepted", good, err)
			continue
		}
		if got != strings.TrimSpace(good) {
			t.Errorf("validLocalName(%q) = %q, want it trimmed to %q", good, got, strings.TrimSpace(good))
		}
	}
}

// Both creates are "add", never "replace": a name already taken has to
// fail rather than truncate a file or silently adopt a directory.
func TestCreateLocalRefusesAnExistingName(t *testing.T) {
	dir := t.TempDir()
	app := &App{}

	path, err := app.CreateLocalFile(dir, "notes.skald")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("real content"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := app.CreateLocalFile(dir, "notes.skald"); err == nil {
		t.Error("CreateLocalFile overwrote an existing file, want an error")
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "real content" {
		t.Errorf("existing file was truncated: %q, %v", data, err)
	}

	if _, err := app.CreateLocalDir(dir, "sub"); err != nil {
		t.Fatal(err)
	}
	if _, err := app.CreateLocalDir(dir, "sub"); err == nil {
		t.Error("CreateLocalDir accepted a name already taken, want an error")
	}
}

// os.Rename on Windows resolves to MoveFileEx with
// MOVEFILE_REPLACE_EXISTING, so without an explicit check a rename onto
// a name already in use destroys the file that was there.
func TestRenameLocalEntryRefusesAnExistingName(t *testing.T) {
	dir := t.TempDir()
	app := &App{}

	source := filepath.Join(dir, "draft.txt")
	victim := filepath.Join(dir, "keep.txt")
	if err := os.WriteFile(source, []byte("source"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(victim, []byte("must survive"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := app.RenameLocalEntry(source, "keep.txt"); err == nil {
		t.Error("RenameLocalEntry renamed onto an existing name, want an error")
	}
	if data, err := os.ReadFile(victim); err != nil || string(data) != "must survive" {
		t.Errorf("the existing file was clobbered: %q, %v", data, err)
	}
	if _, err := os.Stat(source); err != nil {
		t.Errorf("the source disappeared on a refused rename: %v", err)
	}
}

func TestRenameLocalEntryRenamesAndRejectsPaths(t *testing.T) {
	dir := t.TempDir()
	app := &App{}

	source := filepath.Join(dir, "before.txt")
	if err := os.WriteFile(source, []byte("body"), 0o644); err != nil {
		t.Fatal(err)
	}

	renamed, err := app.RenameLocalEntry(source, "after.txt")
	if err != nil {
		t.Fatalf("RenameLocalEntry: %v", err)
	}
	if renamed != filepath.Join(dir, "after.txt") {
		t.Errorf("returned %q, want the new path in the same directory", renamed)
	}
	if data, err := os.ReadFile(renamed); err != nil || string(data) != "body" {
		t.Errorf("content did not survive the rename: %q, %v", data, err)
	}

	// A separator would turn a rename into a move out of the folder the
	// tree is showing, which is never what a rename box means.
	if _, err := app.RenameLocalEntry(renamed, "sub/escaped.txt"); err == nil {
		t.Error("RenameLocalEntry accepted a path, want a name only")
	}
	// Renaming to the name it already has is a no-op, not a collision
	// with itself.
	if same, err := app.RenameLocalEntry(renamed, "after.txt"); err != nil || same != renamed {
		t.Errorf("renaming to the current name returned (%q, %v), want (%q, nil)", same, err, renamed)
	}
}
