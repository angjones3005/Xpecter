package nettools

import (
	"net"
	"reflect"
	"testing"
	"time"
)

func TestSendMagicPacketRejectsBadMAC(t *testing.T) {
	if err := SendMagicPacket("not-a-mac", ""); err == nil {
		t.Error("bad MAC accepted")
	}
}

// Sends a real magic packet to a UDP socket bound on loopback and checks
// the bytes: six 0xFF, then the MAC sixteen times.
func TestSendMagicPacketBytes(t *testing.T) {
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	if err := SendMagicPacket("01:02:03:04:05:06", conn.LocalAddr().String()); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 128)
	n, _, err := conn.ReadFrom(buf)
	if err != nil {
		t.Fatal(err)
	}
	if n != 102 {
		t.Fatalf("magic packet is %d bytes, want 102", n)
	}
	for i := 0; i < 6; i++ {
		if buf[i] != 0xFF {
			t.Fatalf("byte %d = %#x, want 0xFF", i, buf[i])
		}
	}
	mac := []byte{1, 2, 3, 4, 5, 6}
	for rep := 0; rep < 16; rep++ {
		got := buf[6+rep*6 : 6+rep*6+6]
		if !reflect.DeepEqual(got, mac) {
			t.Fatalf("repetition %d = %v, want %v", rep, got, mac)
		}
	}
}

func TestScanPortsFindsOpenListener(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	openPort := ln.Addr().(*net.TCPAddr).Port

	// A port very likely closed on loopback, alongside the open one.
	got := ScanPorts("127.0.0.1", []int{openPort, 1}, 500*time.Millisecond)
	found := false
	for _, p := range got {
		if p == openPort {
			found = true
		}
	}
	if !found {
		t.Fatalf("open port %d not reported; got %v", openPort, got)
	}
}
