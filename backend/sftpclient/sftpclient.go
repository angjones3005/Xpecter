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

	f, err := c.Create(filePath)
	if err != nil {
		return err
	}
	if _, err := f.Write([]byte(content)); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
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
	f, err := c.Create(filePath)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if modifiedAt.IsZero() {
		return nil
	}
	return c.Chtimes(filePath, modifiedAt, modifiedAt)
}
