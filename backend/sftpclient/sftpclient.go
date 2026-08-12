// Package sftpclient provides directory listing and file read/write
// helpers over an existing SSH connection, used for the remote file
// browser and the Monaco-based remote file editing pane.
package sftpclient

import (
	"bytes"
	"io"
	"path"

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
func UploadFile(client *ssh.Client, filePath string, data []byte) error {
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
	return f.Close()
}
