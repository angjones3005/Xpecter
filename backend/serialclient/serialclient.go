// Package serialclient wraps go.bug.st/serial to provide console access
// over a physical serial/USB port, the same way pty provides local shell
// access and sshclient provides SSH. Used for direct console connections
// to network hardware (switches, routers) that don't expose SSH, a real
// need for Skald's hardware validation work.
package serialclient

import (
	"go.bug.st/serial"
)

type Session struct {
	port serial.Port
}

// Open opens a serial port at the given baud rate with standard 8N1
// framing and no flow control, covering the vast majority of network
// hardware console connections. onData is called as bytes arrive.
func Open(portName string, baud int, onData func([]byte)) (*Session, error) {
	mode := &serial.Mode{
		BaudRate: baud,
		Parity:   serial.NoParity,
		DataBits: 8,
		StopBits: serial.OneStopBit,
	}
	port, err := serial.Open(portName, mode)
	if err != nil {
		return nil, err
	}

	s := &Session{port: port}

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := port.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				onData(chunk)
			}
			if err != nil {
				return
			}
		}
	}()

	return s, nil
}

func (s *Session) Write(data []byte) error {
	_, err := s.port.Write(data)
	return err
}

func (s *Session) Close() error {
	return s.port.Close()
}

// ListPorts returns available serial port device paths (e.g. "COM3" on
// Windows, "/dev/ttyUSB0" on Linux), for a future port-picker UI.
func ListPorts() ([]string, error) {
	return serial.GetPortsList()
}
