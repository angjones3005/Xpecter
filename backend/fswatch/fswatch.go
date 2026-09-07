// Package fswatch turns raw filesystem notifications into a small,
// debounced stream of "this directory's listing changed" callbacks, which
// is the only question the editor's workspace tree actually asks.
//
// It watches a flat set of directories rather than a tree. The tree only
// ever draws the folders it has expanded, so watching recursively would
// register thousands of directories nobody is looking at, and on Windows
// each watch is a real kernel handle.
package fswatch

import (
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// A single editor action can produce a burst of events: writing a file
// emits Create then several Writes, and an unpacking build tool can emit
// hundreds in a row. The tree only needs to redraw once at the end, so
// events are collected and reported after this much quiet.
const debounceWindow = 120 * time.Millisecond

type Watcher struct {
	inner    *fsnotify.Watcher
	onChange func(dirs []string)

	mu      sync.Mutex
	watched map[string]struct{}
	pending map[string]struct{}
	timer   *time.Timer
	closed  bool
}

// New starts a watcher. onChange is called from an internal goroutine
// with the directories whose contents changed, already de-duplicated.
func New(onChange func(dirs []string)) (*Watcher, error) {
	inner, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{
		inner:    inner,
		onChange: onChange,
		watched:  make(map[string]struct{}),
		pending:  make(map[string]struct{}),
	}
	go w.run()
	return w, nil
}

func (w *Watcher) run() {
	for {
		select {
		case event, ok := <-w.inner.Events:
			if !ok {
				return
			}
			// Chmod alone never changes a listing as the tree renders it
			// (name, kind, size), and on some platforms it arrives for
			// every read. Anything else is reported.
			if event.Op&^fsnotify.Chmod == 0 {
				continue
			}
			// The event names the entry that changed; the directory whose
			// listing changed is its parent. This is also right when the
			// watched directory itself is removed or renamed, where the
			// parent is exactly the level that needs redrawing.
			w.queue(filepath.Dir(event.Name))
		case _, ok := <-w.inner.Errors:
			if !ok {
				return
			}
			// Deliberately swallowed. A watch error is not actionable per
			// event, and the caller keeps a slow reconciliation pass that
			// re-lists anyway, so a dropped notification costs latency
			// rather than correctness.
		}
	}
}

func (w *Watcher) queue(dir string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	w.pending[dir] = struct{}{}
	if w.timer == nil {
		w.timer = time.AfterFunc(debounceWindow, w.flush)
		return
	}
	w.timer.Reset(debounceWindow)
}

func (w *Watcher) flush() {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	dirs := make([]string, 0, len(w.pending))
	for dir := range w.pending {
		dirs = append(dirs, dir)
	}
	w.pending = make(map[string]struct{})
	w.timer = nil
	onChange := w.onChange
	w.mu.Unlock()

	if len(dirs) > 0 && onChange != nil {
		onChange(dirs)
	}
}

// SetDirs makes the watched set exactly dirs, adding and removing as
// needed. Callers pass the whole set every time rather than tracking
// deltas themselves, because the set is derived from what the tree is
// currently drawing and that is what they already have.
func (w *Watcher) SetDirs(dirs []string) {
	want := make(map[string]struct{}, len(dirs))
	for _, dir := range dirs {
		if dir != "" {
			want[dir] = struct{}{}
		}
	}

	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	for dir := range w.watched {
		if _, keep := want[dir]; keep {
			continue
		}
		_ = w.inner.Remove(dir)
		delete(w.watched, dir)
	}
	for dir := range want {
		if _, have := w.watched[dir]; have {
			continue
		}
		// A directory that can't be watched (gone already, a filesystem
		// with no notification support, or the platform's watch limit)
		// is not worth failing the whole call for. The caller's
		// reconciliation pass still covers it; it just won't be instant.
		if err := w.inner.Add(dir); err != nil {
			continue
		}
		w.watched[dir] = struct{}{}
	}
}

// Watching reports the directories currently being watched. Used by the
// tests to confirm SetDirs reconciles rather than only ever adding.
func (w *Watcher) Watching() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	dirs := make([]string, 0, len(w.watched))
	for dir := range w.watched {
		dirs = append(dirs, dir)
	}
	return dirs
}

func (w *Watcher) Close() error {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return nil
	}
	w.closed = true
	if w.timer != nil {
		w.timer.Stop()
		w.timer = nil
	}
	w.mu.Unlock()
	return w.inner.Close()
}
