package main

import (
	"errors"
	"strings"
	"testing"
)

func TestShQuote(t *testing.T) {
	cases := map[string]string{
		"/etc/hosts":            `'/etc/hosts'`,
		"/tmp/it's here":        `'/tmp/it'\''s here'`,
		"$(rm -rf /)":           `'$(rm -rf /)'`,
		"`id`":                  "'`id`'",
		"a b\"c":                `'a b"c'`,
		"":                      `''`,
		"/etc/nginx/sites/x; y": `'/etc/nginx/sites/x; y'`,
	}
	for in, want := range cases {
		if got := shQuote(in); got != want {
			t.Errorf("shQuote(%q) = %s, want %s", in, got, want)
		}
	}
}

// The command is one sudo invocation of one sh -c, every path quoted,
// and the temporary file removed on both outcomes.
func TestSudoCopyCommand(t *testing.T) {
	cmd := sudoCopyCommand("/tmp/.xpecter-sudo-1", "/etc/it's.conf")
	if !strings.HasPrefix(cmd, "sudo -S -p '' sh -c '") {
		t.Fatalf("command does not start with a silent sudo: %s", cmd)
	}
	for _, want := range []string{`cat '\''/tmp/.xpecter-sudo-1'\'' > '\''/etc/it'\''\'\'''\''s.conf'\''`, `rm -f '\''/tmp/.xpecter-sudo-1'\''`, "exit $status"} {
		if !strings.Contains(cmd, want) {
			t.Errorf("command lacks %s:\n%s", want, cmd)
		}
	}
}

func TestSudoFailureText(t *testing.T) {
	if got := sudoFailureText("\r\nsudo: a password is required\r\n\r\n", errors.New("exit 1")); got != "sudo: a password is required" {
		t.Errorf("got %q", got)
	}
	if got := sudoFailureText("Sorry, try again.\nsudo: 1 incorrect password attempt\n", errors.New("exit 1")); got != "the password was not accepted" {
		t.Errorf("got %q", got)
	}
	if got := sudoFailureText("   \n", errors.New("Process exited with status 1")); got != "Process exited with status 1" {
		t.Errorf("got %q", got)
	}
}
