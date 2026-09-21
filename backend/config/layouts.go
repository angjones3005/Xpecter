package config

import (
	"encoding/json"
	"path/filepath"
)

// Layout is a named tab set: what "Save this tab set as…" writes and
// what Home offers under Layouts, so a rack of switches opens as the
// split it was arranged in with one click. Snapshot is the frontend's
// own workspace format (frontend/src/workspace.ts), kept opaque here so
// the two sides can change independently; this package only stores and
// lists it. Like every other config file it carries no passwords: the
// format itself never records one.
type Layout struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Snapshot json.RawMessage `json:"snapshot"`
	SavedAt  string          `json:"savedAt,omitempty"`
}

func layoutsPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "layouts.json"), nil
}

func LoadLayouts() ([]Layout, error) {
	path, err := layoutsPath()
	if err != nil {
		return nil, err
	}
	return loadJSON(path, []Layout{})
}

func SaveLayouts(layouts []Layout) error {
	path, err := layoutsPath()
	if err != nil {
		return err
	}
	return saveJSON(path, layouts)
}

// LogDir is where the application log goes: beside the config files,
// so "open the log folder" lands somewhere the person can also find
// their sessions and backups.
func LogDir() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "logs"), nil
}
