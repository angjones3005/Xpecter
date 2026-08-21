package config

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestSessionsRoundTripPreservesPinned(t *testing.T) {
	path, err := sessionsPath()
	if err != nil {
		t.Fatalf("sessionsPath: %v", err)
	}
	preserveAndCleanup(t, path)

	want := []SessionProfile{
		{ID: "1", Name: "prod-web", Host: "10.0.0.5", Port: 22, User: "root", Pinned: true},
		{ID: "2", Name: "lab-switch", Host: "10.0.0.9", DeviceKind: "switch", Tags: []string{"lab"}},
	}

	if err := SaveSessions(want); err != nil {
		t.Fatalf("SaveSessions: %v", err)
	}
	got, err := LoadSessions()
	if err != nil {
		t.Fatalf("LoadSessions: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("round trip mismatch:\n got %+v\nwant %+v", got, want)
	}
}

// A sessions.json written before Pinned existed must still load, with
// every session simply unpinned rather than erroring out.
func TestLoadSessionsWithoutPinnedField(t *testing.T) {
	path, err := sessionsPath()
	if err != nil {
		t.Fatalf("sessionsPath: %v", err)
	}
	preserveAndCleanup(t, path)

	legacy := `[{"id":"1","name":"old","host":"10.0.0.5","user":"root"}]`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatalf("write legacy file: %v", err)
	}

	got, err := LoadSessions()
	if err != nil {
		t.Fatalf("LoadSessions: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d sessions, want 1", len(got))
	}
	if got[0].Pinned {
		t.Errorf("session from a pre-Pinned file loaded as pinned")
	}
}

// omitempty means an unpinned session adds no key, so upgrading Specter
// does not rewrite every existing entry in sessions.json.
func TestUnpinnedSessionOmitsPinnedKey(t *testing.T) {
	encoded, err := json.Marshal(SessionProfile{ID: "1", Name: "plain"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := decoded["pinned"]; present {
		t.Errorf("unpinned session serialized a pinned key: %s", encoded)
	}
}
