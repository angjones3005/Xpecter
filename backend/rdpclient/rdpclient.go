// Package rdpclient launches the operating system's Remote Desktop client
// for a saved RDP session and tracks the process it started.
//
// Xpecter does not render RDP itself. Its one surface is a webview, and
// RDP wants a native graphical client: the desktop draws in whichever
// client the platform ships or the user installed, and this package's job
// is to hand that client a fully described session (address, user,
// domain, display) so the person never types any of it again, then to
// know when the client has gone away so the pane in Xpecter can say so.
//
// Every platform reads the same thing. Microsoft's .rdp file format is
// what mstsc.exe takes on Windows and what Windows App (the client
// formerly called Microsoft Remote Desktop) opens on macOS; on Linux
// FreeRDP and Remmina take arguments instead, built from the same
// Options. Passwords are never written anywhere: the client prompts, the
// same policy config.SessionProfile has for SSH.
package rdpclient

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

// Options is everything a saved RDP session carries. Zero values mean
// "let the client decide": port 0 is 3389, width and height 0 leave the
// window size to the client, an empty user or domain leaves those fields
// out of the file entirely rather than writing an empty one.
type Options struct {
	Host         string
	Port         int
	User         string
	Domain       string
	Fullscreen   bool
	Width        int
	Height       int
	AdminSession bool
}

const DefaultPort = 3389

// The size a windowed session opens at when none was chosen. mstsc and
// FreeRDP both need an initial resolution even for a window that will
// then follow its frame: without one, mstsc falls back to a stale
// remembered size, which was the whole of what made "windowed" open
// wrong. 1280x800 is a conservative laptop-friendly default.
const (
	DefaultWindowWidth  = 1280
	DefaultWindowHeight = 800
)

// Address is host:port as the client wants it, with IPv6 bracketed and
// the default port left implicit, because mstsc treats "host:3389" and
// "host" identically and the shorter one reads better in a pane header.
func (o Options) Address() string {
	host := strings.TrimSpace(o.Host)
	if o.Port == 0 || o.Port == DefaultPort {
		if strings.Contains(host, ":") {
			return "[" + host + "]"
		}
		return host
	}
	return net.JoinHostPort(host, strconv.Itoa(o.Port))
}

// Validate refuses what no client could do anything with. Kept to the
// genuinely unusable rather than being opinionated: a port outside the
// range is an error, an unusual one is the user's business.
func (o Options) Validate() error {
	if strings.TrimSpace(o.Host) == "" {
		return errors.New("a host is required")
	}
	if o.Port < 0 || o.Port > 65535 {
		return fmt.Errorf("port %d is out of range", o.Port)
	}
	if (o.Width < 0 || o.Height < 0) || (o.Width == 0) != (o.Height == 0) {
		return errors.New("width and height must both be set, or both left at 0")
	}
	return nil
}

// File renders the session as a .rdp document, the format mstsc.exe and
// Windows App both read. Only the settings that carry a decision are
// written: every client has sensible defaults for the rest, and a file
// that spells out forty of them is one that silently overrides the
// user's own client preferences.
//
// CRLF line endings, because the format was defined on Windows and
// mstsc has been seen to ignore a file whose lines end otherwise.
func File(o Options) string {
	var b strings.Builder
	line := func(key, value string) {
		b.WriteString(key)
		b.WriteString(":")
		b.WriteString(value)
		b.WriteString("\r\n")
	}
	line("full address", "s:"+o.Address())
	if user := strings.TrimSpace(o.User); user != "" {
		line("username", "s:"+user)
	}
	if domain := strings.TrimSpace(o.Domain); domain != "" {
		line("domain", "s:"+domain)
	}
	// 2 is full screen, 1 is a window. Fullscreen takes the monitor's
	// own resolution and needs nothing more, which is why it was the one
	// mode that already worked.
	if o.Fullscreen {
		line("screen mode id", "i:2")
	} else {
		// A window always carries an initial resolution: mstsc with none
		// opens at a stale remembered size, which is what made the
		// windowed modes open wrong. Then one of two modern keys decides
		// what resizing the frame does, and they are mutually exclusive:
		//
		//   - No fixed size chosen: dynamic resolution, so the remote
		//     session actually re-sizes to match the window as it is
		//     dragged (RDP 8.1+, ignored gracefully by older servers).
		//   - A fixed size chosen: smart sizing, so that resolution is
		//     honoured and the window scales its contents rather than
		//     clipping them behind scrollbars.
		width, height := o.Width, o.Height
		fixed := width > 0 && height > 0
		if !fixed {
			width, height = DefaultWindowWidth, DefaultWindowHeight
		}
		line("screen mode id", "i:1")
		line("desktopwidth", "i:"+strconv.Itoa(width))
		line("desktopheight", "i:"+strconv.Itoa(height))
		if fixed {
			line("smart sizing", "i:1")
		} else {
			line("dynamic resolution", "i:1")
		}
	}

	if o.AdminSession {
		line("administrative session", "i:1")
	}
	// Written explicitly so the clipboard works without the user
	// finding the option: it is the one redirection everybody wants and
	// the one that leaks nothing from this machine but what was copied.
	line("redirectclipboard", "i:1")
	return b.String()
}

// Launcher describes how one platform starts its client. Resolved by
// resolve rather than at init, so the tests can cover all three
// platforms from one machine.
type Launcher struct {
	// Client is the human-readable name of what was launched, shown in
	// the pane: "Remote Desktop Connection", "Windows App", "FreeRDP".
	Client string
	Name   string
	Args   []string
	// Tracked is false when the process this starts is not the client
	// itself. macOS's `open` hands the file to Windows App and returns,
	// so its exit says nothing about the session; the pane is told so
	// rather than being told the session ended the moment it began.
	Tracked bool
}

// resolve picks the command for a platform. lookPath is injected so the
// Linux branch, which depends on what is installed, can be tested
// without installing anything.
func resolve(o Options, rdpFile string, goos string, lookPath func(string) (string, error)) (Launcher, error) {
	switch goos {
	case "windows":
		return Launcher{Client: "Remote Desktop Connection", Name: "mstsc.exe", Args: []string{rdpFile}, Tracked: true}, nil
	case "darwin":
		// Whatever the system associates with .rdp, which for anyone who
		// has installed Microsoft's client is that client. `open` itself
		// fails, with a message worth showing, when nothing is.
		return Launcher{Client: "Windows App", Name: "open", Args: []string{rdpFile}, Tracked: false}, nil
	default:
		for _, name := range []string{"xfreerdp3", "xfreerdp"} {
			if _, err := lookPath(name); err == nil {
				return Launcher{Client: "FreeRDP", Name: name, Args: freerdpArgs(o), Tracked: true}, nil
			}
		}
		if _, err := lookPath("remmina"); err == nil {
			return Launcher{Client: "Remmina", Name: "remmina", Args: []string{"-c", remminaURL(o)}, Tracked: true}, nil
		}
		return Launcher{}, errors.New("no Remote Desktop client found: install FreeRDP (xfreerdp) or Remmina")
	}
}

// FreeRDP takes its session on the command line. /cert:tofu is trust on
// first use, the same policy Xpecter's own SSH host-key handling
// follows; without it FreeRDP asks on its own stdin, which is nothing
// when it has been launched from a GUI, and the connection simply fails.
func freerdpArgs(o Options) []string {
	args := []string{"/v:" + o.Address(), "/cert:tofu", "+clipboard"}
	if user := strings.TrimSpace(o.User); user != "" {
		args = append(args, "/u:"+user)
	}
	if domain := strings.TrimSpace(o.Domain); domain != "" {
		args = append(args, "/d:"+domain)
	}
	// The same three shapes as the .rdp file, in FreeRDP's spelling.
	// /dynamic-resolution and /smart-sizing must never appear together
	// (FreeRDP rejects the pair), which the fixed/dynamic split keeps
	// them from doing.
	if o.Fullscreen {
		args = append(args, "/f")
	} else if o.Width > 0 && o.Height > 0 {
		args = append(args, fmt.Sprintf("/size:%dx%d", o.Width, o.Height), "/smart-sizing")
	} else {
		args = append(args, fmt.Sprintf("/size:%dx%d", DefaultWindowWidth, DefaultWindowHeight), "/dynamic-resolution")
	}

	if o.AdminSession {
		args = append(args, "/admin")
	}
	return args
}

// Remmina opens an rdp:// URL directly. It has no flags for display
// size or an admin session, so those settings are lost on this path;
// FreeRDP is preferred when both are installed for exactly that reason.
func remminaURL(o Options) string {
	u := url.URL{Scheme: "rdp", Host: o.Address()}
	if user := strings.TrimSpace(o.User); user != "" {
		if domain := strings.TrimSpace(o.Domain); domain != "" {
			user = domain + `\` + user
		}
		u.User = url.User(user)
	}
	return u.String()
}

// Session is one launched client. It is the thing the pane in Xpecter
// stands for: alive while the process is, told when it ends.
type Session struct {
	Client  string
	Tracked bool
	cmd     *exec.Cmd
	file    string
	mu      sync.Mutex
	closed  bool
}

// Launch writes the .rdp file for o into dir and starts the platform's
// client on it. onExit is called once, from its own goroutine, when a
// tracked client exits: deliberate reports whether Close was what ended
// it, so the caller can tell a session the user closed from one that
// dropped.
func Launch(o Options, dir string, onExit func(err error, deliberate bool)) (*Session, error) {
	if err := o.Validate(); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	f, err := os.CreateTemp(dir, "session-*.rdp")
	if err != nil {
		return nil, err
	}
	// 0600 from CreateTemp: the file names a host and a user, which is
	// not secret but is not anyone else's business either.
	if _, err := f.WriteString(File(o)); err != nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		return nil, err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(f.Name())
		return nil, err
	}

	launcher, err := resolve(o, f.Name(), runtime.GOOS, exec.LookPath)
	if err != nil {
		_ = os.Remove(f.Name())
		return nil, err
	}
	cmd := exec.Command(launcher.Name, launcher.Args...)
	if err := cmd.Start(); err != nil {
		_ = os.Remove(f.Name())
		return nil, fmt.Errorf("could not start %s: %w", launcher.Client, err)
	}

	s := &Session{Client: launcher.Client, Tracked: launcher.Tracked, cmd: cmd, file: f.Name()}
	go func() {
		waitErr := cmd.Wait()
		// The client has read the file by now on every platform; it is
		// only kept this long so a client that reads lazily is not
		// handed a path that has already gone.
		_ = os.Remove(s.file)
		s.mu.Lock()
		deliberate := s.closed
		s.mu.Unlock()
		if launcher.Tracked && onExit != nil {
			onExit(waitErr, deliberate)
		}
	}()
	return s, nil
}

// Close ends the client. Killing it is the only lever a launcher has, and
// for a Remote Desktop client that is the same as closing its window.
func (s *Session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()
	if s.cmd.Process == nil {
		return nil
	}
	if err := s.cmd.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	return nil
}

// TempDir is where the .rdp files go: their own directory under the OS
// temp dir, so nothing else is ever swept up with them.
func TempDir() string {
	return filepath.Join(os.TempDir(), "xpecter-rdp")
}
