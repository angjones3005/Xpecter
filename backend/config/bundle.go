package config

import "specter/backend/idgen"

// configBundleVersion lets a future release detect and migrate an
// older exported file if the bundle shape ever needs to change.
const configBundleVersion = 1

// ConfigBundle is the full portable snapshot exported/imported by
// SPE-93. Deliberately does NOT include passwords (SessionProfile
// never stores them in the first place, see sessions.go) or
// known_hosts (SSH host-key trust is host-specific; re-verifying trust
// on a new machine is the correct, expected behavior, not something a
// config import should silently carry over).
type ConfigBundle struct {
	Version            int                 `json:"version"`
	Settings           Settings            `json:"settings"`
	Sessions           []SessionProfile    `json:"sessions"`
	Groups             []SessionGroup      `json:"groups"`
	LocalShellProfiles []LocalShellProfile `json:"localShellProfiles"`
	Folders            []Folder            `json:"folders,omitempty"`
}

// ExportBundle gathers the current Settings, Sessions, Groups, and
// LocalShellProfiles into a single portable snapshot for SaveTextFile/
// ExportConfigFile in app.go to write out.
func ExportBundle() (ConfigBundle, error) {
	settings, err := LoadSettings()
	if err != nil {
		return ConfigBundle{}, err
	}
	sessions, err := LoadSessions()
	if err != nil {
		return ConfigBundle{}, err
	}
	groups, err := LoadGroups()
	if err != nil {
		return ConfigBundle{}, err
	}
	profiles, err := LoadLocalShellProfiles()
	if err != nil {
		return ConfigBundle{}, err
	}
	folders, err := LoadFolders()
	if err != nil {
		return ConfigBundle{}, err
	}
	return ConfigBundle{
		Version:            configBundleVersion,
		Settings:           settings,
		Sessions:           sessions,
		Groups:             groups,
		LocalShellProfiles: profiles,
		Folders:            folders,
	}, nil
}

// ImportBundle applies an imported ConfigBundle. Settings is a single
// set of values (wallpaper/theme/font/etc.), there's no sensible way
// to "merge" a single font choice, so it's replaced outright. Sessions,
// Groups, and LocalShellProfiles are lists, so they're merged instead:
// appended alongside whatever's already on this machine, existing
// local entries are never deleted or overwritten. An imported item
// whose ID happens to collide with an existing local one (astronomically
// unlikely given IDs are random hex, but cheap to guard against
// anyway) gets a fresh ID rather than silently overwriting the local
// entry, so nothing is ever lost on either side.
func ImportBundle(bundle ConfigBundle) error {
	if err := SaveSettings(bundle.Settings); err != nil {
		return err
	}

	groups, err := LoadGroups()
	if err != nil {
		return err
	}
	existingGroupIDs := idSet(groups, func(g SessionGroup) string { return g.ID })
	for _, g := range bundle.Groups {
		if existingGroupIDs[g.ID] {
			g.ID = idgen.New()
		}
		groups = append(groups, g)
	}
	if err := SaveGroups(groups); err != nil {
		return err
	}

	sessions, err := LoadSessions()
	if err != nil {
		return err
	}
	existingSessionIDs := idSet(sessions, func(s SessionProfile) string { return s.ID })
	for _, s := range bundle.Sessions {
		if existingSessionIDs[s.ID] {
			s.ID = idgen.New()
		}
		sessions = append(sessions, s)
	}
	if err := SaveSessions(sessions); err != nil {
		return err
	}

	profiles, err := LoadLocalShellProfiles()
	if err != nil {
		return err
	}
	existingProfileIDs := idSet(profiles, func(p LocalShellProfile) string { return p.ID })
	for _, p := range bundle.LocalShellProfiles {
		if existingProfileIDs[p.ID] {
			p.ID = idgen.New()
		}
		profiles = append(profiles, p)
	}
	if err := SaveLocalShellProfiles(profiles); err != nil {
		return err
	}

	// Absent from any bundle exported before SPE-106, which is just an
	// empty list to merge in, so no version bump is needed.
	folders, err := LoadFolders()
	if err != nil {
		return err
	}
	existingFolderIDs := idSet(folders, func(f Folder) string { return f.ID })
	for _, f := range bundle.Folders {
		if existingFolderIDs[f.ID] {
			f.ID = idgen.New()
		}
		folders = append(folders, f)
	}
	return SaveFolders(folders)
}

// idSet builds a lookup set of IDs from a slice of any type that has
// one, shared by ImportBundle's three collision checks above.
func idSet[T any](items []T, getID func(T) string) map[string]bool {
	set := make(map[string]bool, len(items))
	for _, item := range items {
		set[getID(item)] = true
	}
	return set
}
