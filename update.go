package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
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
}

func (a *App) GetVersion() string {
	return Version
}

// CheckForUpdate queries GitHub's public releases API (no auth needed
// for a public repo) and compares against the running build's version.
// Deliberately just a check, not an installer: no auto-download, no
// silent replace, see the SPE discussion on why (code signing cost,
// failure surface) before this got built.
func (a *App) CheckForUpdate() (UpdateInfo, error) {
	info := UpdateInfo{CurrentVersion: Version}
	if Version == "dev" {
		return info, nil
	}

	req, err := http.NewRequest(http.MethodGet, "https://api.github.com/repos/angjones3005/Specter/releases/latest", nil)
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
			// GitHub's API returns 404 (not 403) for a private repo when
			// unauthenticated, to avoid leaking whether it exists. This
			// is expected right now, Specter's repo is currently
			// private, and will resolve itself with zero code changes
			// once it goes public. Distinguishing this from a real
			// network failure avoids a misleading "check your internet
			// connection" message for what's actually just "not public
			// yet".
			return info, fmt.Errorf("repository not found or not public (this is expected while the repo is private)")
		}
		return info, fmt.Errorf("github api returned %d", resp.StatusCode)
	}

	var rel struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return info, err
	}

	info.LatestVersion = rel.TagName
	info.ReleaseURL = rel.HTMLURL
	info.Available = isNewerVersion(rel.TagName, Version)
	return info, nil
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
