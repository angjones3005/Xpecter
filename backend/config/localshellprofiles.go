package config

import (
	"path/filepath"
)

// LocalShellProfile is a saved, reusable local shell profile (SPE-102),
// distinct from SessionProfile which covers SSH/serial. Windows
// Terminal-style: a named shortcut to a command line + starting
// directory + presentation, not a live session.
type LocalShellProfile struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"` // full command line, e.g. "powershell.exe", "/bin/zsh", "wsl.exe -d Ubuntu-24.04"

	// StartingDir reuses SPE-101's SelectDirectory folder picker.
	StartingDir string `json:"startingDir,omitempty"`

	// Icon drives the sidebar/menu icon: "" (default, generic terminal),
	// "powershell", "cmd", or "wsl". Plain string rather than a Go enum,
	// same rationale as SessionProfile.DeviceKind (SPE-60), so new icons
	// can be added without a schema migration.
	Icon string `json:"icon,omitempty"`

	// TabTitle falls back to Name when empty.
	TabTitle string `json:"tabTitle,omitempty"`
}

func localShellProfilesPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "localshellprofiles.json"), nil
}

func LoadLocalShellProfiles() ([]LocalShellProfile, error) {
	path, err := localShellProfilesPath()
	if err != nil {
		return nil, err
	}
	return loadJSON(path, []LocalShellProfile{})
}

func SaveLocalShellProfiles(profiles []LocalShellProfile) error {
	path, err := localShellProfilesPath()
	if err != nil {
		return err
	}
	return saveJSON(path, profiles)
}
