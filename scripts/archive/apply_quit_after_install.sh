#!/usr/bin/env bash
# Run from the root of your Specter repo.
set -euo pipefail

cat > "update.go" << 'SPECTER_EOF_UPDATEGO'
package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	// Aliased: this file already uses the standard library's "runtime"
	// package (runtime.GOOS) for platform detection, Wails' own runtime
	// package (needed here to quit the app so the Windows installer
	// isn't blocked by a file lock on the running exe) would otherwise
	// collide with that name within this file.
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Version is overridden at release-build time via
// -ldflags "-X main.Version=vX.Y.Z" (the git tag being built), set in
// release.yml. Local/dev builds stay "dev", which CheckForUpdate treats
// as "don't bother checking", there's no meaningful version to compare
// against.
var Version = "dev"

type UpdateInfo struct {
	Available      bool   `json:"available"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseURL     string `json:"releaseUrl"`
	// AssetURL is the direct download link for whatever asset matches
	// the CURRENT platform, picked from the release's real assets list
	// rather than a guessed filename, since guessing the exact NSIS
	// installer filename wrong is exactly what broke SPE-71 earlier.
	// Empty if no matching asset was found for this platform.
	AssetURL string `json:"assetUrl"`
}

func (a *App) GetVersion() string {
	return Version
}

// CheckForUpdate queries GitHub's public releases API (no auth needed
// for a public repo) and compares against the running build's version.
// Points at the Dawnrail repo, not Specter's own, Specter's repo stays
// private, but Dawnrail already receives every release automatically
// (see release.yml's second softprops/action-gh-release step), so
// there's a genuinely public target to check against without touching
// Specter's own visibility at all.
func (a *App) CheckForUpdate() (UpdateInfo, error) {
	info := UpdateInfo{CurrentVersion: Version}
	if Version == "dev" {
		return info, nil
	}

	req, err := http.NewRequest(http.MethodGet, "https://api.github.com/repos/Dawnrail/Dawnrail/releases/latest", nil)
	if err != nil {
		return info, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return info, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			// Dawnrail/Dawnrail is public, so a 404 here means either no
			// release has been published there yet, or the org/repo name
			// is wrong, not a privacy issue like the earlier version of
			// this check (which pointed at Specter's own private repo).
			return info, fmt.Errorf("no releases found at Dawnrail/Dawnrail (or the repo name is wrong)")
		}
		return info, fmt.Errorf("github api returned %d", resp.StatusCode)
	}

	var rel struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return info, err
	}

	info.LatestVersion = rel.TagName
	info.ReleaseURL = rel.HTMLURL
	info.Available = isNewerVersion(rel.TagName, Version)

	for _, asset := range rel.Assets {
		if assetMatchesPlatform(asset.Name) {
			info.AssetURL = asset.BrowserDownloadURL
			break
		}
	}
	return info, nil
}

// assetMatchesPlatform picks the right release asset for the platform
// this build is actually running on, by content (does the name mention
// this OS) rather than assuming an exact filename, exact filenames have
// already changed once (SPE-71's NSIS installer rename).
func assetMatchesPlatform(name string) bool {
	n := strings.ToLower(name)
	switch runtime.GOOS {
	case "windows":
		// Prefer the installer over the portable zip when both exist.
		return strings.Contains(n, "windows") && strings.HasSuffix(n, ".exe")
	case "darwin":
		return strings.Contains(n, "macos") || strings.Contains(n, "darwin")
	case "linux":
		return strings.Contains(n, "linux")
	default:
		return false
	}
}

// DownloadAndInstallUpdate downloads the given asset (from
// UpdateInfo.AssetURL) to a temp directory and hands it off to the OS:
//
//   - Windows: the asset is a real NSIS installer, launched directly.
//     This opens the installer's own UI, it does not silently replace
//     anything, the person still clicks through Next/Install/Finish
//     themselves.
//   - macOS/Linux: the asset is a .zip/.tar.gz, there's no native
//     double-click installer format here. Extracted, then the
//     containing folder is revealed in Finder/the file manager, this is
//     the honest equivalent on these platforms, not a literal one-click
//     install, that's a real platform difference, not a shortcut taken.
func (a *App) DownloadAndInstallUpdate(assetURL string) error {
	if assetURL == "" {
		return fmt.Errorf("no update asset available for this platform")
	}

	tmpDir, err := os.MkdirTemp("", "specter-update-*")
	if err != nil {
		return err
	}

	filename := filepath.Base(assetURL)
	destPath := filepath.Join(tmpDir, filename)
	if err := downloadFile(assetURL, destPath); err != nil {
		return fmt.Errorf("download failed: %w", err)
	}

	switch runtime.GOOS {
	case "windows":
		cmd := exec.Command(destPath)
		if err := cmd.Start(); err != nil {
			return err
		}
		// Give the installer a moment to actually launch and show its
		// own window, then quit Specter so its own exe is no longer
		// locked, the installer needs that to overwrite the old files
		// as part of a normal reinstall to the same location (this is
		// the installer's own well-tested behavior, not something
		// Specter deletes manually). Async so this method still returns
		// normally to the frontend first, rather than the app
		// disappearing mid-request.
		go func() {
			time.Sleep(2 * time.Second)
			wailsruntime.Quit(a.ctx)
		}()
		return nil

	case "darwin":
		extractDir := filepath.Join(tmpDir, "extracted")
		if err := unzip(destPath, extractDir); err != nil {
			return fmt.Errorf("extract failed: %w", err)
		}
		return exec.Command("open", extractDir).Start()

	case "linux":
		extractDir := filepath.Join(tmpDir, "extracted")
		if err := untarGz(destPath, extractDir); err != nil {
			return fmt.Errorf("extract failed: %w", err)
		}
		// xdg-open is the standard cross-desktop-environment way to
		// open a folder in whatever file manager is actually
		// installed (Nautilus, Dolphin, etc.), not assuming one.
		return exec.Command("xdg-open", extractDir).Start()

	default:
		return fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
}

func downloadFile(url, destPath string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

// isPathSafe reports whether fpath is destDir itself, or a genuine
// descendant of it, guarding against Zip Slip (archive entries using
// "../" to escape the extraction directory). The bug this fixes: a
// naive HasPrefix(fpath, destDir+separator) check rejects the archive's
// own root entry too (commonly literally named "./" in real tar.gz
// files, confirmed the hard way against the actual Linux release
// artifact), since that entry resolves to exactly destDir with no
// trailing separator to match, a false positive, not a real attack.
func isPathSafe(fpath, destDir string) bool {
	clean := filepath.Clean(destDir)
	return fpath == clean || strings.HasPrefix(fpath, clean+string(os.PathSeparator))
}

func unzip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		fpath := filepath.Join(destDir, f.Name)
		if !isPathSafe(fpath, destDir) {
			return fmt.Errorf("illegal file path in archive: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, 0o755)
			continue
		}
		os.MkdirAll(filepath.Dir(fpath), 0o755)
		src, err := f.Open()
		if err != nil {
			return err
		}
		dst, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			src.Close()
			return err
		}
		_, err = io.Copy(dst, src)
		src.Close()
		dst.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func untarGz(tarGzPath, destDir string) error {
	f, err := os.Open(tarGzPath)
	if err != nil {
		return err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		fpath := filepath.Join(destDir, hdr.Name)
		if !isPathSafe(fpath, destDir) {
			return fmt.Errorf("illegal file path in archive: %s", hdr.Name)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(fpath, 0o755)
		case tar.TypeReg:
			os.MkdirAll(filepath.Dir(fpath), 0o755)
			out, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, os.FileMode(hdr.Mode))
			if err != nil {
				return err
			}
			_, err = io.Copy(out, tr)
			out.Close()
			if err != nil {
				return err
			}
		}
	}
	return nil
}

// isNewerVersion does a simple numeric major.minor.patch comparison of
// "vX.Y.Z"-style tags. Not a full semver implementation (no
// prerelease/build-metadata handling), Specter's own tags are plain
// vX.Y.Z, so this is deliberately kept minimal rather than pulling in a
// semver dependency for something this narrow.
func isNewerVersion(latest, current string) bool {
	lp := parseVersion(latest)
	cp := parseVersion(current)
	for i := 0; i < 3; i++ {
		if lp[i] != cp[i] {
			return lp[i] > cp[i]
		}
	}
	return false
}

func parseVersion(v string) [3]int {
	v = strings.TrimPrefix(v, "v")
	parts := strings.SplitN(v, ".", 3)
	var out [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		n, _ := strconv.Atoi(parts[i])
		out[i] = n
	}
	return out
}
SPECTER_EOF_UPDATEGO

