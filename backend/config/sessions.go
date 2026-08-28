// Package config stores saved connection profiles as plain JSON.
//
// Deliberately never stores passwords, MobaXterm's weak, reversible
// password obfuscation is a known real-world weakness and not worth
// copying. Key-based auth (KeyPath) is safe to store since the private
// key itself is already protected by the filesystem / OS keychain.
// If password-saving is wanted later, it belongs in the OS keychain
// (Keychain / Credential Manager / Secret Service), not this file.
package config

import (
	"os"
	"path/filepath"
	"strings"
)

type SessionProfile struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Type          string   `json:"type,omitempty"` // "" or "ssh" (default), or "serial"
	Host          string   `json:"host,omitempty"`
	Port          int      `json:"port,omitempty"`
	User          string   `json:"user,omitempty"`
	KeyPath       string   `json:"keyPath,omitempty"`
	UseAgent      bool     `json:"useAgent,omitempty"`
	InternalAgent bool     `json:"internalAgent,omitempty"`
	X11           bool     `json:"x11,omitempty"`
	SerialPort    string   `json:"serialPort,omitempty"`
	Baud          int      `json:"baud,omitempty"`
	GroupID       string   `json:"groupId,omitempty"`
	Tags          []string `json:"tags,omitempty"`
	LastUsed      string   `json:"lastUsed,omitempty"`
	// Pinned keeps a session at the top of the sidebar and on Home
	// regardless of when it was last used. Recents only help once
	// you have connected recently; this is what makes the panel
	// useful on a cold start. omitempty so existing sessions.json
	// files stay byte-identical until something is actually pinned.
	Pinned bool `json:"pinned,omitempty"`
	// DeviceKind drives the sidebar icon for SSH sessions: "" or "host"
	// (default, a VM/Linux box), "switch" (network switch/router), or
	// "firewall" (e.g. FortiGate). Serial sessions always show their
	// own icon regardless of this field. Plain string rather than a Go
	// enum so new kinds can be added without a schema migration.
	DeviceKind string `json:"deviceKind,omitempty"`
}

// SessionGroup is a folder for organizing sessions. ParentID enables
// nesting, empty ParentID means a top-level folder.
type SessionGroup struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ParentID string `json:"parentId,omitempty"`
}

// configDirName is the on-disk directory every config file lives in.
// legacyConfigDirName is what it was called before the app was renamed
// from Specter to Xpecter: an existing install has all of its sessions,
// settings, folders and backups sitting under the old name, so the
// rename has to bring them across rather than silently presenting the
// user with an empty config.
const (
	configDirName       = "xpecter"
	legacyConfigDirName = "specter"
)

func configDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	full := filepath.Join(dir, configDirName)
	// Only when the new directory doesn't exist yet: once it does, this
	// install has already migrated (or started life after the rename),
	// and an old directory still lying around is stale, not the truth.
	if _, err := os.Stat(full); os.IsNotExist(err) {
		migrateLegacyConfigDir(filepath.Join(dir, legacyConfigDirName), full)
	}
	if err := os.MkdirAll(full, 0o700); err != nil {
		return "", err
	}
	return full, nil
}

// migrateLegacyConfigDir moves the pre-rename config directory to the
// new name, then renames the backup files inside it so ListBackups'
// prefix match still finds them. Best-effort by design, and why the
// caller ignores the outcome: a migration that can't complete (locked
// file, permissions) should leave the app starting on a fresh config,
// never refusing to start at all. The old directory is left untouched
// in that case, so nothing is lost and the next launch retries.
func migrateLegacyConfigDir(legacy, target string) {
	info, err := os.Stat(legacy)
	if err != nil || !info.IsDir() {
		return
	}
	if err := os.Rename(legacy, target); err != nil {
		return
	}
	backups := filepath.Join(target, backupDirName)
	entries, err := os.ReadDir(backups)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasPrefix(name, legacyBackupFilePrefix) {
			continue
		}
		renamed := backupFilePrefix + strings.TrimPrefix(name, legacyBackupFilePrefix)
		_ = os.Rename(filepath.Join(backups, name), filepath.Join(backups, renamed))
	}
}

func sessionsPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "sessions.json"), nil
}

func groupsPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "groups.json"), nil
}

func LoadSessions() ([]SessionProfile, error) {
	path, err := sessionsPath()
	if err != nil {
		return nil, err
	}
	return loadJSON(path, []SessionProfile{})
}

func SaveSessions(sessions []SessionProfile) error {
	path, err := sessionsPath()
	if err != nil {
		return err
	}
	return saveJSON(path, sessions)
}

func LoadGroups() ([]SessionGroup, error) {
	path, err := groupsPath()
	if err != nil {
		return nil, err
	}
	return loadJSON(path, []SessionGroup{})
}

func SaveGroups(groups []SessionGroup) error {
	path, err := groupsPath()
	if err != nil {
		return err
	}
	return saveJSON(path, groups)
}
