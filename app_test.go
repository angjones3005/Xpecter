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

func TestParseSSHConfig(t *testing.T) {
	cfg := `
# a comment
Host bastion
    HostName bastion.example.com
    User ops
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host web1 web1-alias
    HostName 10.0.0.11
    User deploy
    ProxyJump ops@bastion.example.com:2222

Host *
    ServerAliveInterval 60
`
	profiles := parseSSHConfig(cfg)
	if len(profiles) != 2 {
		t.Fatalf("got %d profiles, want 2 (the wildcard-only block is skipped): %+v", len(profiles), profiles)
	}
	b := profiles[0]
	if b.Name != "bastion" || b.Host != "bastion.example.com" || b.User != "ops" || b.Port != 2222 {
		t.Errorf("bastion parsed wrong: %+v", b)
	}
	if b.KeyPath == "" || strings.HasPrefix(b.KeyPath, "~") {
		t.Errorf("IdentityFile ~ not expanded: %q", b.KeyPath)
	}
	w := profiles[1]
	if w.Name != "web1" || w.Host != "10.0.0.11" || w.JumpHost != "ops@bastion.example.com:2222" {
		t.Errorf("web1 parsed wrong: %+v", w)
	}
	if w.ID == "" || b.ID == "" {
		t.Error("imported profiles must get ids")
	}
}

// A wikilink names a note, not a path: the whole folder is searched,
// case-insensitively, with the shallowest match first and the places
// nothing links into (dot-directories, node_modules) left alone.
func TestFindLocalFilesSearchesTheWholeFolder(t *testing.T) {
	root := t.TempDir()
	app := &App{}
	mk := func(parts ...string) string {
		path := filepath.Join(append([]string{root}, parts...)...)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}
	deep := mk("a", "b", "Note.md")
	shallow := mk("a", "note.md")
	mk(".obsidian", "Note.md")
	mk("node_modules", "pkg", "Note.md")
	mk("a", "Other.md")

	got, err := app.FindLocalFiles(root, "Note.md")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{shallow, deep}
	if len(got) != len(want) {
		t.Fatalf("FindLocalFiles = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("FindLocalFiles[%d] = %q, want %q", i, got[i], want[i])
		}
	}

	if got, err := app.FindLocalFiles(root, "Missing.md"); err != nil || len(got) != 0 {
		t.Errorf("FindLocalFiles for a missing name = %v, %v; want none", got, err)
	}
	if _, err := app.FindLocalFiles(root, ""); err == nil {
		t.Error("FindLocalFiles accepted an empty name")
	}
	if _, err := app.FindLocalFiles(filepath.Join(root, "nope"), "Note.md"); err == nil {
		t.Error("FindLocalFiles accepted a folder that does not exist")
	}
}

func TestCleanupStaleRemoteFilesAlsoSweepsUpdateDownloads(t *testing.T) {
	stale, err := os.MkdirTemp(os.TempDir(), "xpecter-update-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(stale)
	old := time.Now().Add(-48 * time.Hour)
	if err := os.WriteFile(filepath.Join(stale, "setup.exe"), []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}

	cleanupStaleRemoteFiles()
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale update download still exists, stat error: %v", err)
	}
}

func TestCleanupStaleRDPFiles(t *testing.T) {
	dir := t.TempDir()
	old := time.Now().Add(-48 * time.Hour)
	stale := filepath.Join(dir, "session-1.rdp")
	fresh := filepath.Join(dir, "session-2.rdp")
	other := filepath.Join(dir, "notes.txt")
	for _, p := range []string{stale, fresh, other} {
		if err := os.WriteFile(p, []byte("full address:s:host\r\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{stale, other} {
		if err := os.Chtimes(p, old, old); err != nil {
			t.Fatal(err)
		}
	}

	cleanupStaleRDPFiles(dir)
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("a day-old .rdp file was kept: %v", err)
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Errorf("a fresh .rdp file was removed: %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("a file that is not an .rdp was removed: %v", err)
	}
	// A directory that does not exist yet is simply nothing to sweep.
	cleanupStaleRDPFiles(filepath.Join(dir, "missing"))
}

// The log filename is built from the label and the session id. The id
// comes from idgen today, but the sanitiser is what makes that true
// rather than an accident of where the argument came from.
func TestAppendSessionLogSanitizesTheSessionID(t *testing.T) {
	dir := t.TempDir()
	a := NewApp("")
	if err := a.AppendSessionLog(dir, `..\..\escaped`, "lab", "hello\n"); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries in the log directory, want 1", len(entries))
	}
	if name := entries[0].Name(); strings.ContainsAny(name, `\/`) || !strings.HasPrefix(name, "lab-") {
		t.Fatalf("log file named %q", name)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "escaped.log")); err == nil {
		t.Fatal("a log file was written outside the chosen directory")
	}
}

func TestWriteLocalFileReplacesWithoutLeavingTemporaries(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.md")
	a := NewApp("")
	if err := a.WriteLocalFile(path, "first"); err != nil {
		t.Fatal(err)
	}
	if err := a.WriteLocalFile(path, "second"); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "second" {
		t.Fatalf("file holds %q, want the second write", got)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("%d entries in the directory after two saves, want just the file", len(entries))
	}
}

func TestUpdateAssetAllowed(t *testing.T) {
	allowed := []string{
		releaseDownloadPrefix + "v1.2.3/xpecter-windows-amd64-setup.exe",
		releaseDownloadPrefix + "v1.2.3/xpecter-linux-amd64.tar.gz",
	}
	for _, u := range allowed {
		if !updateAssetAllowed(u) {
			t.Errorf("%s refused", u)
		}
	}
	refused := []string{
		"",
		"http://github.com/Dawnrail/Dawnrail/releases/download/v1/x.exe",
		"https://github.com/Someone/Else/releases/download/v1/x.exe",
		"https://evil.example/xpecter.exe",
		releaseDownloadPrefix + "v1.2.3/",
		releaseDownloadPrefix + "v1.2.3/a/b.exe",
		releaseDownloadPrefix + "v1.2.3/..",
		releaseDownloadPrefix + "v1.2.3/x.exe?download=1",
	}
	for _, u := range refused {
		if updateAssetAllowed(u) {
			t.Errorf("%q allowed", u)
		}
	}
}

func TestDownloadAndInstallUpdateRefusesAnythingButTheOffer(t *testing.T) {
	a := NewApp("")
	// Nothing checked yet: nothing may be installed.
	if err := a.DownloadAndInstallUpdate(releaseDownloadPrefix + "v9/xpecter-windows-amd64-setup.exe"); err == nil {
		t.Fatal("an update was accepted before any check had offered one")
	}
	a.update = updateOffer{assetURL: releaseDownloadPrefix + "v9/xpecter-windows-amd64-setup.exe", sumsURL: releaseDownloadPrefix + "v9/SHA256SUMS.txt"}
	if err := a.DownloadAndInstallUpdate("https://evil.example/setup.exe"); err == nil {
		t.Fatal("a URL other than the offered one was accepted")
	}
	if err := a.DownloadAndInstallUpdate(""); err == nil {
		t.Fatal("an empty URL was accepted")
	}
	a.update.sumsURL = ""
	if err := a.DownloadAndInstallUpdate(a.update.assetURL); err == nil {
		t.Fatal("an update with no checksum list to verify against was accepted")
	}
}

func TestVerifyChecksum(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "xpecter-setup.exe")
	if err := os.WriteFile(path, []byte("installer bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	// sha256("installer bytes")
	const sum = "e34210a6de4f653edf588301431c3d69a633638cbf587345cc50a7fed9f38f4c"
	sums := []byte("deadbeef  other.zip\n" + sum + "  xpecter-setup.exe\n" + "cafe *starred.tar.gz\n")
	if got, ok := expectedChecksum(sums, "starred.tar.gz"); !ok || got != "cafe" {
		t.Errorf("the binary-mode marker was not stripped: %q, %v", got, ok)
	}
	if _, ok := expectedChecksum(sums, "missing.exe"); ok {
		t.Error("a file that is not listed had a checksum")
	}
	err := verifyChecksum(path, sums, "xpecter-setup.exe")
	if err != nil {
		// The constant above is checked against the real digest so a
		// typo in the test reads as one.
		t.Fatalf("verifyChecksum on matching contents: %v", err)
	}
	if err := verifyChecksum(path, []byte("0000  xpecter-setup.exe\n"), "xpecter-setup.exe"); err == nil {
		t.Fatal("a wrong checksum verified")
	}
	if err := verifyChecksum(path, sums, "missing.exe"); err == nil {
		t.Fatal("an unlisted file verified")
	}
}

// A path that does not exist is refused before anything is launched:
// the file manager would open on nothing, or on whatever it falls
// back to, and say nothing about why.
func TestRevealInFileManagerRefusesAMissingPath(t *testing.T) {
	a := NewApp("")
	missing := filepath.Join(t.TempDir(), "not-here")
	if err := a.RevealInFileManager(missing); err == nil {
		t.Fatal("a missing path was accepted")
	}
}
