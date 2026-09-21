package config

import (
	"bytes"
	"encoding/json"
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

// The encrypted export is the file most likely to be picked by mistake:
// it sits beside the plain one and passes the dialog's *.json filter.
// It decoded as an empty bundle, and Replace then erased everything.
func TestParseBundleRejectsWhatIsNotAnExport(t *testing.T) {
	cases := map[string]string{
		"encrypted envelope": `{"version":1,"salt":"c2FsdA==","nonce":"bm9uY2U=","data":"ZGF0YQ=="}`,
		"package.json":       `{"name":"xpecter","version":"1.0.0","scripts":{}}`,
		"empty object":       `{}`,
		"an array":           `[{"id":"1","name":"a session"}]`,
		"not json":           `sessions: []`,
	}
	for name, data := range cases {
		if _, err := ParseBundle([]byte(data)); err == nil {
			t.Errorf("%s was accepted as a config bundle", name)
		}
	}
}

func TestParseBundleAcceptsARealExport(t *testing.T) {
	isolateConfig(t)
	seedTwoSessions(t)
	bundle, err := ExportBundle()
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(bundle)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseBundle(data)
	if err != nil {
		t.Fatalf("a genuine export was refused: %v", err)
	}
	if len(parsed.Sessions) != 2 {
		t.Fatalf("parsed %d sessions, want 2", len(parsed.Sessions))
	}
	// An export with nothing in it is still an export.
	if _, err := ParseBundle([]byte(`{"version":1,"settings":{},"sessions":[],"groups":[],"localShellProfiles":[]}`)); err != nil {
		t.Errorf("an empty export was refused: %v", err)
	}
	if _, err := ParseBundle([]byte(`{"version":9,"sessions":[]}`)); err == nil {
		t.Error("a bundle from a newer format version was accepted")
	}
}

// Replace mode discards what is here, so what is here is backed up
// first, the same rule ResetAll keeps.
func TestImportReplaceWritesABackupFirst(t *testing.T) {
	isolateConfig(t)
	seedTwoSessions(t)

	if err := ImportBundle(incomingBundle(), ImportReplace); err != nil {
		t.Fatalf("ImportBundle: %v", err)
	}
	backups, err := ListBackups()
	if err != nil {
		t.Fatal(err)
	}
	if len(backups) != 1 {
		t.Fatalf("got %d backups after a replace import, want the one taken beforehand", len(backups))
	}
	if err := RestoreBackup(backups[0]); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	sessions, err := LoadSessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 2 || sessions[0].ID != "local-1" {
		t.Fatalf("the pre-import backup restored %+v, want the two seeded sessions", sessions)
	}
}

// Merging your own export back in collides on every id. A group that is
// given a fresh id must still be the folder of its sessions and the
// parent of its child groups, or the result is an empty duplicate of
// every folder with the sessions left in the originals.
func TestImportMergeRepointsGroupLinksAfterReroll(t *testing.T) {
	isolateConfig(t)
	if err := SaveGroups([]SessionGroup{
		{ID: "g-parent", Name: "Datacentre"},
		{ID: "g-child", Name: "Rack 1", ParentID: "g-parent"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := SaveSessions([]SessionProfile{{ID: "s-1", Name: "sw1", GroupID: "g-child"}}); err != nil {
		t.Fatal(err)
	}
	bundle, err := ExportBundle()
	if err != nil {
		t.Fatal(err)
	}

	if err := ImportBundle(bundle, ImportMerge); err != nil {
		t.Fatalf("ImportBundle: %v", err)
	}
	groups, err := LoadGroups()
	if err != nil {
		t.Fatal(err)
	}
	sessions, err := LoadSessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 4 || len(sessions) != 2 {
		t.Fatalf("got %d groups and %d sessions, want 4 and 2", len(groups), len(sessions))
	}
	byID := map[string]SessionGroup{}
	for _, g := range groups {
		byID[g.ID] = g
	}
	for _, s := range sessions {
		g, ok := byID[s.GroupID]
		if !ok {
			t.Errorf("session %s points at group %q, which does not exist", s.ID, s.GroupID)
			continue
		}
		if g.Name != "Rack 1" {
			t.Errorf("session %s landed in %q, want Rack 1", s.ID, g.Name)
		}
		parent, ok := byID[g.ParentID]
		if !ok || parent.Name != "Datacentre" {
			t.Errorf("group %s has parent %q, want a Datacentre group", g.ID, g.ParentID)
		}
	}
	// The two imported copies must not share ids with the originals.
	seen := map[string]int{}
	for _, g := range groups {
		seen[g.ID]++
	}
	for id, n := range seen {
		if n != 1 {
			t.Errorf("group id %q appears %d times", id, n)
		}
	}
}

// A named layout travels with the rest of the configuration: exported,
// replaced, merged with a fresh id when it collides, and cleared by a
// reset. Its snapshot is opaque to this package and must come back
// byte for byte.
func TestLayoutsRoundTripThroughBundles(t *testing.T) {
	isolateConfig(t)
	snapshot := json.RawMessage(`{"version":1,"tabs":[{"label":"rack","panes":[{"kind":"local","shell":"pwsh.exe","dir":""}]}]}`)
	if err := SaveLayouts([]Layout{{ID: "lay-1", Name: "Lab rack", Snapshot: snapshot}}); err != nil {
		t.Fatal(err)
	}
	bundle, err := ExportBundle()
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.Layouts) != 1 || compactJSON(t, bundle.Layouts[0].Snapshot) != compactJSON(t, snapshot) {
		t.Fatalf("exported layouts = %+v", bundle.Layouts)
	}

	// Merging the export back in collides on the id and keeps both.
	if err := ImportBundle(bundle, ImportMerge); err != nil {
		t.Fatal(err)
	}
	layouts, err := LoadLayouts()
	if err != nil {
		t.Fatal(err)
	}
	if len(layouts) != 2 || layouts[0].ID == layouts[1].ID {
		t.Fatalf("after merge: %+v", layouts)
	}

	// Replacing installs exactly the bundle's one.
	if err := ImportBundle(bundle, ImportReplace); err != nil {
		t.Fatal(err)
	}
	layouts, err = LoadLayouts()
	if err != nil {
		t.Fatal(err)
	}
	if len(layouts) != 1 || layouts[0].Name != "Lab rack" || compactJSON(t, layouts[0].Snapshot) != compactJSON(t, snapshot) {
		t.Fatalf("after replace: %+v", layouts)
	}

	if _, err := ResetAll(); err != nil {
		t.Fatal(err)
	}
	layouts, err = LoadLayouts()
	if err != nil {
		t.Fatal(err)
	}
	if len(layouts) != 0 {
		t.Fatalf("after reset: %+v", layouts)
	}
}

// The snapshot is stored indented like every other config file, so it
// is compared by content rather than by bytes.
func compactJSON(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}
