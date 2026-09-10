package vncclient

import (
	"errors"
	"reflect"
	"testing"
)

func TestAddress(t *testing.T) {
	cases := map[Options]string{
		{Host: "srv01"}:                "srv01",
		{Host: "srv01", Port: 5900}:    "srv01",
		{Host: "srv01", Port: 5901}:    "srv01::5901",
		{Host: "10.0.0.5", Port: 5905}: "10.0.0.5::5905",
	}
	for o, want := range cases {
		if got := o.Address(); got != want {
			t.Errorf("Address(%+v) = %q, want %q", o, got, want)
		}
	}
}

func TestURL(t *testing.T) {
	if got := (Options{Host: "srv01"}).URL(); got != "vnc://srv01:5900" {
		t.Errorf("URL default = %q", got)
	}
	if got := (Options{Host: "srv01", Port: 5901}).URL(); got != "vnc://srv01:5901" {
		t.Errorf("URL = %q", got)
	}
}

func TestValidate(t *testing.T) {
	if err := (Options{}).Validate(); err == nil {
		t.Error("empty host accepted")
	}
	if err := (Options{Host: "h", Port: 70000}).Validate(); err == nil {
		t.Error("out-of-range port accepted")
	}
	if err := (Options{Host: "h", Port: 5901}).Validate(); err != nil {
		t.Errorf("valid options refused: %v", err)
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

func TestResolveDarwinUntracked(t *testing.T) {
	l, err := resolve(Options{Host: "srv01", Port: 5901}, "darwin", lookPathWith())
	if err != nil {
		t.Fatal(err)
	}
	if l.Name != "open" || l.Tracked || !reflect.DeepEqual(l.Args, []string{"vnc://srv01:5901"}) {
		t.Fatalf("resolve(darwin) = %+v", l)
	}
}

func TestResolveWindowsPrefersFoundViewer(t *testing.T) {
	l, err := resolve(Options{Host: "srv01", Port: 5901}, "windows", lookPathWith("tvnviewer.exe"))
	if err != nil {
		t.Fatal(err)
	}
	if l.Name != "tvnviewer.exe" || !l.Tracked || !reflect.DeepEqual(l.Args, []string{"srv01::5901"}) {
		t.Fatalf("resolve(windows) = %+v", l)
	}
	if _, err := resolve(Options{Host: "srv01"}, "windows", lookPathWith()); err == nil {
		t.Fatal("resolve(windows) with no viewer found no error")
	}
}

func TestResolveLinuxPrefersVncviewerThenRemmina(t *testing.T) {
	l, err := resolve(Options{Host: "srv01", Port: 5901}, "linux", lookPathWith("remmina", "vncviewer"))
	if err != nil {
		t.Fatal(err)
	}
	if l.Name != "vncviewer" || !reflect.DeepEqual(l.Args, []string{"srv01::5901"}) {
		t.Fatalf("resolve(linux) = %+v, want vncviewer", l)
	}
	l, err = resolve(Options{Host: "srv01", Port: 5901}, "linux", lookPathWith("remmina"))
	if err != nil {
		t.Fatal(err)
	}
	if l.Name != "remmina" || !reflect.DeepEqual(l.Args, []string{"-c", "vnc://srv01:5901"}) {
		t.Fatalf("resolve(linux, remmina) = %+v", l)
	}
	if _, err := resolve(Options{Host: "srv01"}, "linux", lookPathWith()); err == nil {
		t.Fatal("resolve(linux) with nothing installed found no error")
	}
}
