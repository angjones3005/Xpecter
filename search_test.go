package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func writeTree(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSearchLocalFilesFindsLinesAndSkipsWhatItShould(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{
		"switch1.cfg":             "hostname switch1\ninterface Gi1/0/1\n description Uplink\n",
		"notes/today.md":          "- [ ] check the UPLINK on switch1\n",
		"node_modules/x/index.js": "uplink uplink uplink\n",
		".git/config":             "uplink\n",
		"image.bin":               "uplink\x00binary\n",
		"sub/deep/interfaces.txt": "no match here\n",
	})
	a := NewApp("")

	result, err := a.SearchLocalFiles(root, "uplink", false, false)
	if err != nil {
		t.Fatal(err)
	}
	var paths []string
	for _, hit := range result.Hits {
		paths = append(paths, strings.TrimPrefix(hit.Path, root+string(filepath.Separator))+":"+itoa(hit.Line))
	}
	want := map[string]bool{"switch1.cfg:3": true, filepath.Join("notes", "today.md") + ":1": true}
	if len(paths) != len(want) {
		t.Fatalf("hits = %v, want exactly %v", paths, want)
	}
	for _, p := range paths {
		if !want[p] {
			t.Errorf("unexpected hit %s", p)
		}
	}
	if result.Truncated {
		t.Error("a small search reported itself truncated")
	}

	// Case-sensitive: only the capitalised one.
	result, err = a.SearchLocalFiles(root, "UPLINK", false, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hits) != 1 || !strings.HasSuffix(result.Hits[0].Path, "today.md") {
		t.Errorf("case-sensitive hits = %+v", result.Hits)
	}

	// A regular expression, with the column pointing at the match.
	result, err = a.SearchLocalFiles(root, `Gi\d/\d/\d`, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hits) != 1 || result.Hits[0].Line != 2 || result.Hits[0].Column != 11 {
		t.Errorf("regex hits = %+v", result.Hits)
	}
	if _, err := a.SearchLocalFiles(root, `(`, true, false); err == nil {
		t.Error("an invalid regular expression was accepted")
	}
	if _, err := a.SearchLocalFiles(root, "", false, false); err == nil {
		t.Error("an empty query was accepted")
	}
}

func TestSearchStopsAtTheHitCap(t *testing.T) {
	root := t.TempDir()
	var b strings.Builder
	for i := 0; i < searchMaxHitsPerFile+50; i++ {
		b.WriteString("needle\n")
	}
	writeTree(t, root, map[string]string{"haystack.txt": b.String()})
	result, err := NewApp("").SearchLocalFiles(root, "needle", false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hits) != searchMaxHitsPerFile || !result.Truncated {
		t.Fatalf("got %d hits, truncated=%v; want the per-file cap and a truncation flag", len(result.Hits), result.Truncated)
	}
}

func TestTrimSearchLineKeepsTheMatchInView(t *testing.T) {
	long := strings.Repeat("x", 500) + "NEEDLE" + strings.Repeat("y", 500)
	got := trimSearchLine(long, 500)
	if !strings.Contains(got, "NEEDLE") {
		t.Fatalf("the match fell out of the trimmed line: %q", got)
	}
	if !strings.HasPrefix(got, "…") || !strings.HasSuffix(got, "…") {
		t.Errorf("a line cut on both sides should say so: %q", got)
	}
	if len([]rune(got)) > searchMaxLineChars+2 {
		t.Errorf("trimmed line is %d runes", len([]rune(got)))
	}
	if got := trimSearchLine("  short  ", 2); got != "short" {
		t.Errorf("short line = %q", got)
	}
}

func itoa(n int) string { return strconv.Itoa(n) }
