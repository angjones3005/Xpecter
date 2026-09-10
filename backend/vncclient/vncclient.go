// Package vncclient launches the operating system's VNC viewer for a
// saved VNC session and tracks the process it started.
//
// Like backend/rdpclient, Xpecter does not draw the remote screen
// itself; a VNC desktop wants a native viewer, and this hands the
// session to whichever one the platform has. Unlike RDP there is no
// universal file format and Windows ships no built-in viewer, so a
// session is passed as a command-line address to whatever viewer is
// found on PATH — TigerVNC/RealVNC/TightVNC/UltraVNC on Windows and
// Linux, and macOS's own Screen Sharing via `open vnc://`.
//
// No password is stored or passed: every VNC viewer prompts for it, the
// same policy the rest of Xpecter keeps.
package vncclient

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

const DefaultPort = 5900

type Options struct {
	Host string
	Port int
}

// Address is what a viewer is told to connect to. VNC's own convention
// is "host" for the default display and "host::port" — the double colon
// meaning an explicit TCP port rather than a display number — which the
// TigerVNC, TightVNC and UltraVNC families all accept. The default port
// is left implicit because a bare "host" is what every viewer assumes.
func (o Options) Address() string {
	host := strings.TrimSpace(o.Host)
	if o.Port == 0 || o.Port == DefaultPort {
		return host
	}
	return host + "::" + strconv.Itoa(o.Port)
}

// URL is the vnc:// form macOS's `open` and Remmina take, where a normal
// host:port is what they expect.
func (o Options) URL() string {
	host := strings.TrimSpace(o.Host)
	port := o.Port
	if port == 0 {
		port = DefaultPort
	}
	return "vnc://" + net.JoinHostPort(host, strconv.Itoa(port))
}

func (o Options) Validate() error {
	if strings.TrimSpace(o.Host) == "" {
		return errors.New("a host is required")
	}
	if o.Port < 0 || o.Port > 65535 {
		return fmt.Errorf("port %d is out of range", o.Port)
	}
	return nil
}

type Launcher struct {
	Client  string
	Name    string
	Args    []string
	Tracked bool
}

// resolve picks the viewer for a platform. lookPath is injected so the
// Windows and Linux branches, which depend on what is installed, are
// testable without installing anything.
func resolve(o Options, goos string, lookPath func(string) (string, error)) (Launcher, error) {
	switch goos {
	case "darwin":
		// Screen Sharing, via the vnc:// URL handler. `open` returns as
		// soon as it has launched the viewer, so it cannot be tracked.
		return Launcher{Client: "Screen Sharing", Name: "open", Args: []string{o.URL()}, Tracked: false}, nil
	case "windows":
		// The common viewers, by the names they install under. Whichever
		// is found first wins; all take a bare address argument.
		for _, v := range []struct{ exe, name string }{
			{"vncviewer.exe", "VNC Viewer"},
			{"tvnviewer.exe", "TightVNC Viewer"},
			{"uvnc.exe", "UltraVNC"},
			{"vncviewer64.exe", "UltraVNC"},
		} {
			if _, err := lookPath(v.exe); err == nil {
				return Launcher{Client: v.name, Name: v.exe, Args: []string{o.Address()}, Tracked: true}, nil
			}
		}
		return Launcher{}, errors.New("no VNC viewer found: install TigerVNC, RealVNC, TightVNC or UltraVNC")
	default:
		if _, err := lookPath("vncviewer"); err == nil {
			return Launcher{Client: "vncviewer", Name: "vncviewer", Args: []string{o.Address()}, Tracked: true}, nil
		}
		if _, err := lookPath("remmina"); err == nil {
			return Launcher{Client: "Remmina", Name: "remmina", Args: []string{"-c", o.URL()}, Tracked: true}, nil
		}
		if _, err := lookPath("vinagre"); err == nil {
			return Launcher{Client: "Vinagre", Name: "vinagre", Args: []string{o.URL()}, Tracked: true}, nil
		}
		return Launcher{}, errors.New("no VNC viewer found: install TigerVNC (vncviewer), Remmina or Vinagre")
	}
}

type Session struct {
	Client  string
	Tracked bool
	cmd     *exec.Cmd
	mu      sync.Mutex
	closed  bool
}

func Launch(o Options, onExit func(err error, deliberate bool)) (*Session, error) {
	if err := o.Validate(); err != nil {
		return nil, err
	}
	launcher, err := resolve(o, runtime.GOOS, exec.LookPath)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(launcher.Name, launcher.Args...)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("could not start %s: %w", launcher.Client, err)
	}
	s := &Session{Client: launcher.Client, Tracked: launcher.Tracked, cmd: cmd}
	go func() {
		waitErr := cmd.Wait()
		s.mu.Lock()
		deliberate := s.closed
		s.mu.Unlock()
		if launcher.Tracked && onExit != nil {
			onExit(waitErr, deliberate)
		}
	}()
	return s, nil
}

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
