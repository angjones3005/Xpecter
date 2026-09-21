package main

import "sync"

// liveMap is the string-keyed map every live session, terminal, client
// and forward lives in, made safe for the way this app is actually
// called. Wails runs each bound method on a goroutine of its own, so two
// keystrokes, a connect and a tab close can all touch the same map at
// once; the RDP and VNC exit callbacks arrive on the goroutine that
// waited for the process, and an SSH read loop reports a drop on its
// own. A plain map under that load is a "fatal error: concurrent map
// writes" waiting for the right two things to happen together, and that
// error is not recoverable: it takes every open terminal with it.
//
// Values are taken out under the lock and closed outside it, so a slow
// Close() never holds up every other call, and a callback that deletes
// from the registry can never deadlock against the method that filled
// it.
type liveMap[T any] struct {
	mu sync.RWMutex
	m  map[string]T
}

func newLiveMap[T any]() *liveMap[T] {
	return &liveMap[T]{m: make(map[string]T)}
}

func (m *liveMap[T]) get(id string) (T, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.m[id]
	return v, ok
}

func (m *liveMap[T]) put(id string, v T) {
	m.mu.Lock()
	m.m[id] = v
	m.mu.Unlock()
}

// take removes id and hands back what was stored under it, so the
// caller can close it with the lock released.
func (m *liveMap[T]) take(id string) (T, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.m[id]
	if ok {
		delete(m.m, id)
	}
	return v, ok
}

// create runs make with the write lock held and stores its result under
// id. It exists for the launchers whose exit callback deletes id from
// this same registry: with the lock held across the launch, a client
// that exits before Launch has even returned blocks in its delete until
// the entry it is deleting has been put, instead of deleting nothing
// and leaving a dead entry behind for the life of the app.
func (m *liveMap[T]) create(id string, make func() (T, error)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, err := make()
	if err != nil {
		return err
	}
	m.m[id] = v
	return nil
}

// takeWhere removes every entry keep rejects and returns them, for
// closing a whole group at once (every forward bound to one session).
func (m *liveMap[T]) takeWhere(match func(id string, v T) bool) map[string]T {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]T)
	for id, v := range m.m {
		if match(id, v) {
			out[id] = v
			delete(m.m, id)
		}
	}
	return out
}

// snapshot copies the current entries out, for callers that only need
// to look.
func (m *liveMap[T]) snapshot() map[string]T {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make(map[string]T, len(m.m))
	for id, v := range m.m {
		out[id] = v
	}
	return out
}

// drain empties the map and returns everything that was in it.
func (m *liveMap[T]) drain() map[string]T {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := m.m
	m.m = make(map[string]T)
	return out
}

func (m *liveMap[T]) len() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.m)
}
