//go:build windows

package main

import (
	"errors"
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

// revealInFileManager opens Explorer on a folder, or on a file's folder
// with the file selected. Explorer's /select switch carries the path in
// the same argument, so the command line is written out by hand: os/exec
// would quote the whole of `/select,C:\a b\c.txt` as one argument, and
// Explorer then looks for a folder by that name.
func revealInFileManager(path string, isDir bool) error {
	if isDir {
		return openExternalPath(path)
	}
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: explorerSelectCommandLine(path)}
	return cmd.Start()
}

// explorerSelectCommandLine is the exact command line Explorer reads.
// A Windows path cannot contain a double quote, so the quoting has no
// escaping to do.
func explorerSelectCommandLine(path string) string {
	return `explorer.exe /select,"` + path + `"`
}

// openExternalPath hands a file to whatever Windows associates with it.
//
// This used to run `cmd /c start "" <path>`. cmd.exe reads its command
// line as a script: `&` separates commands, `^` escapes, `%NAME%`
// expands, and Go only quotes an argument that contains a space. A
// local file called R&D.txt never opened, and a file on a remote host
// named `readme&powershell;...` would have run PowerShell on this
// machine the moment it was opened from the SFTP browser, since
// OpenRemoteFile keeps the host's file name for the temporary copy.
//
// ShellExecuteEx takes the path as one argument and interprets nothing
// in it. It is the same call the installer launcher already makes, with
// the ordinary "open" verb instead of "runas".
func openExternalPath(path string) error {
	verb, err := syscall.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	file, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	info := shellExecuteInfo{
		cbSize: uint32(unsafe.Sizeof(shellExecuteInfo{})),
		fMask:  seeMaskNoAsync,
		lpVerb: verb,
		lpFile: file,
		nShow:  1,
	}
	result, _, callErr := shellExecuteExW.Call(uintptr(unsafe.Pointer(&info)))
	if result == 0 {
		var errno syscall.Errno
		if errors.As(callErr, &errno) && errno == 0 {
			return fmt.Errorf("Windows could not open %s", path)
		}
		return callErr
	}
	return nil
}
