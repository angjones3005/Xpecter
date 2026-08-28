package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// SPE-87: periodic, automatic safety-net backups of the whole config
// (Settings, Sessions, Groups, LocalShellProfiles), separate from
// SPE-93's manual Export/Import Configuration. This is not
// user-triggered and isn't meant for moving to a new machine, it's
// insurance against a corrupted or accidentally-cleared local config,
// so an accidental clear or on-disk corruption isn't a total loss.
const (
	backupDirName    = "backups"
	backupFilePrefix = "xpecter-backup-"
	// Pre-rename (Specter) prefix, still on disk for anyone who was
	// running the app before the rename. Only read, never written:
	// migrateLegacyConfigDir renames these forward on first launch.
	legacyBackupFilePrefix = "specter-backup-"
	backupFileSuffix       = ".json"
	backupMinInterval      = 24 * time.Hour
	backupRetainCount      = 7
)

func backupDir() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	full := filepath.Join(dir, backupDirName)
	if err := os.MkdirAll(full, 0o700); err != nil {
		return "", err
	}
	return full, nil
}

// ListBackups returns backup filenames (not full paths), newest
// first, for a Restore-from-backup UI to present.
func ListBackups() ([]string, error) {
	dir, err := backupDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), backupFilePrefix) && strings.HasSuffix(e.Name(), backupFileSuffix) {
			names = append(names, e.Name())
		}
	}
	// Filenames embed a sortable timestamp (YYYYMMDD-HHMMSS), so a
	// plain reverse string sort orders them newest-first without
	// needing to parse every one just to list them.
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	return names, nil
}

func parseBackupTimestamp(filename string) (time.Time, error) {
	trimmed := strings.TrimPrefix(filename, backupFilePrefix)
	trimmed = strings.TrimSuffix(trimmed, backupFileSuffix)
	return time.Parse("20060102-150405", trimmed)
}

// BackupIfDue writes a new timestamped backup of the current
// configuration if the newest existing backup is more than
// backupMinInterval old (or none exist yet), then prunes older
// backups beyond backupRetainCount. Called once at app startup
// (app.go's startup(), fire-and-forget), safe to call unconditionally
// on every launch since it's a no-op most days. A filename that fails
// to parse as a timestamp is treated as due rather than blocking
// backups forever on a corrupt/foreign file in the backups directory.
func BackupIfDue() error {
	backups, err := ListBackups()
	if err != nil {
		return err
	}
	if len(backups) > 0 {
		ts, err := parseBackupTimestamp(backups[0])
		if err == nil && time.Since(ts) < backupMinInterval {
			return nil
		}
	}

	bundle, err := ExportBundle()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return err
	}
	dir, err := backupDir()
	if err != nil {
		return err
	}
	filename := backupFilePrefix + time.Now().UTC().Format("20060102-150405") + backupFileSuffix
	if err := os.WriteFile(filepath.Join(dir, filename), data, 0o600); err != nil {
		return err
	}

	return pruneBackups()
}

func pruneBackups() error {
	backups, err := ListBackups()
	if err != nil {
		return err
	}
	if len(backups) <= backupRetainCount {
		return nil
	}
	dir, err := backupDir()
	if err != nil {
		return err
	}
	for _, name := range backups[backupRetainCount:] {
		// Best-effort: a leftover old backup that fails to delete isn't
		// worth failing startup over.
		_ = os.Remove(filepath.Join(dir, name))
	}
	return nil
}

// RestoreBackup replaces the current Settings, Sessions, Groups, and
// LocalShellProfiles with exactly what's in the given backup
// (filename only, resolved against the backups directory, never a
// full/relative path from the caller, so a crafted filename can't
// escape it). Unlike SPE-93's ImportBundle, which merges an imported
// file in alongside existing data, this REPLACES outright: restoring
// after corruption means putting back exactly what was backed up, not
// merging with whatever's currently broken or empty.
func RestoreBackup(filename string) error {
	if strings.ContainsAny(filename, `/\`) {
		return fmt.Errorf("invalid backup filename: %s", filename)
	}
	dir, err := backupDir()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(dir, filename))
	if err != nil {
		return err
	}
	var bundle ConfigBundle
	if err := json.Unmarshal(data, &bundle); err != nil {
		return fmt.Errorf("corrupt backup file: %w", err)
	}
	if err := SaveSettings(bundle.Settings); err != nil {
		return err
	}
	if err := SaveGroups(bundle.Groups); err != nil {
		return err
	}
	if err := SaveSessions(bundle.Sessions); err != nil {
		return err
	}
	return SaveLocalShellProfiles(bundle.LocalShellProfiles)
}
