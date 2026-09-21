//go:build windows

package main

import (
	"errors"
	"sort"
	"strconv"

	"xpecter/backend/config"

	"golang.org/x/sys/windows/registry"
)

const puttySessionsKey = `Software\SimonTatham\PuTTY\Sessions`

// readPuTTYSessions reads every saved session PuTTY has for the current
// user. A machine without PuTTY has no key, which is reported as such
// rather than as an empty import.
func readPuTTYSessions() ([]config.SessionProfile, error) {
	root, err := registry.OpenKey(registry.CURRENT_USER, puttySessionsKey, registry.READ)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return nil, errors.New("PuTTY has no saved sessions on this machine (or is not installed)")
		}
		return nil, err
	}
	defer root.Close()
	names, err := root.ReadSubKeyNames(-1)
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	var profiles []config.SessionProfile
	for _, name := range names {
		key, err := registry.OpenKey(root, name, registry.READ)
		if err != nil {
			continue
		}
		get := func(field string) (string, bool) {
			if s, _, err := key.GetStringValue(field); err == nil {
				return s, true
			}
			if n, _, err := key.GetIntegerValue(field); err == nil {
				return strconv.FormatUint(n, 10), true
			}
			return "", false
		}
		profile, ok := puttyToProfile(name, get)
		key.Close()
		if ok {
			profiles = append(profiles, profile)
		}
	}
	return profiles, nil
}
