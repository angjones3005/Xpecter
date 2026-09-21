package main

import (
	"errors"
	"sync"
	"testing"
)

func TestRegistryPutGetTake(t *testing.T) {
	r := newLiveMap[int]()
	r.put("a", 1)
	if v, ok := r.get("a"); !ok || v != 1 {
		t.Fatalf("get after put = %d, %v", v, ok)
	}
	if v, ok := r.take("a"); !ok || v != 1 {
		t.Fatalf("take = %d, %v", v, ok)
	}
	if _, ok := r.get("a"); ok {
		t.Fatal("entry still present after take")
	}
	if _, ok := r.take("a"); ok {
		t.Fatal("second take found something")
	}
}

// The reason create exists: an exit callback that fires before Launch
// has returned must wait for the entry to be stored, then remove it,
// rather than removing nothing and leaving a dead entry behind.
func TestRegistryCreateHoldsOffAnEarlyDelete(t *testing.T) {
	r := newLiveMap[string]()
	started := make(chan struct{})
	deleted := make(chan struct{})
	go func() {
		<-started
		r.take("id")
		close(deleted)
	}()
	err := r.create("id", func() (string, error) {
		close(started)
		// The delete above is now blocked on the lock this holds. If it
		// were not, it would run to completion here and the put below
		// would leave a dead entry.
		select {
		case <-deleted:
			t.Error("delete ran before create had stored the entry")
		default:
		}
		return "client", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	<-deleted
	if r.len() != 0 {
		t.Fatalf("registry holds %d entries after the exit callback ran, want 0", r.len())
	}
}

func TestRegistryCreateStoresNothingOnError(t *testing.T) {
	r := newLiveMap[string]()
	want := errors.New("no client")
	if err := r.create("id", func() (string, error) { return "", want }); !errors.Is(err, want) {
		t.Fatalf("create returned %v, want %v", err, want)
	}
	if r.len() != 0 {
		t.Fatal("a failed create stored an entry")
	}
}

func TestRegistryTakeWhereAndDrain(t *testing.T) {
	r := newLiveMap[string]()
	r.put("f1", "s1")
	r.put("f2", "s2")
	r.put("f3", "s1")
	got := r.takeWhere(func(_ string, v string) bool { return v == "s1" })
	if len(got) != 2 || got["f1"] != "s1" || got["f3"] != "s1" {
		t.Fatalf("takeWhere = %v", got)
	}
	if r.len() != 1 {
		t.Fatalf("%d entries left, want 1", r.len())
	}
	rest := r.drain()
	if len(rest) != 1 || rest["f2"] != "s2" {
		t.Fatalf("drain = %v", rest)
	}
	if r.len() != 0 {
		t.Fatal("drain left entries behind")
	}
	// Still usable afterwards: shutdown drains, nothing else should
	// have to care.
	r.put("f4", "s4")
	if r.len() != 1 {
		t.Fatal("registry unusable after drain")
	}
}

// Run with -race this is the whole point; without it, it is at least a
// smoke test that nothing here panics under concurrent use.
func TestRegistryConcurrentUse(t *testing.T) {
	r := newLiveMap[int]()
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := string(rune('a' + i%8))
			for j := 0; j < 200; j++ {
				r.put(id, j)
				r.get(id)
				if j%7 == 0 {
					r.take(id)
				}
				if j%50 == 0 {
					r.takeWhere(func(_ string, v int) bool { return v%2 == 0 })
				}
			}
		}(i)
	}
	wg.Wait()
}
