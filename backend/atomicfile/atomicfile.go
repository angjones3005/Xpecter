// Package atomicfile writes a file so that a reader never sees it
// half-written. Every config file Xpecter keeps, and every buffer the
// editor saves, used to go through os.WriteFile, which truncates the
// file and then writes: a crash, a full disk or a pulled plug between
// those two steps leaves sessions.json empty and the next launch unable
// to load anything, or leaves the file you just saved as zero bytes with
// no copy anywhere.
//
// Write puts the new contents in a temporary file beside the target,
// flushes it to disk, and renames it over the original. The rename is
// atomic on every platform this runs on, so the target is always either
// the old file or the new one.
package atomicfile

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// ErrTempFile wraps the failure to create the temporary file. It is the
// one case a caller may reasonably fall back from: a file the user can
// write in a directory they cannot create in (a shared drop folder, a
// locked-down system directory) can still be saved in place, and that
// is a better answer than refusing to save at all.
var ErrTempFile = errors.New("could not create a temporary file beside the target")

// Write replaces the file at path with data. An existing file keeps its
// permission bits; a new one gets perm. A symbolic link is followed, so
// a config file that is really a link into a dotfiles checkout is
// updated where it lives rather than being replaced by a plain file.
func Write(path string, data []byte, perm os.FileMode) error {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	if info, err := os.Stat(path); err == nil {
		if info.IsDir() {
			return fmt.Errorf("%s is a directory", path)
		}
		perm = info.Mode().Perm()
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("%w: %v", ErrTempFile, err)
	}
	tmpName := tmp.Name()
	// Every failure from here on removes the temporary file: leaving one
	// behind would show up as a mystery entry in the workspace tree.
	fail := func(err error) error {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		return fail(err)
	}
	// Sync before rename, or a power loss can leave the rename on disk
	// and the data not: a zero-length file with the right name, which is
	// the exact outcome this package exists to prevent.
	if err := tmp.Sync(); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return nil
}
