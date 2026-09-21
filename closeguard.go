package main

import (
	"context"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// closeGuard is what stands between the window's close button and an
// unsaved buffer. Closing a tab or a pane already asks about dirty
// documents; closing the window did not, because nothing ran on it:
// the webview was simply torn down, and whatever was in the editor
// went with it.
//
// Wails asks OnBeforeClose whether to go ahead and wants an answer
// then and there, while the answer lives in the frontend and takes as
// long as the person takes to read a dialog. So the close is refused
// and turned into an event; the frontend runs its usual per-pane
// confirmation and then calls back with the verdict, and a verdict of
// "quit" asks Wails to close again with the guard standing aside.
//
// Two escape hatches keep this from ever making the window impossible
// to close. Until the frontend has armed the guard, a close is simply
// allowed: a page that failed to load has nothing to lose. And a
// request the page never acknowledged within a few seconds means the
// page is not listening (a script error, a hung webview), so the next
// close goes through.
type closeGuard struct {
	mu          sync.Mutex
	armed       bool
	requestedAt time.Time
	acked       bool
	approved    bool
}

// closeAckTimeout is how long a close request may go unacknowledged
// before the guard concludes nobody is listening. Acknowledging is
// immediate on the frontend, well before any dialog, so this only ever
// fires when the page is broken.
const closeAckTimeout = 5 * time.Second

// beforeClose is the OnBeforeClose hook. It returns true to keep the
// window open.
func (a *App) beforeClose(ctx context.Context) bool {
	g := &a.closeGuard
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.approved || !g.armed {
		return false
	}
	if !g.requestedAt.IsZero() && !g.acked && time.Since(g.requestedAt) > closeAckTimeout {
		return false
	}
	g.requestedAt = time.Now()
	g.acked = false
	runtime.EventsEmit(ctx, "app:close-requested")
	return true
}

// ArmCloseGuard is called by the frontend once its close-request
// handler is listening. Until then the window closes freely.
func (a *App) ArmCloseGuard() {
	g := &a.closeGuard
	g.mu.Lock()
	g.armed = true
	g.mu.Unlock()
}

// AcknowledgeCloseRequest tells the guard the frontend received the
// request and is asking the user, however long that takes.
func (a *App) AcknowledgeCloseRequest() {
	g := &a.closeGuard
	g.mu.Lock()
	g.acked = true
	g.mu.Unlock()
}

// FinishCloseRequest is the frontend's verdict: quit, or stay open.
func (a *App) FinishCloseRequest(quit bool) {
	g := &a.closeGuard
	g.mu.Lock()
	g.requestedAt = time.Time{}
	g.acked = false
	g.approved = quit
	g.mu.Unlock()
	if quit && a.ctx != nil {
		runtime.Quit(a.ctx)
	}
}
