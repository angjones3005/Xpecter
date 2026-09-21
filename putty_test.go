package main

import "testing"

func valuesOf(m map[string]string) puttyValues {
	return func(name string) (string, bool) {
		v, ok := m[name]
		return v, ok
	}
}

func TestPuttySessionName(t *testing.T) {
	cases := map[string]string{
		"lab%20switch%201": "lab switch 1",
		"web1":             "web1",
		"a%2Fb":            "a/b",
		"100%":             "100%", // a bad escape is left as it is
	}
	for key, want := range cases {
		if got := puttySessionName(key); got != want {
			t.Errorf("puttySessionName(%q) = %q, want %q", key, got, want)
		}
	}
}

func TestPuttyToProfileSSH(t *testing.T) {
	profile, ok := puttyToProfile("core%20switch", valuesOf(map[string]string{
		"Protocol":      "ssh",
		"HostName":      "10.0.0.1",
		"PortNumber":    "2222",
		"UserName":      "admin",
		"PublicKeyFile": `C:\Users\me\keys\lab.ppk`,
		"AgentFwd":      "1",
		"X11Forward":    "0",
		"ProxyMethod":   "6",
		"ProxyHost":     "bastion.example",
		"ProxyUsername": "ops",
		"ProxyPort":     "2200",
	}))
	if !ok {
		t.Fatal("an SSH session was refused")
	}
	want := map[string]any{
		"Name": "core switch", "Type": "ssh", "Host": "10.0.0.1", "Port": 2222, "User": "admin",
		"KeyPath": "", "UseAgent": true, "ForwardAgent": true, "X11": false,
		"JumpHost": "ops@bastion.example:2200",
	}
	got := map[string]any{
		"Name": profile.Name, "Type": profile.Type, "Host": profile.Host, "Port": profile.Port, "User": profile.User,
		"KeyPath": profile.KeyPath, "UseAgent": profile.UseAgent, "ForwardAgent": profile.ForwardAgent, "X11": profile.X11,
		"JumpHost": profile.JumpHost,
	}
	for field, w := range want {
		if got[field] != w {
			t.Errorf("%s = %v, want %v", field, got[field], w)
		}
	}
	if profile.ID == "" {
		t.Error("imported profile has no id")
	}
}

func TestPuttyToProfileDefaults(t *testing.T) {
	// The minimum PuTTY writes: a host. Everything else is PuTTY's
	// default, which for the agent is on.
	profile, ok := puttyToProfile("web1", valuesOf(map[string]string{"HostName": "deploy@web1.example"}))
	if !ok {
		t.Fatal("refused")
	}
	if profile.Host != "web1.example" || profile.User != "deploy" || profile.Port != 22 || !profile.UseAgent {
		t.Errorf("profile = %+v", profile)
	}
	// An explicit TryAgent=0 turns the agent off.
	profile, _ = puttyToProfile("web2", valuesOf(map[string]string{"HostName": "web2", "TryAgent": "0"}))
	if profile.UseAgent {
		t.Error("TryAgent=0 left the agent on")
	}
}

func TestPuttyToProfileSerialAndRefusals(t *testing.T) {
	profile, ok := puttyToProfile("console", valuesOf(map[string]string{"Protocol": "serial", "SerialLine": "COM4", "SerialSpeed": "115200"}))
	if !ok || profile.Type != "serial" || profile.SerialPort != "COM4" || profile.Baud != 115200 {
		t.Errorf("serial profile = %+v, ok=%v", profile, ok)
	}
	for name, values := range map[string]map[string]string{
		"Default Settings": {"HostName": "x"},
		"telnet":           {"Protocol": "telnet", "HostName": "x"},
		"raw":              {"Protocol": "raw", "HostName": "x"},
		"no host":          {"Protocol": "ssh"},
		"no serial line":   {"Protocol": "serial"},
	} {
		if _, ok := puttyToProfile(name, valuesOf(values)); ok {
			t.Errorf("%s was imported", name)
		}
	}
}

// A key file PuTTY names is kept unless it is in PuTTY's own format,
// which Xpecter cannot read; that session uses the agent instead.
func TestPuttyToProfileKeyFiles(t *testing.T) {
	profile, _ := puttyToProfile("open", valuesOf(map[string]string{"HostName": "h", "PublicKeyFile": "C:/Users/me/.ssh/id_ed25519"}))
	if profile.KeyPath != "C:/Users/me/.ssh/id_ed25519" || profile.UseAgent {
		t.Errorf("OpenSSH key: KeyPath=%q UseAgent=%v", profile.KeyPath, profile.UseAgent)
	}
	profile, _ = puttyToProfile("ppk", valuesOf(map[string]string{"HostName": "h", "PublicKeyFile": "C:/keys/lab.PPK"}))
	if profile.KeyPath != "" || !profile.UseAgent {
		t.Errorf(".ppk key: KeyPath=%q UseAgent=%v", profile.KeyPath, profile.UseAgent)
	}
}
