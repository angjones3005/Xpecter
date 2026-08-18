package config

import (
	"os"
	"testing"
)

// preserveAndCleanup saves whatever's currently at path (if anything) and
// restores it after the test, so this doesn't clobber real saved profiles
// sitting in the actual config dir.
func preserveAndCleanup(t *testing.T, path string) {
	t.Helper()
	original, readErr := os.ReadFile(path)
	hadOriginal := readErr == nil
	t.Cleanup(func() {
		if hadOriginal {
			_ = os.WriteFile(path, original, 0o600)
		} else {
			_ = os.Remove(path)
		}
	})
}

func TestLocalShellProfilesRoundTrip(t *testing.T) {
	path, err := localShellProfilesPath()
	if err != nil {
		t.Fatalf("localShellProfilesPath: %v", err)
	}
	preserveAndCleanup(t, path)

	want := []LocalShellProfile{
		{ID: "1", Name: "PowerShell", Command: "powershell.exe", StartingDir: `C:\Users\ajohnson`, Icon: "powershell"},
		{ID: "2", Name: "zsh", Command: "/bin/zsh", StartingDir: "/home/ajohnson", Icon: "wsl"},
	}

	if err := SaveLocalShellProfiles(want); err != nil {
		t.Fatalf("SaveLocalShellProfiles: %v", err)
	}

	got, err := LoadLocalShellProfiles()
	if err != nil {
		t.Fatalf("LoadLocalShellProfiles: %v", err)
	}

	if len(got) != len(want) {
		t.Fatalf("got %d profiles, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("profile %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestLoadLocalShellProfilesEmptyWhenFileMissing(t *testing.T) {
	path, err := localShellProfilesPath()
	if err != nil {
		t.Fatalf("localShellProfilesPath: %v", err)
	}
	preserveAndCleanup(t, path)
	_ = os.Remove(path)

	got, err := LoadLocalShellProfiles()
	if err != nil {
		t.Fatalf("LoadLocalShellProfiles: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %d profiles, want 0", len(got))
	}
}
