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
)

type SessionProfile struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Type       string   `json:"type,omitempty"` // "" or "ssh" (default), or "serial"
	Host       string   `json:"host,omitempty"`
	Port       int      `json:"port,omitempty"`
	User       string   `json:"user,omitempty"`
	KeyPath    string   `json:"keyPath,omitempty"`
	SerialPort string   `json:"serialPort,omitempty"`
	Baud       int      `json:"baud,omitempty"`
	GroupID    string   `json:"groupId,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	LastUsed   string   `json:"lastUsed,omitempty"`
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

func configDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	full := filepath.Join(dir, "specter")
	if err := os.MkdirAll(full, 0o700); err != nil {
		return "", err
	}
	return full, nil
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
