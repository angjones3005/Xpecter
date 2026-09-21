package main

import (
	"bytes"
	"io"
	"net"
	"testing"
	"time"
)

// A SOCKS5 CONNECT as curl --socks5 and a browser send it.
func socksClient(t *testing.T, conn net.Conn, request []byte) []byte {
	t.Helper()
	if _, err := conn.Write([]byte{0x05, 0x01, 0x00}); err != nil {
		t.Fatal(err)
	}
	var method [2]byte
	if _, err := io.ReadFull(conn, method[:]); err != nil {
		t.Fatal(err)
	}
	if method != [2]byte{0x05, 0x00} {
		t.Fatalf("method reply = %v", method)
	}
	// Written from its own goroutine: net.Pipe hands bytes over only
	// as they are read, and a server that rejects the request after its
	// fourth byte never reads the rest, which is fine for a socket with
	// a buffer and a deadlock for a pipe.
	go func() { _, _ = conn.Write(request) }()
	reply := make([]byte, 10)
	if _, err := io.ReadFull(conn, reply); err != nil {
		t.Fatal(err)
	}
	return reply
}

func TestSocks5TargetParsesEveryAddressType(t *testing.T) {
	cases := map[string][]byte{
		"10.0.0.5:443":          {0x05, 0x01, 0x00, 0x01, 10, 0, 0, 5, 0x01, 0xbb},
		"intranet.example:8080": append(append([]byte{0x05, 0x01, 0x00, 0x03, 16}, []byte("intranet.example")...), 0x1f, 0x90),
		"[fe80::1]:22":          append(append([]byte{0x05, 0x01, 0x00, 0x04}, net.ParseIP("fe80::1").To16()...), 0x00, 0x16),
	}
	for want, request := range cases {
		server, client := net.Pipe()
		got := make(chan string, 1)
		go func() {
			target, err := socks5Target(server)
			if err != nil {
				t.Errorf("%s: %v", want, err)
			}
			got <- target
			_, _ = server.Write(socks5Reply(socks5Succeeded))
			_ = server.Close()
		}()
		reply := socksClient(t, client, request)
		if reply[1] != socks5Succeeded {
			t.Errorf("%s: reply code %d", want, reply[1])
		}
		select {
		case target := <-got:
			if target != want {
				t.Errorf("target = %q, want %q", target, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("%s: handshake never finished", want)
		}
		_ = client.Close()
	}
}

func TestSocks5TargetRefusesWhatItCannotDo(t *testing.T) {
	// BIND is not CONNECT.
	server, client := net.Pipe()
	go func() {
		if _, err := socks5Target(server); err == nil {
			t.Error("a BIND request was accepted")
		}
		_ = server.Close()
	}()
	reply := socksClient(t, client, []byte{0x05, 0x02, 0x00, 0x01, 10, 0, 0, 5, 0x00, 0x50})
	if reply[1] != socks5CmdUnsupported {
		t.Errorf("BIND reply code = %d, want command unsupported", reply[1])
	}
	_ = client.Close()

	// A client that only offers username/password authentication.
	server, client = net.Pipe()
	go func() {
		if _, err := socks5Target(server); err == nil {
			t.Error("a client with no usable auth method was accepted")
		}
		_ = server.Close()
	}()
	if _, err := client.Write([]byte{0x05, 0x01, 0x02}); err != nil {
		t.Fatal(err)
	}
	var method [2]byte
	if _, err := io.ReadFull(client, method[:]); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(method[:], []byte{0x05, 0xff}) {
		t.Errorf("method reply = %v, want no acceptable methods", method)
	}
	_ = client.Close()

	// Not SOCKS at all: an HTTP request on the proxy port.
	server, client = net.Pipe()
	go func() {
		_, _ = client.Write([]byte("GET / HTTP/1.1\r\n"))
		_ = client.Close()
	}()
	if _, err := socks5Target(server); err == nil {
		t.Error("an HTTP request was accepted as SOCKS5")
	}
	_ = server.Close()
}

func TestSocks5ReplyShape(t *testing.T) {
	reply := socks5Reply(socks5HostUnreachable)
	if len(reply) != 10 || reply[0] != 0x05 || reply[1] != socks5HostUnreachable || reply[3] != 0x01 {
		t.Fatalf("reply = %v", reply)
	}
}
