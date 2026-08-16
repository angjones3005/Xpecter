// Package serialclient wraps go.bug.st/serial to provide console access
// over a physical serial/USB port, the same way pty provides local shell
// access and sshclient provides SSH. Used for direct console connections
// to network hardware (switches, routers) that don't expose SSH, a real
// need for Skald's hardware validation work.
package serialclient

import (
	"sync/atomic"

	"go.bug.st/serial"
)

type Session struct {
	port    serial.Port
	closing atomic.Bool
}

// CloseReason mirrors sshclient.CloseReason: distinguishes a deliberate
// local close (tab closed by the user) from an unexpected drop, e.g. the
// device losing power or the USB-serial adapter disconnecting (SPE-59).
// EOF is generally not meaningful for serial ports (they don't "close"
// the way a TCP stream does), but is included for parity with SSH.
type CloseReason struct {
	Deliberate bool
	EOF        bool
	Err        error
}

// Open opens a serial port at the given baud rate with standard 8N1
// framing and no flow control, covering the vast majority of network
// hardware console connections. onData is called as bytes arrive;
// onClose fires exactly once when the read loop stops.
func Open(portName string, baud int, onData func([]byte), onClose func(CloseReason)) (*Session, error) {
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
				if onClose != nil {
					onClose(CloseReason{Deliberate: s.closing.Load(), Err: err})
				}
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
	s.closing.Store(true)
	return s.port.Close()
}

// ListPorts returns available serial port device paths (e.g. "COM3" on
// Windows, "/dev/ttyUSB0" on Linux), for a future port-picker UI.
func ListPorts() ([]string, error) {
	return serial.GetPortsList()
}
