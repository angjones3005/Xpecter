package main

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestShouldReportThrottlesButAlwaysReportsTheEnd(t *testing.T) {
	now := time.Now()
	if shouldReport(now, now.Add(-10*time.Millisecond), 10, 100) {
		t.Error("reported again 10 ms after the last report")
	}
	if !shouldReport(now, now.Add(-200*time.Millisecond), 10, 100) {
		t.Error("did not report after the interval had passed")
	}
	if !shouldReport(now, now, 100, 100) {
		t.Error("a finished transfer was not reported")
	}
	// An unknown size never counts as finished.
	if shouldReport(now, now, 100, 0) {
		t.Error("a transfer of unknown size reported as finished")
	}
}

func TestLocalPathForMapsUnderTheChosenFolder(t *testing.T) {
	root := filepath.Join(t.TempDir(), "backup")
	cases := map[string]string{
		"/srv/data":                 root,
		"/srv/data/a.txt":           filepath.Join(root, "a.txt"),
		"/srv/data/sub/deep/b.conf": filepath.Join(root, "sub", "deep", "b.conf"),
	}
	for remote, want := range cases {
		got, err := localPathFor(root, "/srv/data", remote)
		if err != nil {
			t.Errorf("localPathFor(%q): %v", remote, err)
			continue
		}
		if got != want {
			t.Errorf("localPathFor(%q) = %q, want %q", remote, got, want)
		}
	}
	// A listing rooted at "." (the login directory) reports bare paths.
	if got, err := localPathFor(root, ".", "notes/today.md"); err != nil || got != filepath.Join(root, "notes", "today.md") {
		t.Errorf("localPathFor(., notes/today.md) = %q, %v", got, err)
	}
}

// The names come from the host. A host that answers a listing with a
// path that climbs out of the download folder must be refused, on
// every platform's separator.
func TestLocalPathForRefusesEscapes(t *testing.T) {
	root := filepath.Join(t.TempDir(), "backup")
	bad := []string{
		"/srv/data/../etc/passwd",
		"/srv/data/sub/../../x",
		"/srv/other/file",
		"/srv/data//x",
		"/srv/data/./x",
		`/srv/data/..\..\x`,
		`/srv/data/a\b`,
		"/srv/data/c:x",
	}
	for _, remote := range bad {
		got, err := localPathFor(root, "/srv/data", remote)
		if err == nil {
			t.Errorf("localPathFor(%q) = %q, want a refusal", remote, got)
			continue
		}
		if got != "" {
			t.Errorf("localPathFor(%q) returned a path with its error: %q", remote, got)
		}
	}
	if runtime.GOOS == "windows" {
		// Belt and braces: whatever passed, nothing lands outside root.
		for _, remote := range []string{"/srv/data/ok.txt", "/srv/data/d/e"} {
			got, err := localPathFor(root, "/srv/data", remote)
			if err != nil || !strings.HasPrefix(got, root+string(filepath.Separator)) {
				t.Errorf("localPathFor(%q) = %q, %v", remote, got, err)
			}
		}
	}
}

func TestTransferReporterStates(t *testing.T) {
	a := NewApp("")
	// No Wails context: emit is a no-op, and the state machine is what
	// is under test.
	r := a.startTransfer("big.iso", "download", 1000, 1)
	if r.p.State != "running" || r.p.Done != 0 {
		t.Fatalf("fresh reporter = %+v", r.p)
	}
	r.advance(500, 1000)
	if r.p.Done != 500 {
		t.Fatalf("Done after advance = %d", r.p.Done)
	}
	r.fileDone(1000)
	if r.p.FilesDone != 1 || r.p.Done != 1000 {
		t.Fatalf("after fileDone = %+v", r.p)
	}
	r.finish(nil)
	if r.p.State != "done" || r.p.Error != "" {
		t.Fatalf("after finish(nil) = %+v", r.p)
	}

	failed := a.startTransfer("x", "upload", 10, 1)
	failed.finish(errPermission)
	if failed.State() != "failed" || failed.p.Error == "" {
		t.Fatalf("after finish(err) = %+v", failed.p)
	}
}

// State is a test hook: the reporter's state as the last event carried it.
func (r *transferReporter) State() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.p.State
}

var errPermission = &permissionError{}

type permissionError struct{}

func (*permissionError) Error() string { return "permission denied" }
