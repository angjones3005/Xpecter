package main

import (
	"net/url"
	"strconv"
	"strings"

	"xpecter/backend/config"
	"xpecter/backend/idgen"
)

// --- Importing PuTTY's saved sessions ---
//
// PuTTY keeps its sessions in the registry, one key per session under
// HKCU\Software\SimonTatham\PuTTY\Sessions, with the session's name as
// the key name, percent-encoded. The values are the whole of PuTTY's
// configuration; the handful that describe where to connect and how
// are read, and the rest (colours, fonts, window size) is left to
// PuTTY.

// puttyValues answers PuTTY's registry values for one session: the
// string or number stored under name, and whether it was there at all.
// Injected so the mapping can be tested without a registry.
type puttyValues func(name string) (string, bool)

// puttySessionName decodes a registry key name into the name the user
// gave the session: PuTTY encodes anything outside a safe set as %XX.
func puttySessionName(key string) string {
	decoded, err := url.PathUnescape(key)
	if err != nil {
		return key
	}
	return decoded
}

// puttyToProfile maps one session. The second result is false for a
// session Xpecter has no equivalent for (raw and rlogin, or one with
// no host), and for PuTTY's own "Default Settings" key.
func puttyToProfile(key string, get puttyValues) (config.SessionProfile, bool) {
	name := puttySessionName(key)
	if name == "" || name == "Default Settings" {
		return config.SessionProfile{}, false
	}
	str := func(field string) string {
		v, _ := get(field)
		return strings.TrimSpace(v)
	}
	num := func(field string) int {
		v, ok := get(field)
		if !ok {
			return 0
		}
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return 0
		}
		return n
	}
	flag := func(field string) bool { return num(field) != 0 }

	profile := config.SessionProfile{ID: idgen.New(), Name: name}
	switch strings.ToLower(str("Protocol")) {
	case "serial":
		port := str("SerialLine")
		if port == "" {
			return config.SessionProfile{}, false
		}
		profile.Type = "serial"
		profile.SerialPort = port
		profile.Baud = num("SerialSpeed")
		if profile.Baud == 0 {
			profile.Baud = 9600
		}
		return profile, true
	case "ssh", "":
		host := str("HostName")
		if host == "" {
			return config.SessionProfile{}, false
		}
		// PuTTY allows user@host in the host field.
		if at := strings.LastIndex(host, "@"); at > 0 {
			if profile.User == "" {
				profile.User = host[:at]
			}
			host = host[at+1:]
		}
		profile.Type = "ssh"
		profile.Host = host
		if user := str("UserName"); user != "" {
			profile.User = user
		}
		profile.Port = num("PortNumber")
		if profile.Port == 0 {
			profile.Port = 22
		}
		// A key in PuTTY's own .ppk format is not one Xpecter can read
		// (it wants OpenSSH or PEM), so it is left out and the session
		// uses the agent instead, which for a PuTTY user is Pageant
		// holding that same key. Any other format is kept as named.
		if keyPath := str("PublicKeyFile"); keyPath != "" && !strings.HasSuffix(strings.ToLower(keyPath), ".ppk") {
			profile.KeyPath = keyPath
		}
		// TryAgent is on by default in PuTTY; only an explicit 0 turns
		// it off. A key file takes precedence when one is named.
		if profile.KeyPath == "" {
			if v, ok := get("TryAgent"); !ok || strings.TrimSpace(v) != "0" {
				profile.UseAgent = true
			}
		}
		profile.ForwardAgent = flag("AgentFwd")
		profile.X11 = flag("X11Forward")
		// A PuTTY "proxy" of type SSH (ProxyMethod 6 in recent versions)
		// is a jump host. Older methods (HTTP, SOCKS) have no place here.
		if num("ProxyMethod") == 6 {
			if jump := str("ProxyHost"); jump != "" {
				if user := str("ProxyUsername"); user != "" {
					jump = user + "@" + jump
				}
				if port := num("ProxyPort"); port != 0 && port != 22 {
					jump = jump + ":" + strconv.Itoa(port)
				}
				profile.JumpHost = jump
			}
		}
		return profile, true
	default:
		// telnet, rlogin, raw: not session types this app saves.
		return config.SessionProfile{}, false
	}
}
