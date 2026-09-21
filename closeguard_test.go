package main

import (
	"testing"
	"time"
)

// beforeClose emits an event through the Wails runtime, which needs a
// live application context. These tests exercise the decision logic by
// driving the guard's state directly, the same way the bound methods
// do, and only call beforeClose where its answer is decided before the
// emit.

func TestCloseGuardAllowsCloseUntilArmed(t *testing.T) {
	a := NewApp("")
	if a.beforeClose(nil) {
		t.Fatal("an unarmed guard kept the window open")
	}
}

func TestCloseGuardAllowsCloseOnceApproved(t *testing.T) {
	a := NewApp("")
	a.ArmCloseGuard()
	a.closeGuard.mu.Lock()
	a.closeGuard.approved = true
	a.closeGuard.mu.Unlock()
	if a.beforeClose(nil) {
		t.Fatal("an approved quit was refused")
	}
}

func TestCloseGuardGivesUpOnAPageThatNeverAnswers(t *testing.T) {
	a := NewApp("")
	a.ArmCloseGuard()
	// A request went out and nobody acknowledged it for longer than
	// the timeout: the next close must go through.
	a.closeGuard.mu.Lock()
	a.closeGuard.requestedAt = time.Now().Add(-closeAckTimeout - time.Second)
	a.closeGuard.acked = false
	a.closeGuard.mu.Unlock()
	if a.beforeClose(nil) {
		t.Fatal("a close after an unanswered request was refused; the window could never be closed")
	}
}

func TestCloseGuardKeepsWaitingWhileAcknowledged(t *testing.T) {
	a := NewApp("")
	a.ArmCloseGuard()
	a.closeGuard.mu.Lock()
	a.closeGuard.requestedAt = time.Now().Add(-closeAckTimeout - time.Second)
	a.closeGuard.mu.Unlock()
	a.AcknowledgeCloseRequest()
	// The frontend has the request and is showing a dialog; a second
	// click on the close button must not skip it. This is the one
	// branch that would emit, so the decision is checked by hand.
	g := &a.closeGuard
	g.mu.Lock()
	stale := !g.requestedAt.IsZero() && !g.acked && time.Since(g.requestedAt) > closeAckTimeout
	g.mu.Unlock()
	if stale {
		t.Fatal("an acknowledged request was treated as unanswered")
	}
}

func TestFinishCloseRequestStayOpenClearsThePendingRequest(t *testing.T) {
	a := NewApp("")
	a.ArmCloseGuard()
	a.closeGuard.mu.Lock()
	a.closeGuard.requestedAt = time.Now()
	a.closeGuard.mu.Unlock()
	a.AcknowledgeCloseRequest()
	a.FinishCloseRequest(false)
	g := &a.closeGuard
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.requestedAt.IsZero() || g.acked || g.approved {
		t.Fatalf("after a cancelled close the guard still holds %+v", struct {
			Requested time.Time
			Acked     bool
			Approved  bool
		}{g.requestedAt, g.acked, g.approved})
	}
}
