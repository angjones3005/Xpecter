package config

import (
	"path/filepath"
)

// Settings holds global terminal personalization (SPE-61): a background
// wallpaper, a color scheme preset, and a font. Global rather than
// per-session/per-tab, confirmed scope: "one image for the whole
// terminal pane, not per-tab".
type Settings struct {
	// WallpaperPath references an image file on disk. Deliberately a
	// path rather than embedding the image as base64 in this config
	// file, confirmed choice, keeps settings.json small and lets the
	// user swap the image file without re-saving settings.
	WallpaperPath string `json:"wallpaperPath,omitempty"`

	// WallpaperOpacity is 0.0-1.0, how visible the image is behind the
	// terminal text. Defaults to 0.15 (applied client-side if unset/0)
	// so text stays legible without the user needing to tune it first.
	WallpaperOpacity float64 `json:"wallpaperOpacity,omitempty"`

	// ColorScheme is a preset name matching a key in the frontend's
	// XTERM_THEMES map (e.g. "dark", "light", "dracula", "nord").
	// Plain string, not a Go enum, so new presets are a frontend-only
	// addition, no backend schema change needed.
	ColorScheme string `json:"colorScheme,omitempty"`

	// FontFamily is one of a curated cross-platform-safe list on the
	// frontend, not free text, so a user can't select a font that
	// doesn't exist on their OS.
	FontFamily string `json:"fontFamily,omitempty"`

	// FontSize in points. 0 means "use default" (13).
	FontSize int `json:"fontSize,omitempty"`

	// SSHKeepaliveDisabled (SPE-79). Inverted polarity deliberately:
	// keepalive should default to ON, and Go's zero value for bool is
	// false, so "Disabled" (zero value = false = not disabled = on)
	// gets that default for free, including for any settings.json
	// written before this field existed. A plain "Enabled bool" would
	// have silently defaulted every existing user to keepalive OFF.
	SSHKeepaliveDisabled bool `json:"sshKeepaliveDisabled,omitempty"`
}

func settingsPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "settings.json"), nil
}

func LoadSettings() (Settings, error) {
	path, err := settingsPath()
	if err != nil {
		return Settings{}, err
	}
	return loadJSON(path, Settings{})
}

func SaveSettings(s Settings) error {
	path, err := settingsPath()
	if err != nil {
		return err
	}
	return saveJSON(path, s)
}
