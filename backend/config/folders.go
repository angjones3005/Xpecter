package config

import (
	"path/filepath"
)

// Folder is a folder pinned to the sidebar (SPE-106): somewhere you
// open in the editor often enough to want one click away. It's the
// editor's counterpart to a saved session, and it's stored the same
// way, so it exports and imports with the rest of the configuration
// rather than living in browser storage that no backup would carry.
//
// Only the path is required. Name is an optional label for the cases
// where a folder's own basename is not descriptive on its own (three
// checkouts all called "src", a bare "config" directory, and so on);
// empty means "show the basename".
type Folder struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Name string `json:"name,omitempty"`
}

func foldersPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "folders.json"), nil
}

func LoadFolders() ([]Folder, error) {
	path, err := foldersPath()
	if err != nil {
		return nil, err
	}
	return loadJSON(path, []Folder{})
}

func SaveFolders(folders []Folder) error {
	path, err := foldersPath()
	if err != nil {
		return err
	}
	return saveJSON(path, folders)
}
