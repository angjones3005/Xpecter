package config

import (
	"encoding/json"
	"os"
)

// loadJSON reads and unmarshals a JSON file into a slice or struct of
// type T. A missing file is not an error, it returns zero (the caller
// passes what "empty" means for T, e.g. []SessionProfile{} or
// Settings{}), matching every config file's original "not found yet"
// behavior.
func loadJSON[T any](path string, empty T) (T, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return empty, nil
	}
	if err != nil {
		return empty, err
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return empty, err
	}
	return v, nil
}

// saveJSON marshals v as indented JSON and writes it to path with
// user-only permissions (0o600), matching every config file's original
// write behavior.
func saveJSON[T any](path string, v T) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

// UpsertByID replaces the element of items whose ID (per getID) matches
// item's own ID, or appends item if no match is found. Shared by
// SaveSession/SaveLocalShellProfile/SaveGroup in app.go, which all
// previously repeated this find-or-append loop independently.
func UpsertByID[T any](items []T, item T, getID func(T) string) []T {
	id := getID(item)
	for i, existing := range items {
		if getID(existing) == id {
			items[i] = item
			return items
		}
	}
	return append(items, item)
}

// RemoveByID returns items with the element whose ID (per getID) equals
// id removed, if present. Shared by
// DeleteSession/DeleteLocalShellProfile/DeleteGroup in app.go, which all
// previously repeated this filter loop independently.
func RemoveByID[T any](items []T, id string, getID func(T) string) []T {
	kept := items[:0]
	for _, item := range items {
		if getID(item) != id {
			kept = append(kept, item)
		}
	}
	return kept
}
