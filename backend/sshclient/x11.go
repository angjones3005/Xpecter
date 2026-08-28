package sshclient

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"golang.org/x/crypto/ssh"
)

// EnableX11 requests X11 forwarding and proxies incoming X11 channels to the
// local DISPLAY. A local X server is still required, such as XQuartz or VcXsrv.
func (s *Session) EnableX11() error {
	display := os.Getenv("DISPLAY")
	if display == "" {
		return fmt.Errorf("X11 forwarding requested but DISPLAY is not set")
	}
	cookie := os.Getenv("XPECTER_X11_COOKIE")
	if cookie == "" {
		// Pre-rename name, still honoured: someone who exports it in
		// their shell profile shouldn't find the override silently
		// stopped working after upgrading.
		cookie = os.Getenv("SPECTER_X11_COOKIE")
	}
	if cookie == "" {
		cookie = x11Cookie(display)
	}
	payload := new(bytes.Buffer)
	payload.WriteByte(0)
	_ = binary.Write(payload, binary.BigEndian, uint32(len("MIT-MAGIC-COOKIE-1")))
	payload.WriteString("MIT-MAGIC-COOKIE-1")
	_ = binary.Write(payload, binary.BigEndian, uint32(len(cookie)))
	payload.WriteString(cookie)
	_ = binary.Write(payload, binary.BigEndian, uint32(0))
	ok, err := s.sess.SendRequest("x11-req", true, payload.Bytes())
	if err != nil {
		return fmt.Errorf("requesting X11 forwarding: %w", err)
	}
	if !ok {
		return fmt.Errorf("SSH server rejected X11 forwarding")
	}
	channels := s.client.HandleChannelOpen("x11")
	go func() {
		for newChannel := range channels {
			channel, requests, err := newChannel.Accept()
			if err != nil {
				continue
			}
			go ssh.DiscardRequests(requests)
			local, err := dialX11Display(display)
			if err != nil {
				_ = channel.Close()
				continue
			}
			go proxyX11(channel, local)
		}
	}()
	return nil
}

func x11Cookie(display string) string {
	args := []string{}
	if path := os.Getenv("XAUTHORITY"); path != "" {
		args = append(args, "-f", path)
	}
	args = append(args, "nlist", display)
	data, err := exec.Command("xauth", args...).Output()
	if err != nil {
		return ""
	}
	fields := bytes.Fields(data)
	if len(fields) == 0 {
		return ""
	}
	return string(fields[len(fields)-1])
}

func dialX11Display(display string) (net.Conn, error) {
	if strings.HasPrefix(display, ":") {
		number := strings.TrimPrefix(strings.Split(display, ".")[0], ":")
		if n, err := strconv.Atoi(number); err == nil {
			return net.Dial("unix", fmt.Sprintf("/tmp/.X11-unix/X%d", n))
		}
	}
	host := "127.0.0.1"
	port := "6000"
	if strings.Contains(display, ":") {
		parts := strings.Split(display, ":")
		if parts[0] != "" {
			host = parts[0]
		}
		port = strconv.Itoa(6000 + atoiOrZero(strings.Split(parts[1], ".")[0]))
	}
	return net.Dial("tcp", net.JoinHostPort(host, port))
}

func atoiOrZero(value string) int {
	n, _ := strconv.Atoi(value)
	return n
}

type x11Stream interface {
	io.Reader
	io.Writer
	io.Closer
}

func proxyX11(left x11Stream, right x11Stream) {
	defer func() { _ = left.Close() }()
	defer func() { _ = right.Close() }()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(left, right); done <- struct{}{} }()
	go func() { _, _ = io.Copy(right, left); done <- struct{}{} }()
	<-done
}
