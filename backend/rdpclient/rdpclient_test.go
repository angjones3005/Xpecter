package rdpclient

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestAddressLeavesDefaultPortImplicit(t *testing.T) {
	cases := map[Options]string{
		{Host: "srv01"}:                 "srv01",
		{Host: "srv01", Port: 3389}:     "srv01",
		{Host: "srv01", Port: 3390}:     "srv01:3390",
		{Host: "10.0.0.5", Port: 13389}: "10.0.0.5:13389",
		{Host: "fe80::1"}:               "[fe80::1]",
		{Host: "fe80::1", Port: 3390}:   "[fe80::1]:3390",
		{Host: "  srv01  "}:             "srv01",
	}
	for o, want := range cases {
		if got := o.Address(); got != want {
			t.Errorf("Address(%+v) = %q, want %q", o, got, want)
		}
	}
}

func TestValidate(t *testing.T) {
	if err := (Options{}).Validate(); err == nil {
		t.Error("empty host accepted")
	}
	if err := (Options{Host: "h", Port: 70000}).Validate(); err == nil {
		t.Error("port 70000 accepted")
	}
	if err := (Options{Host: "h", Width: 1280}).Validate(); err == nil {
		t.Error("width without height accepted")
	}
	if err := (Options{Host: "h", Port: 3390, Width: 1280, Height: 800}).Validate(); err != nil {
		t.Errorf("valid options refused: %v", err)
	}
}

func TestFileDefaultWindowIsDynamic(t *testing.T) {
	// Host only, no size: a window that follows its frame, opened at the
	// default size. This is the case that used to write a bare
	// "screen mode id:i:1" and let mstsc pick a stale size.
	got := File(Options{Host: "srv01"})
	want := "full address:s:srv01\r\n" +
		"screen mode id:i:1\r\n" +
		"desktopwidth:i:1280\r\n" +
		"desktopheight:i:800\r\n" +
		"dynamic resolution:i:1\r\n" +
		"redirectclipboard:i:1\r\n"
	if got != want {
		t.Fatalf("File() default window =\n%q\nwant\n%q", got, want)
	}
}

func TestFileFullProfile(t *testing.T) {
	got := File(Options{
		Host: "srv01", Port: 3390, User: "angjo", Domain: "CORP",
		Width: 1600, Height: 900, AdminSession: true,
	})
	for _, line := range []string{
		"full address:s:srv01:3390\r\n",
		"username:s:angjo\r\n",
		"domain:s:CORP\r\n",
		"screen mode id:i:1\r\n",
		"desktopwidth:i:1600\r\n",
		"desktopheight:i:900\r\n",
		"smart sizing:i:1\r\n",
		"administrative session:i:1\r\n",
	} {
		if !strings.Contains(got, line) {
			t.Errorf("File() is missing %q:\n%s", line, got)
		}
	}
	// A fixed size takes smart sizing, never dynamic resolution: the two
	// conflict, and the point of choosing a size is to keep it.
	if strings.Contains(got, "dynamic resolution") {
		t.Errorf("a fixed-size window wrote dynamic resolution, which fights smart sizing:\n%s", got)
	}
}

func TestFileFullscreenOmitsSize(t *testing.T) {
	got := File(Options{Host: "srv01", Fullscreen: true, Width: 1600, Height: 900})
	if !strings.Contains(got, "screen mode id:i:2\r\n") {
		t.Errorf("fullscreen not written:\n%s", got)
	}
	if strings.Contains(got, "desktopwidth") {
		t.Errorf("a size was written alongside fullscreen, which mstsc would then use:\n%s", got)
	}
}

func lookPathWith(available ...string) func(string) (string, error) {
	return func(name string) (string, error) {
		for _, a := range available {
			if a == name {
				return "/usr/bin/" + name, nil
			}
		}
		return "", errors.New("not found")
	}
}

func TestResolveWindows(t *testing.T) {
	l, err := resolve(Options{Host: "srv01"}, `C:\Temp\s.rdp`, "windows", lookPathWith())
	if err != nil {
		t.Fatal(err)
	}
	if l.Name != "mstsc.exe" || !reflect.DeepEqual(l.Args, []string{`C:\Temp\s.rdp`}) || !l.Tracked {
		t.Fatalf("resolve(windows) = %+v", l)
	}
}

func TestResolveDarwinIsUntracked(t *testing.T) {
	l, err := resolve(Options{Host: "srv01"}, "/tmp/s.rdp", "darwin", lookPathWith())
	if err != nil {
		t.Fatal(err)
	}
	if l.Name != "open" || l.Tracked {
		t.Fatalf("resolve(darwin) = %+v; `open` returns as soon as it has handed the file over, so it must not be tracked", l)
	}
}

func TestResolveLinuxPrefersFreeRDP(t *testing.T) {
	o := Options{Host: "srv01", Port: 3390, User: "angjo", Domain: "CORP", Width: 1600, Height: 900, AdminSession: true}
	l, err := resolve(o, "/tmp/s.rdp", "linux", lookPathWith("remmina", "xfreerdp"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"/v:srv01:3390", "/cert:tofu", "+clipboard", "/u:angjo", "/d:CORP", "/size:1600x900", "/smart-sizing", "/admin"}
	if l.Name != "xfreerdp" || !reflect.DeepEqual(l.Args, want) {
		t.Fatalf("resolve(linux) = %+v, want xfreerdp %v", l, want)
	}
	l, err = resolve(Options{Host: "srv01", Fullscreen: true}, "/tmp/s.rdp", "linux", lookPathWith("xfreerdp3"))
	if err != nil {
		t.Fatal(err)
	}
	if l.Name != "xfreerdp3" || !reflect.DeepEqual(l.Args, []string{"/v:srv01", "/cert:tofu", "+clipboard", "/f"}) {
		t.Fatalf("resolve(linux, xfreerdp3 only) = %+v", l)
	}
}

func TestFreerdpDynamicWindowGetsDynamicResolution(t *testing.T) {
	// No fixed size: a following window, which on FreeRDP is
	// /dynamic-resolution — and never alongside /smart-sizing, which it
	// refuses to run with.
	l, err := resolve(Options{Host: "srv01"}, "/tmp/s.rdp", "linux", lookPathWith("xfreerdp"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"/v:srv01", "/cert:tofu", "+clipboard", "/size:1280x800", "/dynamic-resolution"}
	if !reflect.DeepEqual(l.Args, want) {
		t.Fatalf("resolve(linux, dynamic) args = %v, want %v", l.Args, want)
	}
	for _, a := range l.Args {
		if a == "/smart-sizing" {
			t.Fatalf("/smart-sizing appeared with /dynamic-resolution: %v", l.Args)
		}
	}
}

func TestResolveLinuxFallsBackToRemmina(t *testing.T) {
	l, err := resolve(Options{Host: "srv01", User: "angjo", Domain: "CORP"}, "/tmp/s.rdp", "linux", lookPathWith("remmina"))
	if err != nil {
		t.Fatal(err)
	}
	if l.Name != "remmina" || !reflect.DeepEqual(l.Args, []string{"-c", `rdp://CORP%5Cangjo@srv01`}) {
		t.Fatalf("resolve(linux, remmina only) = %+v", l)
	}
}

func TestResolveLinuxWithNothingInstalled(t *testing.T) {
	if _, err := resolve(Options{Host: "srv01"}, "/tmp/s.rdp", "linux", lookPathWith()); err == nil {
		t.Fatal("resolve(linux) with no client found no error")
	}
}
