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
	entries := []struct {
		key string
		arg string
	}{
		{`Software\Classes\Directory\shell\OpenInSpecter`, "%1"},
		{`Software\Classes\Directory\Background\shell\OpenInSpecter`, "%V"},
	}
	for _, entry := range entries {
		key, _, err := registry.CreateKey(registry.CURRENT_USER, entry.key, registry.SET_VALUE)
		if err != nil {
			return err
		}
		if err := key.SetStringValue("", "Open in Specter"); err != nil {
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
