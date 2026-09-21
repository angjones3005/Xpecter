package main

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"xpecter/backend/idgen"
	"xpecter/backend/sftpclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// --- File transfers with progress ---
//
// The remote browser could upload, by dropping files onto it, and could
// not download at all: a file on a host could be opened through a
// temporary copy and nothing else. Both directions now stream through
// Go, which is the only side with a file on disk to stream to, and
// report as they go on the "transfer:progress" event so the sidebar can
// show a bar rather than a spinner that may or may not be moving.

// TransferProgress is one event on "transfer:progress". A transfer is
// one file, or one folder with every file in it, and reports bytes for
// the whole of it.
type TransferProgress struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Direction string `json:"direction"` // "download" or "upload"
	Done      int64  `json:"done"`
	Total     int64  `json:"total"`
	// For a folder or a batch: how many files there are, and how many
	// have finished.
	Files     int    `json:"files,omitempty"`
	FilesDone int    `json:"filesDone,omitempty"`
	State     string `json:"state"` // "running", "done" or "failed"
	Error     string `json:"error,omitempty"`
}

// transferReportInterval is how often a running transfer reports. Any
// faster floods the bridge with events for a bar nobody can see move.
const transferReportInterval = 100 * time.Millisecond

// transferReporter throttles a transfer's progress into events.
type transferReporter struct {
	a    *App
	mu   sync.Mutex
	last time.Time
	p    TransferProgress
}

func (a *App) startTransfer(name, direction string, total int64, files int) *transferReporter {
	r := &transferReporter{a: a, p: TransferProgress{
		ID: idgen.New(), Name: name, Direction: direction, Total: total, Files: files, State: "running",
	}}
	r.emit()
	return r
}

// advance records the bytes moved so far. It has the shape of
// sftpclient.Progress so a single-file transfer can hand it over as is;
// the size it is told is the one it already knows.
func (r *transferReporter) advance(done int64, _ int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.p.Done = done
	now := time.Now()
	if !shouldReport(now, r.last, done, r.p.Total) {
		return
	}
	r.last = now
	r.emit()
}

// fileDone records one more finished file in a folder or a batch.
func (r *transferReporter) fileDone(done int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.p.Done = done
	r.p.FilesDone++
	r.last = time.Now()
	r.emit()
}

func (r *transferReporter) finish(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err != nil {
		r.p.State = "failed"
		r.p.Error = err.Error()
		logf("transfer", "%s of %s failed: %v", r.p.Direction, r.p.Name, err)
	} else {
		r.p.State = "done"
		r.p.Done = r.p.Total
		logf("transfer", "%s of %s done (%d bytes)", r.p.Direction, r.p.Name, r.p.Total)
	}
	r.emit()
}

// emit sends the current state. Callers hold the mutex or are the only
// goroutine touching the reporter.
func (r *transferReporter) emit() {
	if r.a.ctx == nil {
		return
	}
	runtime.EventsEmit(r.a.ctx, "transfer:progress", r.p)
}

// shouldReport decides whether a progress update is worth an event:
// the interval keeps a fast transfer from flooding the bridge, and one
// at its end always reports, so the bar reaches the end.
func shouldReport(now, last time.Time, done, total int64) bool {
	if total > 0 && done >= total {
		return true
	}
	return now.Sub(last) >= transferReportInterval
}

// SaveRemoteFileAs downloads one remote file to a place the person
// picks. Returns "" (no error) when the dialog is cancelled, the local
// path otherwise.
func (a *App) SaveRemoteFileAs(id string, remotePath string) (string, error) {
	sess, err := a.session(id)
	if err != nil {
		return "", err
	}
	name := path.Base(remotePath)
	localPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Download " + name,
		DefaultFilename: name,
	})
	if err != nil {
		return "", err
	}
	if localPath == "" {
		return "", nil
	}
	size, err := sftpclient.StatFile(sess.SSHClient(), remotePath)
	if err != nil {
		return "", err
	}
	r := a.startTransfer(name, "download", size, 1)
	err = sftpclient.DownloadFileWithProgress(sess.SSHClient(), remotePath, localPath, r.advance)
	r.finish(err)
	if err != nil {
		return "", err
	}
	return localPath, nil
}

// DownloadRemoteFolder downloads a whole remote directory into a local
// folder the person picks, as a folder of the same name inside it.
// Returns "" (no error) when the dialog is cancelled. A folder of that
// name already there is refused rather than merged into: a download
// should never overwrite something that was not part of it.
func (a *App) DownloadRemoteFolder(id string, remotePath string) (string, error) {
	sess, err := a.session(id)
	if err != nil {
		return "", err
	}
	name := path.Base(remotePath)
	if name == "." || name == "/" || name == "" {
		name = "home"
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Download " + name + " into…",
	})
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", nil
	}
	localRoot := filepath.Join(dir, name)
	if _, err := os.Stat(localRoot); err == nil {
		return "", fmt.Errorf("%s already exists in %s; choose another folder or rename it first", name, dir)
	}

	entries, err := sftpclient.WalkFiles(sess.SSHClient(), remotePath)
	if err != nil {
		return "", err
	}
	var total int64
	files := 0
	for _, e := range entries {
		if !e.IsDir {
			total += e.Size
			files++
		}
	}
	r := a.startTransfer(name, "download", total, files)
	if err := os.MkdirAll(localRoot, 0o755); err != nil {
		r.finish(err)
		return "", err
	}
	var done int64
	for _, e := range entries {
		local, err := localPathFor(localRoot, remotePath, e.Path)
		if err != nil {
			r.finish(err)
			return "", err
		}
		if e.IsDir {
			if err := os.MkdirAll(local, 0o755); err != nil {
				r.finish(err)
				return "", err
			}
			continue
		}
		base := done
		err = sftpclient.DownloadFileWithProgress(sess.SSHClient(), e.Path, local, func(d, _ int64) { r.advance(base+d, 0) })
		if err != nil {
			err = fmt.Errorf("%s: %w", e.Path, err)
			r.finish(err)
			return "", err
		}
		done += e.Size
		r.fileDone(done)
	}
	r.finish(nil)
	return localRoot, nil
}

// localPathFor maps a path the server reported under remoteRoot onto
// the folder the download lands in. Every segment is checked, and so is
// the result: the names come from the host, and a host that answers a
// listing with "../.." must not be able to write outside the folder
// that was chosen for it.
func localPathFor(localRoot, remoteRoot, remotePath string) (string, error) {
	cleanRoot := filepath.Clean(localRoot)
	if remotePath == remoteRoot {
		return cleanRoot, nil
	}
	var rel string
	if remoteRoot == "." {
		rel = remotePath
	} else {
		prefix := strings.TrimSuffix(remoteRoot, "/") + "/"
		if !strings.HasPrefix(remotePath, prefix) {
			return "", fmt.Errorf("%s is not inside %s", remotePath, remoteRoot)
		}
		rel = strings.TrimPrefix(remotePath, prefix)
	}
	for _, seg := range strings.Split(rel, "/") {
		if seg == "" || seg == "." || seg == ".." || strings.ContainsAny(seg, `\:`) {
			return "", fmt.Errorf("refusing to write %q: the host reported a name that is not a plain file name", remotePath)
		}
	}
	full := filepath.Join(cleanRoot, filepath.FromSlash(rel))
	if full != cleanRoot && !strings.HasPrefix(full, cleanRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("refusing to write %q outside %s", remotePath, cleanRoot)
	}
	return full, nil
}

// UploadLocalFiles asks for files and uploads them into remoteDir,
// streaming each from disk with progress. Returns the names uploaded,
// or nothing when the dialog is cancelled.
func (a *App) UploadLocalFiles(id string, remoteDir string) ([]string, error) {
	sess, err := a.session(id)
	if err != nil {
		return nil, err
	}
	where := remoteDir
	if where == "." || where == "" {
		where = "the home directory"
	}
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Upload to " + where,
	})
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, nil
	}

	var total int64
	sizes := make(map[string]int64, len(paths))
	for _, local := range paths {
		info, err := os.Stat(local)
		if err != nil {
			return nil, err
		}
		if info.IsDir() {
			return nil, fmt.Errorf("%s is a folder; upload the files inside it", filepath.Base(local))
		}
		sizes[local] = info.Size()
		total += info.Size()
	}
	label := filepath.Base(paths[0])
	if len(paths) > 1 {
		label = fmt.Sprintf("%d files", len(paths))
	}
	r := a.startTransfer(label, "upload", total, len(paths))
	var done int64
	uploaded := []string{}
	for _, local := range paths {
		name := filepath.Base(local)
		info, err := os.Stat(local)
		if err != nil {
			r.finish(err)
			return uploaded, err
		}
		base := done
		err = sftpclient.UploadFileWithProgress(sess.SSHClient(), local, path.Join(remoteDir, name), info.ModTime(), func(d, _ int64) { r.advance(base+d, 0) })
		if err != nil {
			err = fmt.Errorf("%s: %w", name, err)
			r.finish(err)
			return uploaded, err
		}
		done += sizes[local]
		uploaded = append(uploaded, name)
		r.fileDone(done)
	}
	r.finish(nil)
	return uploaded, nil
}
