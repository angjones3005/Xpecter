// Package sftpclient provides directory listing and file read/write
// helpers over an existing SSH connection, used for the remote file
// browser and the Monaco-based remote file editing pane.
package sftpclient

import (
	"bytes"
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
