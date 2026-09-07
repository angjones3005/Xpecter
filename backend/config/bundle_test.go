package config

import (
	"testing"
)

// The config package resolves every path through configDir(), which
// reads the user's config location from the environment. Each test
// points that at a fresh temp directory so nothing here can see, or
// damage, a real Xpecter configuration.
func isolateConfig(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	t.Setenv("APPDATA", dir)
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
}

func seedTwoSessions(t *testing.T) {
	t.Helper()
	if err := SaveSessions([]SessionProfile{
		{ID: "local-1", Name: "local one"},
		{ID: "local-2", Name: "local two"},
	}); err != nil {
		t.Fatalf("SaveSessions: %v", err)
	}
	if err := SaveFolders([]Folder{{ID: "folder-1", Path: "/local/folder"}}); err != nil {
		t.Fatalf("SaveFolders: %v", err)
	}
}

func incomingBundle() ConfigBundle {
	return ConfigBundle{
		Version:  configBundleVersion,
		Settings: Settings{FontSize: 17},
		Sessions: []SessionProfile{
			{ID: "imported-1", Name: "imported one"},
		},
		Folders: []Folder{{ID: "imported-folder", Path: "/imported/folder"}},
	}
}

func TestImportMergeKeepsExisting(t *testing.T) {
	isolateConfig(t)
	seedTwoSessions(t)

	if err := ImportBundle(incomingBundle(), ImportMerge); err != nil {
		t.Fatalf("ImportBundle: %v", err)
	}

	sessions, err := LoadSessions()
	if err != nil {
		t.Fatalf("LoadSessions: %v", err)
	}
	if len(sessions) != 3 {
		t.Fatalf("got %d sessions, want the 2 existing plus 1 imported", len(sessions))
	}
	folders, err := LoadFolders()
	if err != nil {
		t.Fatalf("LoadFolders: %v", err)
	}
	if len(folders) != 2 {
		t.Errorf("got %d folders, want 2 after a merge", len(folders))
	}
}

func TestImportReplaceDiscardsExisting(t *testing.T) {
	isolateConfig(t)
	seedTwoSessions(t)

	if err := ImportBundle(incomingBundle(), ImportReplace); err != nil {
		t.Fatalf("ImportBundle: %v", err)
	}

	sessions, err := LoadSessions()
	if err != nil {
		t.Fatalf("LoadSessions: %v", err)
	}
	if len(sessions) != 1 || sessions[0].ID != "imported-1" {
		t.Fatalf("got %+v, want only the imported session", sessions)
	}
	folders, err := LoadFolders()
	if err != nil {
		t.Fatalf("LoadFolders: %v", err)
	}
	if len(folders) != 1 || folders[0].ID != "imported-folder" {
		t.Errorf("got %+v, want only the imported folder", folders)
	}
}

// The whole point of replace mode: restoring the same file twice must
// leave the machine in the same state, not with two of everything.
func TestImportReplaceIsIdempotent(t *testing.T) {
	isolateConfig(t)
	seedTwoSessions(t)

	for i := 0; i < 3; i++ {
		if err := ImportBundle(incomingBundle(), ImportReplace); err != nil {
			t.Fatalf("ImportBundle (pass %d): %v", i, err)
		}
	}
	sessions, err := LoadSessions()
	if err != nil {
		t.Fatalf("LoadSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Errorf("got %d sessions after 3 identical restores, want 1", len(sessions))
	}
}

func TestImportMergeRerollsCollidingIDs(t *testing.T) {
	isolateConfig(t)
	seedTwoSessions(t)

	bundle := incomingBundle()
	// Same ID as an existing local session: the local one must survive.
	bundle.Sessions = []SessionProfile{{ID: "local-1", Name: "imported clash"}}

	if err := ImportBundle(bundle, ImportMerge); err != nil {
		t.Fatalf("ImportBundle: %v", err)
	}
	sessions, err := LoadSessions()
	if err != nil {
		t.Fatalf("LoadSessions: %v", err)
	}
	if len(sessions) != 3 {
		t.Fatalf("got %d sessions, want 3", len(sessions))
	}
	seen := map[string]int{}
	for _, s := range sessions {
		seen[s.ID]++
	}
	for id, n := range seen {
		if n != 1 {
			t.Errorf("id %q appears %d times, want each id unique", id, n)
		}
	}
	var kept bool
	for _, s := range sessions {
		if s.ID == "local-1" && s.Name == "local one" {
			kept = true
		}
	}
	if !kept {
		t.Error("the existing local-1 session was overwritten by the colliding import")
	}
}

func TestResetAllClearsEverythingAndBacksUpFirst(t *testing.T) {
	isolateConfig(t)
	seedTwoSessions(t)
	if err := SaveSettings(Settings{FontSize: 21}); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	backup, err := ResetAll()
	if err != nil {
		t.Fatalf("ResetAll: %v", err)
	}
	if backup == "" {
		t.Fatal("ResetAll returned no backup filename")
	}

	sessions, err := LoadSessions()
	if err != nil {
		t.Fatalf("LoadSessions: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("got %d sessions after reset, want none", len(sessions))
	}
	folders, err := LoadFolders()
	if err != nil {
		t.Fatalf("LoadFolders: %v", err)
	}
	if len(folders) != 0 {
		t.Errorf("got %d folders after reset, want none", len(folders))
	}
	settings, err := LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings: %v", err)
	}
	if settings.FontSize != 0 {
		t.Errorf("FontSize = %d after reset, want the zero default", settings.FontSize)
	}

	// The reset is only safe because this puts it all back.
	if err := RestoreBackup(backup); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	sessions, err = LoadSessions()
	if err != nil {
		t.Fatalf("LoadSessions after restore: %v", err)
	}
	if len(sessions) != 2 {
		t.Errorf("got %d sessions after restoring the pre-reset backup, want 2", len(sessions))
	}
	folders, err = LoadFolders()
	if err != nil {
		t.Fatalf("LoadFolders after restore: %v", err)
	}
	if len(folders) != 1 {
		t.Errorf("got %d folders after restore, want 1; RestoreBackup used to drop them", len(folders))
	}
	settings, err = LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings after restore: %v", err)
	}
	if settings.FontSize != 21 {
		t.Errorf("FontSize = %d after restore, want 21", settings.FontSize)
	}
}
