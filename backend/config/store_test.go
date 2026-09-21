package config

import (
	"reflect"
	"testing"
)

func TestReorderByID(t *testing.T) {
	type item struct{ ID string }
	id := func(i item) string { return i.ID }
	items := []item{{"a"}, {"b"}, {"c"}, {"d"}}

	// The listed ids lead in the order given; the rest follow in the
	// order they had.
	got := ReorderByID(items, []string{"c", "a"}, id)
	want := []item{{"c"}, {"a"}, {"b"}, {"d"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if !reflect.DeepEqual(items, []item{{"a"}, {"b"}, {"c"}, {"d"}}) {
		t.Fatalf("the input was changed: %v", items)
	}

	// An unknown id is ignored and a repeated one counts once.
	got = ReorderByID(items, []string{"zzz", "b", "b", "a"}, id)
	want = []item{{"b"}, {"a"}, {"c"}, {"d"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}

	if got := ReorderByID([]item{}, []string{"a"}, id); len(got) != 0 {
		t.Fatalf("an empty list came back as %v", got)
	}
}
