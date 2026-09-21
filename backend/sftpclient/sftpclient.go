// Package sftpclient provides directory listing and file read/write
// helpers over an existing SSH connection, used for the remote file
// browser and the Monaco-based remote file editing pane.
package sftpclient

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type Entry struct {
	Name  string
	Path  string
	IsDir bool
	Size  int64
}

func ListDir(client *ssh.Client, dir string) ([]Entry, error) {
	c, err := sftp.NewClient(client)
	if err != nil {
		return nil, err
	}
	defer func() { _ = c.Close() }()

	if dir == "" {
		dir = "."
	}

	infos, err := c.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	entries := make([]Entry, 0, len(infos))
	for _, info := range infos {
		entries = append(entries, Entry{
			Name:  info.Name(),
			Path:  path.Join(dir, info.Name()),
			IsDir: info.IsDir(),
			Size:  info.Size(),
		})
	}
	return entries, nil
}

func ReadFile(client *ssh.Client, filePath string) (string, error) {
	c, err := sftp.NewClient(client)
	if err != nil {
		return "", err
	}
	defer func() { _ = c.Close() }()

	f, err := c.Open(filePath)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()

	buf := new(bytes.Buffer)
	if _, err := io.Copy(buf, f); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// ReadFileBytes reads a remote file into memory as raw bytes, for the
// callers that need the file itself rather than its text: ReadFile
// above converts to a string, which is the right thing for the editor
// and destroys anything that isn't UTF-8. The caller is expected to
// have decided the file is small enough to hold, since this is the
// version with no streaming and no temporary copy on disk.
func ReadFileBytes(client *ssh.Client, filePath string) ([]byte, error) {
	c, err := sftp.NewClient(client)
	if err != nil {
		return nil, err
	}
	defer func() { _ = c.Close() }()

	f, err := c.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, f); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// StatFile reports a remote file's size without reading it, so a caller
// can refuse an unreasonably large one before pulling it over the wire.
func StatFile(client *ssh.Client, filePath string) (int64, error) {
	c, err := sftp.NewClient(client)
	if err != nil {
		return 0, err
	}
	defer func() { _ = c.Close() }()

	info, err := c.Stat(filePath)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// DownloadFile copies a remote file to a caller-owned local path without
// interpreting its contents as text. This is used for handing files to the
// operating system's default application.
func DownloadFile(client *ssh.Client, remotePath string, localPath string) error {
	c, err := sftp.NewClient(client)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()

	src, err := c.Open(remotePath)
	if err != nil {
		return err
	}
	defer func() { _ = src.Close() }()
	info, err := src.Stat()
	if err != nil {
		return err
	}

	dst, err := os.OpenFile(localPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return err
	}
	if err := dst.Close(); err != nil {
		return err
	}
	return os.Chtimes(localPath, info.ModTime(), info.ModTime())
}

func WriteFile(client *ssh.Client, filePath string, content string) error {
	c, err := sftp.NewClient(client)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()
	return writeAtomically(c, filePath, []byte(content))
}

// writeAtomically replaces a remote file without ever leaving it
// half-written. Create() truncates first and writes second, so a
// connection that dropped between the two left the file empty on the
// host, with the only copy of its contents in a buffer on this side.
//
// The new contents go into a temporary file beside the target, which
// is then renamed over it. Two things make this fall back to writing
// in place, the way it always did: a directory the temporary file
// cannot be created in (the file itself may still be writable), and a
// target owned by someone else, since a rename would hand the file to
// this user and a group-writable config file is often exactly that.
func writeAtomically(c *sftp.Client, filePath string, data []byte) error {
	return writeStreamAtomically(c, filePath, bytes.NewReader(data))
}

// writeStreamAtomically is writeAtomically for a source that is read as
// it goes, which is what lets an upload of a large file run without
// holding all of it in memory. The ownership check happens before any
// of src is consumed, because a reader cannot be rewound for the
// in-place fallback.
func writeStreamAtomically(c *sftp.Client, filePath string, src io.Reader) error {
	// Write through a link to where it points, or the link would be
	// replaced by a plain file.
	if info, err := c.Lstat(filePath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		if real, err := c.RealPath(filePath); err == nil {
			filePath = real
		}
	}
	existing, statErr := c.Stat(filePath)
	tmpPath := path.Join(path.Dir(filePath), "."+path.Base(filePath)+".xpecter-tmp")
	f, err := c.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return writeInPlace(c, filePath, src)
	}
	discard := func() { _ = c.Remove(tmpPath) }
	if statErr == nil && !sameOwner(c, tmpPath, existing) {
		_ = f.Close()
		discard()
		return writeInPlace(c, filePath, src)
	}
	if _, err := f.ReadFrom(src); err != nil {
		_ = f.Close()
		discard()
		return err
	}
	if err := f.Close(); err != nil {
		discard()
		return err
	}
	if statErr == nil {
		// Keep the mode the file already had; a script stays executable.
		_ = c.Chmod(tmpPath, existing.Mode().Perm())
	}
	// posix-rename@openssh.com replaces the target atomically. A server
	// without the extension gets the two-step version, whose window is
	// the rename itself rather than the whole write.
	if err := c.PosixRename(tmpPath, filePath); err != nil {
		if statErr == nil {
			if err := c.Remove(filePath); err != nil {
				discard()
				return err
			}
		}
		if err := c.Rename(tmpPath, filePath); err != nil {
			discard()
			return err
		}
	}
	return nil
}

// sameOwner reports whether the temporary file (owned by this login)
// and the existing target belong to the same user. A server that does
// not report ownership counts as the same.
func sameOwner(c *sftp.Client, tmpPath string, existing os.FileInfo) bool {
	tmpInfo, err := c.Stat(tmpPath)
	if err != nil {
		return true
	}
	tmpStat, ok1 := tmpInfo.Sys().(*sftp.FileStat)
	targetStat, ok2 := existing.Sys().(*sftp.FileStat)
	if !ok1 || !ok2 {
		return true
	}
	return tmpStat.UID == targetStat.UID
}

// writeInPlace is the truncate-then-write of old, kept for the cases
// writeAtomically cannot handle without changing something else about
// the file.
func writeInPlace(c *sftp.Client, filePath string, src io.Reader) error {
	f, err := c.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return err
	}
	if _, err := f.ReadFrom(src); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// Progress is told how a transfer is going: the bytes moved so far and
// the size when it is known, 0 when it is not.
type Progress func(done, total int64)

// countingWriter reports to a Progress as bytes pass through it.
type countingWriter struct {
	w      io.Writer
	done   int64
	total  int64
	report Progress
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.done += int64(n)
	if c.report != nil {
		c.report(c.done, c.total)
	}
	return n, err
}

// countingReader is the same for a source. Size is what lets the sftp
// client see how much is coming and write it with several requests in
// flight rather than one round trip per packet.
type countingReader struct {
	r      io.Reader
	done   int64
	total  int64
	report Progress
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.done += int64(n)
	if c.report != nil && n > 0 {
		c.report(c.done, c.total)
	}
	return n, err
}

func (c *countingReader) Size() int64 { return c.total }

// DownloadFileWithProgress streams a remote file to localPath, reporting
// as it goes. It lands beside its destination under a temporary name
// and is renamed over it at the end, so a download that is cut off
// never leaves a truncated file wearing the real name. The remote
// modification time is kept, the way DownloadFile keeps it.
func DownloadFileWithProgress(client *ssh.Client, remotePath string, localPath string, report Progress) error {
	c, err := sftp.NewClient(client)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()

	src, err := c.Open(remotePath)
	if err != nil {
		return err
	}
	defer func() { _ = src.Close() }()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("%s is a directory", remotePath)
	}

	dir := filepath.Dir(localPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(localPath)+".*.part")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	fail := func(err error) error {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	// WriteTo keeps several reads in flight and hands the bytes over in
	// order, which is what makes this quick over a slow link.
	if _, err := src.WriteTo(&countingWriter{w: tmp, total: info.Size(), report: report}); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, localPath); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return os.Chtimes(localPath, info.ModTime(), info.ModTime())
}

// UploadFileWithProgress streams a local file to remotePath, reporting
// as it goes, through the same temporary-file-and-rename path the
// editor's saves use, so a connection that drops halfway leaves the
// old file rather than half of the new one.
func UploadFileWithProgress(client *ssh.Client, localPath string, remotePath string, modifiedAt time.Time, report Progress) error {
	// Concurrent writes: without them every 32 KiB packet waits for its
	// reply, and a large file over a WAN crawls.
	c, err := sftp.NewClient(client, sftp.UseConcurrentWrites(true))
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()

	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("%s is a directory", localPath)
	}
	if err := writeStreamAtomically(c, remotePath, &countingReader{r: f, total: info.Size(), report: report}); err != nil {
		return err
	}
	if modifiedAt.IsZero() {
		return nil
	}
	return c.Chtimes(remotePath, modifiedAt, modifiedAt)
}

// WalkFiles lists everything under root, directories included, with a
// directory always ahead of its contents. Symbolic links are left out:
// a link to a directory above the root would otherwise walk forever.
func WalkFiles(client *ssh.Client, root string) ([]Entry, error) {
	c, err := sftp.NewClient(client)
	if err != nil {
		return nil, err
	}
	defer func() { _ = c.Close() }()

	var out []Entry
	walker := c.Walk(root)
	for walker.Step() {
		if err := walker.Err(); err != nil {
			return nil, fmt.Errorf("%s: %w", walker.Path(), err)
		}
		info := walker.Stat()
		p := walker.Path()
		if p == root || info == nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			walker.SkipDir()
			continue
		}
		out = append(out, Entry{Name: info.Name(), Path: p, IsDir: info.IsDir(), Size: info.Size()})
	}
	return out, nil
}

// CreateFile and CreateDir add an entry to a remote directory, backing
// New File and New Folder in the remote browser. They mirror the local
// CreateLocalFile/CreateLocalDir pair, including its rule that a name
// already taken is an error rather than a silent overwrite.
//
// Joining happens here rather than in the caller because remote paths
// are POSIX regardless of what Xpecter is running on: path.Join is
// correct and filepath.Join would produce backslashes on Windows.
func CreateFile(client *ssh.Client, dir string, name string) (string, error) {
	c, err := sftp.NewClient(client)
	if err != nil {
		return "", err
	}
	defer func() { _ = c.Close() }()

	full := path.Join(dir, name)
	// O_EXCL makes the server refuse an existing name instead of
	// truncating it. Not every SFTP server honours it, so this is the
	// first of two guards; the Stat below is the second.
	if _, err := c.Stat(full); err == nil {
		return "", fmt.Errorf("%s already exists", name)
	}
	f, err := c.OpenFile(full, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return full, nil
}

func CreateDir(client *ssh.Client, dir string, name string) (string, error) {
	c, err := sftp.NewClient(client)
	if err != nil {
		return "", err
	}
	defer func() { _ = c.Close() }()

	full := path.Join(dir, name)
	// Mkdir, not MkdirAll: MkdirAll treats an existing directory as
	// success, and New Folder appearing to do nothing reads as a bug
	// rather than as a name already taken.
	if err := c.Mkdir(full); err != nil {
		return "", err
	}
	return full, nil
}

// Rename changes the last element of oldPath to newName, leaving the
// entry where it is. The caller supplies a name rather than a
// destination path so renaming can never quietly become moving.
func Rename(client *ssh.Client, oldPath string, newName string) (string, error) {
	c, err := sftp.NewClient(client)
	if err != nil {
		return "", err
	}
	defer func() { _ = c.Close() }()

	target := path.Join(path.Dir(oldPath), newName)
	if target == oldPath {
		return oldPath, nil
	}
	// SSH_FXP_RENAME is specified to fail when the target exists, which
	// is what's wanted here. PosixRename is deliberately not used: it
	// carries POSIX rename(2)'s silent-overwrite behaviour, and losing a
	// file to a typo in a rename box is not a recoverable mistake.
	if _, err := c.Stat(target); err == nil {
		return "", fmt.Errorf("%s already exists", newName)
	}
	if err := c.Rename(oldPath, target); err != nil {
		return "", err
	}
	return target, nil
}

// Remove deletes a remote file or directory. A directory is only walked
// when recursive is set: over SFTP there is no trash to fish anything
// back out of, so whether a folder full of work is about to go with it
// is something the caller has to have decided in front of the user,
// not something discovered halfway through the deletion.
func Remove(client *ssh.Client, target string, recursive bool) error {
	c, err := sftp.NewClient(client)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()

	// Lstat, not Stat: a symlink pointing at a directory answers Stat as
	// a directory, and a recursive delete would then empty whatever it
	// points at rather than removing the link that was clicked on.
	info, err := c.Lstat(target)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return c.Remove(target)
	}
	if recursive {
		return c.RemoveAll(target)
	}
	// RemoveDirectory rather than Remove: Remove retries a failed file
	// deletion as a directory one, which would make this quietly succeed
	// on the non-empty directory the caller was refusing to walk.
	return c.RemoveDirectory(target)
}

// UploadFile writes raw bytes to a remote path, used for binary-safe
// file uploads (drag-and-drop from the local OS), as distinct from
// WriteFile which is used for the text-based Monaco editor save path.
func UploadFile(client *ssh.Client, filePath string, data []byte, modifiedAt time.Time) error {
	c, err := sftp.NewClient(client)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()
	if err := writeAtomically(c, filePath, data); err != nil {
		return err
	}
	if modifiedAt.IsZero() {
		return nil
	}
	return c.Chtimes(filePath, modifiedAt, modifiedAt)
}
