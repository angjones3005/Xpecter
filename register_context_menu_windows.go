//go:build windows

package main

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows/registry"
)

func registerContextMenu() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// The pre-rename build registered these under "OpenInSpecter".
	// Nothing else ever deletes them, so without this an upgraded
	// install shows two entries in Explorer's context menu, the stale
	// one pointing at an exe that no longer exists. Best-effort: a key
	// that was never written, or that won't delete, is no reason to
	// skip registering the current entries below.
	removeLegacyContextMenu()

	entries := []struct {
		key string
		arg string
	}{
		{`Software\Classes\Directory\shell\OpenInXpecter`, "%1"},
		{`Software\Classes\Directory\Background\shell\OpenInXpecter`, "%V"},
	}
	for _, entry := range entries {
		key, _, err := registry.CreateKey(registry.CURRENT_USER, entry.key, registry.SET_VALUE)
		if err != nil {
			return err
		}
		if err := key.SetStringValue("", "Open in Xpecter"); err != nil {
			key.Close()
			return err
		}
		if err := key.SetStringValue("Icon", exe); err != nil {
			key.Close()
			return err
		}
		command, _, err := registry.CreateKey(key, "command", registry.SET_VALUE)
		if err != nil {
			key.Close()
			return err
		}
		if err := command.SetStringValue("", fmt.Sprintf(`"%s" "%s"`, exe, entry.arg)); err != nil {
			command.Close()
			key.Close()
			return err
		}
		command.Close()
		key.Close()
	}
	return nil
}

// removeLegacyContextMenu deletes the context-menu keys written under
// the app's old (Specter) name. Windows refuses to delete a key that
// still has subkeys, so "command" has to go before its parent.
func removeLegacyContextMenu() {
	for _, key := range []string{
		`Software\Classes\Directory\shell\OpenInSpecter`,
		`Software\Classes\Directory\Background\shell\OpenInSpecter`,
	} {
		_ = registry.DeleteKey(registry.CURRENT_USER, key+`\command`)
		_ = registry.DeleteKey(registry.CURRENT_USER, key)
	}
}
