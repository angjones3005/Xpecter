package fswatch

import (
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"
)

// collector gathers the directories reported to onChange so a test can
// wait for one without racing the watcher's internal goroutine.
type collector struct {
	mu   sync.Mutex
	dirs []string
	ch   chan struct{}
}

func newCollector() *collector {
	return &collector{ch: make(chan struct{}, 16)}
}

func (c *collector) onChange(dirs []string) {
	c.mu.Lock()
	c.dirs = append(c.dirs, dirs...)
	c.mu.Unlock()
	select {
	case c.ch <- struct{}{}:
	default:
	}
}

func (c *collector) seen() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := append([]string(nil), c.dirs...)
	sort.Strings(out)
	return out
}

// waitForChange blocks until onChange has fired at least once, so tests
// don't depend on a fixed sleep being long enough on a loaded machine.
func (c *collector) waitForChange(t *testing.T) {
	t.Helper()
	select {
	case <-c.ch:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for a change callback")
	}
}

func TestReportsDirectoryOfCreatedFile(t *testing.T) {
	dir := t.TempDir()
	c := newCollector()
	w, err := New(c.onChange)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { _ = w.Close() }()

	w.SetDirs([]string{dir})

	if err := os.WriteFile(filepath.Join(dir, "added.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	c.waitForChange(t)

	seen := c.seen()
	if len(seen) == 0 {
		t.Fatal("no directory reported")
	}
	// The watcher reports the directory whose listing changed, not the
	// file that changed inside it: that is what the tree re-lists.
	for _, got := range seen {
		if got != dir {
			t.Errorf("reported %q, want the parent directory %q", got, dir)
		}
	}
}

func TestUnwatchedDirectoryIsSilent(t *testing.T) {
	watched := t.TempDir()
	other := t.TempDir()
	c := newCollector()
	w, err := New(c.onChange)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { _ = w.Close() }()

	w.SetDirs([]string{watched})
	// Replace the set rather than add to it: this is the reconcile that
	// happens when a folder is collapsed and stops being drawn.
	w.SetDirs([]string{other})

	if got := w.Watching(); len(got) != 1 || got[0] != other {
		t.Fatalf("Watching() = %v, want exactly [%s]", got, other)
	}

	if err := os.WriteFile(filepath.Join(watched, "ignored.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	// Long enough for the debounce to have fired had anything queued.
	time.Sleep(400 * time.Millisecond)
	if seen := c.seen(); len(seen) != 0 {
		t.Errorf("reported %v for a directory that was unwatched", seen)
	}
}

func TestBurstIsCoalesced(t *testing.T) {
	dir := t.TempDir()
	c := newCollector()
	w, err := New(c.onChange)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { _ = w.Close() }()

	w.SetDirs([]string{dir})
	for i := 0; i < 25; i++ {
		name := filepath.Join(dir, "f"+string(rune('a'+i%26))+".txt")
		if err := os.WriteFile(name, []byte("x"), 0o644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
	}
	c.waitForChange(t)
	time.Sleep(400 * time.Millisecond)

	// 25 files produce far more than 25 raw events; the point of the
	// debounce is that the tree is asked to redraw a handful of times at
	// most, not once per event.
	if seen := c.seen(); len(seen) > 10 {
		t.Errorf("got %d change reports for one burst, want them coalesced", len(seen))
	}
}

func TestCloseIsIdempotent(t *testing.T) {
	w, err := New(func([]string) {})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Errorf("second Close: %v, want nil", err)
	}
	// SetDirs after Close must not panic on the closed inner watcher.
	w.SetDirs([]string{t.TempDir()})
}
