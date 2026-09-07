package config

import (
	"fmt"

	"xpecter/backend/idgen"
)

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

// ImportMode selects what an imported bundle does to what is already
// on this machine. The two answer different questions: ImportMerge is
// "add these to what I have", ImportReplace is "make this machine look
// like the file".
type ImportMode int

const (
	// ImportMerge appends the bundle's entries alongside the existing
	// ones and deletes nothing. The original and still the default.
	ImportMerge ImportMode = iota
	// ImportReplace discards what is here and installs the bundle
	// exactly. This is what makes restoring a backup file idempotent:
	// merging the same export twice leaves two of every session, which
	// is never what someone restoring a machine wanted.
	ImportReplace
)

// ImportBundle applies an imported ConfigBundle. Settings is a single
// set of values (wallpaper/theme/font/etc.), there's no sensible way
// to "merge" a single font choice, so it's replaced outright in both
// modes. Sessions, Groups, LocalShellProfiles and Folders are lists,
// so the mode decides: merged in alongside what's already here, or
// swapped for the bundle's contents.
//
// In merge mode existing local entries are never deleted or
// overwritten. An imported item whose ID happens to collide with an
// existing local one (astronomically unlikely given IDs are random hex,
// but cheap to guard against anyway) gets a fresh ID rather than
// silently overwriting the local entry, so nothing is lost on either
// side.
func ImportBundle(bundle ConfigBundle, mode ImportMode) error {
	if err := SaveSettings(bundle.Settings); err != nil {
		return err
	}

	if mode == ImportReplace {
		// Normalised to empty slices rather than written as nil: a
		// bundle exported before Folders existed has none, and writing
		// JSON null where every other config file holds a list is a
		// difference waiting to trip up something that reads it later.
		if err := SaveGroups(nonNil(bundle.Groups)); err != nil {
			return err
		}
		if err := SaveSessions(nonNil(bundle.Sessions)); err != nil {
			return err
		}
		if err := SaveLocalShellProfiles(nonNil(bundle.LocalShellProfiles)); err != nil {
			return err
		}
		return SaveFolders(nonNil(bundle.Folders))
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

// ResetAll clears everything an export captures, returning this machine
// to the state a fresh install is in: no sessions, groups, local shell
// profiles or pinned folders, and default appearance settings.
//
// A backup is written first, unconditionally, and its filename is
// returned. That is the whole safety story for an action with no undo:
// the Restore from backup UI already exists, so a reset the user
// regrets is one dialog away from being put back. If the backup can't
// be written, nothing is cleared, because a wipe with no way back is a
// worse outcome than a wipe that didn't happen.
//
// Passwords are not mentioned here because Xpecter never stores them
// (see the package comment in sessions.go); there is nothing to clear.
func ResetAll() (string, error) {
	backup, err := BackupNow()
	if err != nil {
		return "", fmt.Errorf("refusing to reset, could not write a backup first: %w", err)
	}
	if err := SaveSettings(Settings{}); err != nil {
		return backup, err
	}
	if err := SaveGroups([]SessionGroup{}); err != nil {
		return backup, err
	}
	if err := SaveSessions([]SessionProfile{}); err != nil {
		return backup, err
	}
	if err := SaveLocalShellProfiles([]LocalShellProfile{}); err != nil {
		return backup, err
	}
	if err := SaveFolders([]Folder{}); err != nil {
		return backup, err
	}
	return backup, nil
}

// nonNil turns a nil slice into an empty one so it marshals as [] and
// not null.
func nonNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}

// idSet builds a lookup set of IDs from a slice of any type that has
// one, shared by ImportBundle's merge-mode collision checks above.
func idSet[T any](items []T, getID func(T) string) map[string]bool {
	set := make(map[string]bool, len(items))
	for _, item := range items {
		set[getID(item)] = true
	}
	return set
}
