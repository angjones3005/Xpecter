// Package nettools holds the small self-contained network utilities that
// live alongside Xpecter's sessions: Wake-on-LAN and a TCP port scan.
// Both are pure standard library — nothing here dials SSH or depends on
// a live session.
package nettools

import (
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SendMagicPacket wakes a machine by its MAC address. The magic packet
// is six 0xFF bytes followed by the target MAC repeated sixteen times,
// broadcast as UDP; a machine with Wake-on-LAN enabled powers on when it
// sees its own address in one. broadcast is where to send it — a
// directed broadcast for the target's subnet reaches further than the
// limited 255.255.255.255, but the latter is the default that works on
// the local segment. Port 9 (discard) is the convention, filled in when
// none is given.
func SendMagicPacket(mac, broadcast string) error {
	hw, err := net.ParseMAC(strings.TrimSpace(mac))
	if err != nil {
		return fmt.Errorf("invalid MAC address %q: %w", mac, err)
	}
	if len(hw) != 6 {
		return fmt.Errorf("expected a 6-byte MAC address, got %d bytes", len(hw))
	}

	packet := make([]byte, 0, 102)
	for i := 0; i < 6; i++ {
		packet = append(packet, 0xFF)
	}
	for i := 0; i < 16; i++ {
		packet = append(packet, hw...)
	}

	broadcast = strings.TrimSpace(broadcast)
	if broadcast == "" {
		broadcast = "255.255.255.255"
	}
	if _, _, err := net.SplitHostPort(broadcast); err != nil {
		broadcast = net.JoinHostPort(broadcast, "9")
	}

	conn, err := net.Dial("udp", broadcast)
	if err != nil {
		return fmt.Errorf("opening broadcast socket: %w", err)
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.Write(packet); err != nil {
		return fmt.Errorf("sending magic packet: %w", err)
	}
	return nil
}

// ScanPorts reports which of the given TCP ports on host accept a
// connection within timeout. A successful dial means open; anything else
// (refused, filtered, timed out) is treated as not open, which is all a
// quick reachability scan can honestly claim. Ports are probed
// concurrently but capped, so a wide scan does not open thousands of
// sockets at once. The result is sorted.
func ScanPorts(host string, ports []int, timeout time.Duration) []int {
	const maxConcurrent = 128
	open := make([]int, 0, len(ports))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxConcurrent)

	for _, p := range ports {
		if p < 1 || p > 65535 {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(port int) {
			defer wg.Done()
			defer func() { <-sem }()
			conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), timeout)
			if err != nil {
				return
			}
			_ = conn.Close()
			mu.Lock()
			open = append(open, port)
			mu.Unlock()
		}(p)
	}
	wg.Wait()
	sort.Ints(open)
	return open
}
