package atomicfile

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWriteCreatesAndReplaces(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sessions.json")

	if err := Write(path, []byte("one"), 0o600); err != nil {
		t.Fatalf("first write: %v", err)
	}
	if got, _ := os.ReadFile(path); string(got) != "one" {
		t.Fatalf("after first write: %q", got)
	}
	if err := Write(path, []byte("two"), 0o600); err != nil {
		t.Fatalf("second write: %v", err)
	}
	if got, _ := os.ReadFile(path); string(got) != "two" {
		t.Fatalf("after second write: %q", got)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		names := []string{}
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("temporary file left behind: %v", names)
	}
}

func TestWriteKeepsExistingPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("permission bits are not meaningful on Windows")
	}
	path := filepath.Join(t.TempDir(), "script.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := Write(path, []byte("#!/bin/sh\necho hi\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("mode after write = %04o, want 0755 kept from the original", info.Mode().Perm())
	}
}

func TestWriteFollowsSymlink(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real.txt")
	link := filepath.Join(dir, "link.txt")
	if err := os.WriteFile(real, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("symlinks unavailable here: %v", err)
	}
	if err := Write(link, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(real); string(got) != "new" {
		t.Fatalf("target of the link = %q, want the new contents", got)
	}
	info, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("the symlink was replaced by a regular file")
	}
}

func TestWriteReportsUnwritableDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing-dir", "file.txt")
	err := Write(path, []byte("x"), 0o600)
	if !errors.Is(err, ErrTempFile) {
		t.Fatalf("err = %v, want ErrTempFile so callers can fall back", err)
	}
}

func TestWriteRefusesDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := Write(dir, []byte("x"), 0o600); err == nil {
		t.Fatal("writing over a directory succeeded")
	}
}
