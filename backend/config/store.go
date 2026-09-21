package config

import (
	"encoding/json"
	"os"

	"xpecter/backend/atomicfile"
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
// user-only permissions (0o600). Written atomically: these files are
// the whole of what the app remembers, and a truncate-then-write that
// dies between the two steps leaves sessions.json empty, which the next
// launch reports as "unexpected end of JSON input" for everything.
func saveJSON[T any](path string, v T) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.Write(path, data, 0o600)
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

// ReorderByID returns items arranged in the order ids lists them: the
// order the user dragged the sidebar into. An item ids does not mention
// follows the listed ones in its old relative order, an id that names
// nothing is ignored, and a repeated id counts once, so a stale list
// from the UI can neither lose nor duplicate anything. The input slice
// is left as it was.
func ReorderByID[T any](items []T, ids []string, getID func(T) string) []T {
	index := make(map[string]int, len(items))
	for i, item := range items {
		index[getID(item)] = i
	}
	out := make([]T, 0, len(items))
	placed := make([]bool, len(items))
	for _, id := range ids {
		if i, ok := index[id]; ok && !placed[i] {
			placed[i] = true
			out = append(out, items[i])
		}
	}
	for i, item := range items {
		if !placed[i] {
			out = append(out, item)
		}
	}
	return out
}
