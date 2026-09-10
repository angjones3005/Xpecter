// Package secret is Xpecter's thin door onto the operating system's own
// credential store — Windows Credential Manager, macOS Keychain, the
// Linux Secret Service. It exists so the rest of the app never imports a
// keyring library directly, and so the one place a password is written
// off-process is small and obvious.
//
// This is the only part of Xpecter that stores a password, and it does
// so only where the OS already protects one. Xpecter writes no encrypted
// blob of its own — the long-standing rule in backend/config/sessions.go
// — because reinventing that is exactly the weakness (MobaXterm's
// reversible obfuscation) the project set out not to repeat.
package secret

import (
	"errors"

	"github.com/zalando/go-keyring"
)

// service is the label every Xpecter secret is filed under in the store,
// so they are recognisable and removable as a group.
const service = "Xpecter"

// Set stores secret for account, replacing any existing value.
func Set(account, secret string) error {
	return keyring.Set(service, account, secret)
}

// Get returns the stored secret for account, or "" with no error when
// none is stored: "nothing saved" is an ordinary answer here, not a
// failure the caller should have to distinguish.
func Get(account string) (string, error) {
	value, err := keyring.Get(service, account)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", nil
	}
	return value, err
}

// Delete removes the stored secret for account. Removing one that was
// never there is success, not an error.
func Delete(account string) error {
	err := keyring.Delete(service, account)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}
