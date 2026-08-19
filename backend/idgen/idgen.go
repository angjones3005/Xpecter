// Package idgen generates short random hex IDs, used for session,
// group, and profile identifiers throughout Specter. Previously
// duplicated verbatim in app.go and sshclient.go.
package idgen

import (
	"crypto/rand"
	"encoding/hex"
)

// New returns a random 16-character hex ID (8 bytes of entropy).
func New() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
