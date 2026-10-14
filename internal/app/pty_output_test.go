package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestPtyOutputPreservesSplitUTF8AndTerminalControls(t *testing.T) {
	want := "\x1b[?2026h\x1b[?25lПривет ┌─┐ 🚀 e\u0301\x1b[5;10H\x1b[?25h\x1b[?2026l"
	data := []byte(want)
	for size := 1; size <= len(data); size++ {
		var decoder ptyOutputDecoder
		var got strings.Builder
		for start := 0; start < len(data); start += size {
			text := decoder.decode(data[start:min(start+size, len(data))])
			if !utf8.ValidString(text) {
				t.Fatalf("chunk size %d emitted invalid JSON text %q", size, text)
			}
			got.WriteString(text)
		}
		got.WriteString(decoder.flush())
		if got.String() != want {
			t.Fatalf("chunk size %d: got %q, want %q", size, got.String(), want)
		}
	}
}

func TestPtyOutputHandlesInvalidAndUnfinishedUTF8(t *testing.T) {
	var decoder ptyOutputDecoder
	if got := decoder.decode([]byte{'a', 0xf0, 0x9f}); got != "a" {
		t.Fatalf("incomplete rune must wait: %q", got)
	}
	if got := decoder.flush(); got != "\uFFFD" {
		t.Fatalf("EOF must flush incomplete rune: %q", got)
	}
	if got := decoder.flush(); got != "" {
		t.Fatalf("EOF emitted twice: %q", got)
	}
	if got := decoder.decode([]byte{0xff, '\x1b', '[', 'H'}); got != "\uFFFD\x1b[H" {
		t.Fatalf("invalid input damaged terminal control: %q", got)
	}
}
