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
	"encoding/json"
	"os"
	"path/filepath"
)

type SessionProfile struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Host    string `json:"host"`
	Port    int    `json:"port"`
	User    string `json:"user"`
	KeyPath string `json:"keyPath,omitempty"`
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

func LoadSessions() ([]SessionProfile, error) {
	path, err := sessionsPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []SessionProfile{}, nil
	}
	if err != nil {
		return nil, err
	}
	var sessions []SessionProfile
	if err := json.Unmarshal(data, &sessions); err != nil {
		return nil, err
	}
	return sessions, nil
}

func SaveSessions(sessions []SessionProfile) error {
	path, err := sessionsPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(sessions, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}
