package app

import (
	"strings"
	"unicode/utf8"
)

// A pipe read may end in the middle of a UTF-8 character. Encoding that read
// directly as a JSON string would replace each half before xterm sees it.
type ptyOutputDecoder struct {
	pending []byte
}

func (d *ptyOutputDecoder) decode(data []byte) string {
	d.pending = append(d.pending, data...)
	end := len(d.pending)
	start := end - 1
	for start >= 0 && !utf8.RuneStart(d.pending[start]) {
		start--
	}
	if start >= 0 && !utf8.FullRune(d.pending[start:]) {
		end = start
	}
	text := strings.ToValidUTF8(string(d.pending[:end]), "\uFFFD")
	d.pending = append(d.pending[:0], d.pending[end:]...)
	return text
}

func (d *ptyOutputDecoder) flush() string {
	text := strings.ToValidUTF8(string(d.pending), "\uFFFD")
	d.pending = nil
	return text
}
