package main

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"xpecter/backend/fswatch"
	"xpecter/backend/sftpclient"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
)

// --- Editing a remote file with another application ---
//
// Opening a remote file with the system application gave you a copy in
// a temporary folder and nothing more: edits made there stayed there.
// This watches that copy and sends each save back to the host, which is
// how a spreadsheet, an image or a Word document on a server gets
// edited in the tool made for it without a download-and-upload dance.

type externalEdit struct {
	sessionID  string
	remotePath string
	localPath  string
	modTime    time.Time
	size       int64
}

// externalEdits is every watched copy, by local path. The watcher is
// made on first use and shared; each edit's temporary folder is one of
// the directories it watches.
type externalEditor struct {
	mu      sync.Mutex
	edits   map[string]*externalEdit
	watcher *fswatch.Watcher
	// uploading holds the paths mid-upload, so a save that lands while
	// the previous one is still going is picked up by the same pass
	// rather than uploaded twice at once.
	uploading map[string]bool
}

// EditRemoteFileExternally downloads a remote file to a private
// temporary folder, opens it with the system application, and uploads
// it back to the host every time it is saved.
func (a *App) EditRemoteFileExternally(id string, remotePath string) error {
	sess, err := a.session(id)
	if err != nil {
		return err
	}
	tmpDir, err := os.MkdirTemp("", "xpecter-external-edit-*")
	if err != nil {
		return err
	}
	localPath := remoteTempFilePath(tmpDir, remotePath)
	if err := sftpclient.DownloadFile(sess.SSHClient(), remotePath, localPath); err != nil {
		_ = os.RemoveAll(tmpDir)
		return err
	}
	info, err := os.Stat(localPath)
	if err != nil {
		_ = os.RemoveAll(tmpDir)
		return err
	}
	if err := a.trackExternalEdit(&externalEdit{
		sessionID: id, remotePath: remotePath, localPath: localPath,
		modTime: info.ModTime(), size: info.Size(),
	}); err != nil {
		_ = os.RemoveAll(tmpDir)
		return err
	}
	if err := openExternalPath(localPath); err != nil {
		a.untrackExternalEdit(localPath)
		_ = os.RemoveAll(tmpDir)
		return err
	}
	logf("remote-edit", "watching %s for %s", localPath, remotePath)
	return nil
}

func (a *App) trackExternalEdit(edit *externalEdit) error {
	ed := &a.externalEdits
	ed.mu.Lock()
	defer ed.mu.Unlock()
	if ed.edits == nil {
		ed.edits = make(map[string]*externalEdit)
		ed.uploading = make(map[string]bool)
	}
	if ed.watcher == nil {
		w, err := fswatch.New(a.onExternalEditDirsChanged)
		if err != nil {
			return err
		}
		ed.watcher = w
	}
	ed.edits[edit.localPath] = edit
	ed.watcher.SetDirs(ed.watchedDirsLocked())
	return nil
}

func (a *App) untrackExternalEdit(localPath string) {
	ed := &a.externalEdits
	ed.mu.Lock()
	defer ed.mu.Unlock()
	delete(ed.edits, localPath)
	if ed.watcher != nil {
		ed.watcher.SetDirs(ed.watchedDirsLocked())
	}
}

// stopExternalEditsFor forgets the edits of a session that has ended
// and removes their copies: there is no longer anywhere to send them,
// and a file downloaded from a server is not something to leave lying
// in the temp folder.
func (a *App) stopExternalEditsFor(sessionID string) {
	ed := &a.externalEdits
	ed.mu.Lock()
	var dirs []string
	for path, edit := range ed.edits {
		if edit.sessionID == sessionID {
			delete(ed.edits, path)
			dirs = append(dirs, filepath.Dir(path))
		}
	}
	if ed.watcher != nil {
		ed.watcher.SetDirs(ed.watchedDirsLocked())
	}
	ed.mu.Unlock()
	for _, dir := range dirs {
		_ = os.RemoveAll(dir)
	}
}

func (ed *externalEditor) watchedDirsLocked() []string {
	seen := make(map[string]bool)
	var dirs []string
	for path := range ed.edits {
		dir := filepath.Dir(path)
		if !seen[dir] {
			seen[dir] = true
			dirs = append(dirs, dir)
		}
	}
	return dirs
}

// changedLocked reports whether the copy on disk differs from what was
// last sent to the host. Called with the editor's lock held.
func (e *externalEdit) changedLocked() bool {
	info, err := os.Stat(e.localPath)
	if err != nil {
		return false
	}
	return !info.ModTime().Equal(e.modTime) || info.Size() != e.size
}

// onExternalEditDirsChanged runs on the watcher's goroutine after each
// burst of changes. Every edit in a changed folder is stat'd; one whose
// copy has changed since it was last uploaded goes back to the host.
func (a *App) onExternalEditDirsChanged(dirs []string) {
	changed := make(map[string]bool, len(dirs))
	for _, dir := range dirs {
		changed[filepath.Clean(dir)] = true
	}
	ed := &a.externalEdits
	ed.mu.Lock()
	var due []*externalEdit
	for _, edit := range ed.edits {
		if !changed[filepath.Clean(filepath.Dir(edit.localPath))] || ed.uploading[edit.localPath] {
			continue
		}
		if !edit.changedLocked() {
			continue
		}
		ed.uploading[edit.localPath] = true
		due = append(due, edit)
	}
	ed.mu.Unlock()
	for _, edit := range due {
		go a.uploadExternalEdit(edit)
	}
}

// uploadExternalEdit sends the copy to the host, and again if it was
// saved once more while that was going, so what ends up on the host is
// always the last save and never a file caught mid-write. The uploading
// mark is dropped only once the copy on disk matches what was sent,
// under the same lock the watcher checks it with, so no save can fall
// between the two.
func (a *App) uploadExternalEdit(edit *externalEdit) {
	ed := &a.externalEdits
	for {
		// Applications write in more than one step (a temp file, a
		// rename, a truncate and rewrite); a short pause lets the save
		// settle so what goes up is the whole file.
		time.Sleep(400 * time.Millisecond)
		info, statErr := os.Stat(edit.localPath)
		sess, sessErr := a.session(edit.sessionID)
		if statErr != nil || sessErr != nil {
			ed.mu.Lock()
			delete(ed.uploading, edit.localPath)
			ed.mu.Unlock()
			return
		}
		ed.mu.Lock()
		edit.modTime = info.ModTime()
		edit.size = info.Size()
		ed.mu.Unlock()
		a.sendExternalEdit(sess.SSHClient(), edit)
		ed.mu.Lock()
		again := edit.changedLocked()
		if !again {
			delete(ed.uploading, edit.localPath)
		}
		ed.mu.Unlock()
		if !again {
			return
		}
	}
}

func (a *App) sendExternalEdit(client *ssh.Client, edit *externalEdit) {
	name := filepath.Base(edit.remotePath)
	err := sftpclient.UploadFileWithProgress(client, edit.localPath, edit.remotePath, time.Time{}, nil)
	if a.ctx == nil {
		return
	}
	if err != nil {
		logf("remote-edit", "upload of %s failed: %v", edit.remotePath, err)
		runtime.EventsEmit(a.ctx, "remote:edit-uploaded", map[string]any{
			"sessionId": edit.sessionID, "path": edit.remotePath, "name": name, "error": err.Error(),
		})
		return
	}
	logf("remote-edit", "uploaded %s", edit.remotePath)
	runtime.EventsEmit(a.ctx, "remote:edit-uploaded", map[string]any{
		"sessionId": edit.sessionID, "path": edit.remotePath, "name": name,
	})
}

// ExternalEditsFor lists the remote paths being watched for a session,
// so the browser can mark them.
func (a *App) ExternalEditsFor(sessionID string) []string {
	ed := &a.externalEdits
	ed.mu.Lock()
	defer ed.mu.Unlock()
	out := []string{}
	for _, edit := range ed.edits {
		if edit.sessionID == sessionID {
			out = append(out, edit.remotePath)
		}
	}
	return out
}

// close stops the watcher and removes every copy; the application is
// shutting down and nothing is going to upload them.
func (ed *externalEditor) close() {
	ed.mu.Lock()
	defer ed.mu.Unlock()
	if ed.watcher != nil {
		_ = ed.watcher.Close()
		ed.watcher = nil
	}
	for path := range ed.edits {
		_ = os.RemoveAll(filepath.Dir(path))
	}
	ed.edits = nil
}
