package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"xpecter/backend/config"
)

// --- The application log ---
//
// There was none. A connection that failed said so in the UI and
// nowhere else, and the first "it doesn't work for me" would have had
// nothing to attach. This is a plain text log beside the config files,
// with the events worth having when something goes wrong: startup,
// connections and what they failed with, transfers, updates, and
// anything the frontend caught. Never a password, never terminal
// output.

const (
	appLogName     = "xpecter.log"
	appLogMaxBytes = 4 << 20 // rotated to xpecter.log.1 past this
)

var (
	appLogMu   sync.Mutex
	appLogFile *os.File
)

// initAppLog points the standard logger at the log file (and stderr,
// for a dev run from a terminal). Failure to open it is not worth
// failing startup over; the app just logs to stderr as before.
func initAppLog() {
	dir, err := config.LogDir()
	if err != nil {
		return
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	path := filepath.Join(dir, appLogName)
	rotateAppLog(path)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	appLogMu.Lock()
	appLogFile = f
	appLogMu.Unlock()
	log.SetOutput(appLogWriter{file: f, echo: os.Stderr})
	log.SetFlags(log.LstdFlags)
}

// rotateAppLog keeps one previous log: past the size cap the current
// file becomes .1 and a fresh one starts, so the folder never grows
// without bound and the last session's tail is still there.
func rotateAppLog(path string) {
	info, err := os.Stat(path)
	if err != nil || info.Size() < appLogMaxBytes {
		return
	}
	_ = os.Remove(path + ".1")
	_ = os.Rename(path, path+".1")
}

func closeAppLog() {
	appLogMu.Lock()
	defer appLogMu.Unlock()
	if appLogFile != nil {
		log.SetOutput(os.Stderr)
		_ = appLogFile.Close()
		appLogFile = nil
	}
}

// LogFromFrontend records something the page caught: an uncaught
// exception, a rejected promise nobody handled, or a console.error.
// level is what the page called it.
func (a *App) LogFromFrontend(level string, message string) {
	level = strings.ToUpper(strings.TrimSpace(level))
	if level == "" {
		level = "INFO"
	}
	message = strings.TrimSpace(message)
	if len(message) > 4000 {
		message = message[:4000] + "…"
	}
	log.Printf("[frontend %s] %s", level, message)
}

// LogFolder is where the log lives, for the Help menu.
func (a *App) LogFolder() (string, error) {
	return config.LogDir()
}

// OpenLogFolder shows the log folder in the file manager, creating it
// if nothing has been logged yet.
func (a *App) OpenLogFolder() error {
	dir, err := config.LogDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return revealInFileManager(dir, true)
}

// logf is log.Printf with a subsystem tag, so the file reads as a
// sequence of events rather than a wall of text.
func logf(subsystem string, format string, args ...any) {
	log.Printf("[%s] %s", subsystem, fmt.Sprintf(format, args...))
}

// appLogWriter writes each record to the file first and then, best
// effort, to stderr, so a dev run from a terminal sees the log too. It
// is not io.MultiWriter because that stops at the first writer that
// fails, and a GUI build on Windows has no stderr at all: every record
// would have failed there and never reached the file.
type appLogWriter struct {
	file io.Writer
	echo io.Writer
}

func (w appLogWriter) Write(p []byte) (int, error) {
	n, err := w.file.Write(p)
	if w.echo != nil {
		_, _ = w.echo.Write(p)
	}
	return n, err
}
