package main

import (
	"bufio"
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// --- Find in files ---
//
// Monaco searches the buffer in front of you. A folder of configs or a
// vault of notes wants the question asked of every file in it, which
// is this: a walk of the workspace folder, line by line, answered as a
// list the editor turns into "open this file at that line".

// SearchHit is one matching line.
type SearchHit struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Text   string `json:"text"`
}

// SearchResult is what SearchLocalFiles hands back: the hits, and
// whether it stopped before the folder was exhausted (too many hits,
// or too long).
type SearchResult struct {
	Hits      []SearchHit `json:"hits"`
	Truncated bool        `json:"truncated"`
	Files     int         `json:"files"`
}

const (
	searchMaxHits        = 1000
	searchMaxHitsPerFile = 100
	searchMaxFileBytes   = 2 << 20 // 2 MiB: anything larger is a log or a dump, not a file to edit
	searchMaxLineChars   = 240
	searchTimeBudget     = 10 * time.Second
)

// Folders no search wants to walk: dependencies, version control, and
// build output, which is where a workspace's line count actually lives.
var searchSkippedDirs = map[string]bool{
	"node_modules": true, ".git": true, ".svn": true, ".hg": true, "dist": true, "build": true,
	"target": true, "vendor": true, "__pycache__": true, ".venv": true, "venv": true,
}

// SearchLocalFiles finds query in every text file under root. regex
// reads the query as a regular expression rather than literally, and
// caseSensitive does what it says. Dot-directories and the usual heavy
// folders are skipped, as are binary files and anything over 2 MiB.
func (a *App) SearchLocalFiles(root string, query string, regex bool, caseSensitive bool) (SearchResult, error) {
	if strings.TrimSpace(root) == "" || query == "" {
		return SearchResult{Hits: []SearchHit{}}, errors.New("a folder and something to search for are both required")
	}
	pattern, err := searchPattern(query, regex, caseSensitive)
	if err != nil {
		return SearchResult{Hits: []SearchHit{}}, err
	}
	result := SearchResult{Hits: []SearchHit{}}
	deadline := time.Now().Add(searchTimeBudget)
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() && path != root {
				return filepath.SkipDir
			}
			return nil
		}
		if time.Now().After(deadline) || len(result.Hits) >= searchMaxHits {
			result.Truncated = true
			return filepath.SkipAll
		}
		if d.IsDir() {
			name := d.Name()
			if path != root && (strings.HasPrefix(name, ".") || searchSkippedDirs[name]) {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > searchMaxFileBytes {
			return nil
		}
		result.Files++
		hits, more := searchFile(path, pattern)
		result.Hits = append(result.Hits, hits...)
		if more {
			result.Truncated = true
		}
		return nil
	})
	if walkErr != nil {
		return result, walkErr
	}
	if len(result.Hits) > searchMaxHits {
		result.Hits = result.Hits[:searchMaxHits]
		result.Truncated = true
	}
	return result, nil
}

// searchPattern compiles what was typed. A literal search is a quoted
// regular expression, so one matcher serves both.
func searchPattern(query string, regex bool, caseSensitive bool) (*regexp.Regexp, error) {
	expr := query
	if !regex {
		expr = regexp.QuoteMeta(query)
	}
	if !caseSensitive {
		expr = "(?i)" + expr
	}
	return regexp.Compile(expr)
}

// searchFile scans one file. A NUL in the first 8 KB is git's test for
// a binary file, and the answer here too. The second result reports
// that the file had more hits than were kept.
func searchFile(path string, pattern *regexp.Regexp) ([]SearchHit, bool) {
	f, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	defer func() { _ = f.Close() }()
	reader := bufio.NewReaderSize(f, 64<<10)
	head, _ := reader.Peek(8000)
	if bytes.IndexByte(head, 0) >= 0 {
		return nil, false
	}
	var hits []SearchHit
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
	line := 0
	for scanner.Scan() {
		line++
		text := scanner.Text()
		loc := pattern.FindStringIndex(text)
		if loc == nil {
			continue
		}
		if len(hits) >= searchMaxHitsPerFile {
			return hits, true
		}
		hits = append(hits, SearchHit{
			Path:   path,
			Line:   line,
			Column: len([]rune(text[:loc[0]])) + 1,
			Text:   trimSearchLine(text, loc[0]),
		})
	}
	return hits, false
}

// trimSearchLine keeps a line readable in a results list: a long line
// is cut down to a window around the match rather than to its start,
// which for a minified file would show nothing of interest.
func trimSearchLine(text string, matchAt int) string {
	runes := []rune(text)
	if len(runes) <= searchMaxLineChars {
		return strings.TrimSpace(text)
	}
	at := len([]rune(text[:matchAt]))
	start := at - searchMaxLineChars/3
	if start < 0 {
		start = 0
	}
	end := start + searchMaxLineChars
	if end > len(runes) {
		end = len(runes)
		start = end - searchMaxLineChars
	}
	out := string(runes[start:end])
	if start > 0 {
		out = "…" + out
	}
	if end < len(runes) {
		out += "…"
	}
	return strings.TrimSpace(out)
}
