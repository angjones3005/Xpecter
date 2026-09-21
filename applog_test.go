package main

import (
	"bytes"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type brokenWriter struct{}

func (brokenWriter) Write([]byte) (int, error) { return 0, errors.New("the handle is invalid") }

// A GUI build on Windows has no stderr. The log file must still get
// every record; io.MultiWriter would have stopped at the broken one.
func TestAppLogWriterReachesTheFileWhenStderrIsBroken(t *testing.T) {
	var file bytes.Buffer
	w := appLogWriter{file: &file, echo: brokenWriter{}}
	if _, err := w.Write([]byte("hello\n")); err != nil {
		t.Fatal(err)
	}
	if file.String() != "hello\n" {
		t.Fatalf("file got %q", file.String())
	}
}

func TestRotateAppLogKeepsOnePrevious(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, appLogName)
	if err := os.WriteFile(path, bytes.Repeat([]byte("x"), appLogMaxBytes), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".1", []byte("older"), 0o600); err != nil {
		t.Fatal(err)
	}
	rotateAppLog(path)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("the full log is still in place: %v", err)
	}
	moved, err := os.ReadFile(path + ".1")
	if err != nil || len(moved) != appLogMaxBytes {
		t.Fatalf("rotated copy: %d bytes, %v", len(moved), err)
	}
	// A log under the cap stays where it is.
	if err := os.WriteFile(path, []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	rotateAppLog(path)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("a short log was rotated away: %v", err)
	}
}

func TestLogFromFrontendTagsAndTruncates(t *testing.T) {
	var out bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&out)
	defer log.SetOutput(prev)
	app := &App{}
	app.LogFromFrontend(" error ", strings.Repeat("a", 5000))
	line := out.String()
	if !strings.Contains(line, "[frontend ERROR] ") {
		t.Fatalf("no level tag in a %d byte line", len(line))
	}
	if len(line) > 4200 {
		t.Fatalf("message not truncated: %d bytes", len(line))
	}
	out.Reset()
	app.LogFromFrontend("", "plain")
	if !strings.Contains(out.String(), "[frontend INFO] plain") {
		t.Fatalf("no default level in %q", out.String())
	}
}
