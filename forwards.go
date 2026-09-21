package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"time"

	"xpecter/backend/idgen"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// --- Dynamic (SOCKS5) and remote forwards ---
//
// A local forward maps one port to one service. The other two shapes a
// tunnel takes are here: a SOCKS5 proxy, so a browser or any program
// that speaks SOCKS reaches the far network through the session as if
// it were there, and a remote forward, which asks the host to listen
// and delivers what arrives to a port on this machine.

// StartDynamicForward binds 127.0.0.1:localPort as a SOCKS5 proxy whose
// connections leave from the host of sessionID.
func (a *App) StartDynamicForward(sessionID string, localPort int) (string, error) {
	sess, err := a.session(sessionID)
	if err != nil {
		return "", err
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
	if err != nil {
		return "", err
	}
	forwardID := idgen.New()
	a.forwards.put(forwardID, localForward{listener: listener, sessionID: sessionID, kind: "dynamic"})
	go func() {
		for {
			local, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				// A client that connects and then says nothing would
				// otherwise hold this goroutine for good.
				_ = local.SetReadDeadline(time.Now().Add(15 * time.Second))
				target, err := socks5Target(local)
				if err != nil {
					_ = local.Close()
					return
				}
				_ = local.SetReadDeadline(time.Time{})
				remote, err := sess.SSHClient().Dial("tcp", target)
				if err != nil {
					_, _ = local.Write(socks5Reply(socks5HostUnreachable))
					_ = local.Close()
					return
				}
				if _, err := local.Write(socks5Reply(socks5Succeeded)); err != nil {
					_ = local.Close()
					_ = remote.Close()
					return
				}
				proxyTCP(local, remote)
			}()
		}
	}()
	return forwardID, nil
}

// StartRemoteForward asks the host of sessionID to listen on remotePort
// and delivers each connection it accepts to localHost:localPort on
// this machine. Whether the host's port is reachable from beyond the
// host itself is the server's GatewayPorts setting, not ours.
func (a *App) StartRemoteForward(sessionID string, remotePort int, localHost string, localPort int) (string, error) {
	sess, err := a.session(sessionID)
	if err != nil {
		return "", err
	}
	if localHost == "" {
		localHost = "127.0.0.1"
	}
	listener, err := sess.SSHClient().Listen("tcp", fmt.Sprintf("0.0.0.0:%d", remotePort))
	if err != nil {
		return "", err
	}
	forwardID := idgen.New()
	a.forwards.put(forwardID, localForward{listener: listener, sessionID: sessionID, kind: "remote"})
	target := net.JoinHostPort(localHost, strconv.Itoa(localPort))
	go func() {
		for {
			remote, err := listener.Accept()
			if err != nil {
				return
			}
			// Dialled off the accept loop: a target that is down takes a
			// connect timeout to say so, and the next arrival should not
			// have to wait behind it.
			go func() {
				local, err := net.DialTimeout("tcp", target, 10*time.Second)
				if err != nil {
					_ = remote.Close()
					return
				}
				proxyTCP(remote, local)
			}()
		}
	}()
	return forwardID, nil
}

// SOCKS5 reply codes (RFC 1928, section 6).
const (
	socks5Succeeded       = 0x00
	socks5GeneralFailure  = 0x01
	socks5HostUnreachable = 0x04
	socks5CmdUnsupported  = 0x07
	socks5AddrUnsupported = 0x08
)

var errSocksVersion = errors.New("not a SOCKS5 client")

// socks5Target performs the server side of a SOCKS5 CONNECT: the method
// negotiation (no authentication, which is fine on 127.0.0.1) and the
// request, answering the target as "host:port". The success reply is
// the caller's to send once the far end is actually connected; every
// failure here is answered before the error is returned.
func socks5Target(conn net.Conn) (string, error) {
	var head [2]byte
	if _, err := io.ReadFull(conn, head[:]); err != nil {
		return "", err
	}
	if head[0] != 0x05 {
		return "", errSocksVersion
	}
	methods := make([]byte, int(head[1]))
	if _, err := io.ReadFull(conn, methods); err != nil {
		return "", err
	}
	// 0x00 is "no authentication required"; a client that does not
	// offer it is told no method is acceptable.
	offered := false
	for _, m := range methods {
		if m == 0x00 {
			offered = true
		}
	}
	if !offered {
		_, _ = conn.Write([]byte{0x05, 0xff})
		return "", errors.New("SOCKS5 client offers no usable authentication method")
	}
	if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
		return "", err
	}

	var req [4]byte
	if _, err := io.ReadFull(conn, req[:]); err != nil {
		return "", err
	}
	if req[0] != 0x05 {
		return "", errSocksVersion
	}
	if req[1] != 0x01 {
		_, _ = conn.Write(socks5Reply(socks5CmdUnsupported))
		return "", fmt.Errorf("SOCKS5 command %d is not supported (only CONNECT)", req[1])
	}
	var host string
	switch req[3] {
	case 0x01:
		var ip [4]byte
		if _, err := io.ReadFull(conn, ip[:]); err != nil {
			return "", err
		}
		host = net.IP(ip[:]).String()
	case 0x03:
		var n [1]byte
		if _, err := io.ReadFull(conn, n[:]); err != nil {
			return "", err
		}
		name := make([]byte, int(n[0]))
		if _, err := io.ReadFull(conn, name); err != nil {
			return "", err
		}
		host = string(name)
	case 0x04:
		var ip [16]byte
		if _, err := io.ReadFull(conn, ip[:]); err != nil {
			return "", err
		}
		host = net.IP(ip[:]).String()
	default:
		_, _ = conn.Write(socks5Reply(socks5AddrUnsupported))
		return "", fmt.Errorf("SOCKS5 address type %d is not supported", req[3])
	}
	var port [2]byte
	if _, err := io.ReadFull(conn, port[:]); err != nil {
		return "", err
	}
	return net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(port[:])))), nil
}

// socks5Reply is a reply with the given code and an unspecified bound
// address, which is all a CONNECT client looks at.
func socks5Reply(code byte) []byte {
	return []byte{0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0}
}

// ForwardInfo is what the frontend's manager shows for a forward the
// backend still has.
type ForwardInfo struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	Kind      string `json:"kind"`
	Address   string `json:"address"`
}

// ListForwards reports every forward the backend is running, so the
// manager can reconcile its own list with what is actually bound.
func (a *App) ListForwards() []ForwardInfo {
	out := []ForwardInfo{}
	for id, fwd := range a.forwards.snapshot() {
		out = append(out, ForwardInfo{ID: id, SessionID: fwd.sessionID, Kind: fwd.kind, Address: fwd.listener.Addr().String()})
	}
	return out
}

// emitForwardNotice tells the frontend something about a forward that
// happened without it asking: a saved forward that failed to start.
func (a *App) emitForwardNotice(sessionID string, message string) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "ssh:notice:"+sessionID, message)
}
