//go:build windows

package app

import (
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

const colorProbeDA = "\x1b[?1;2c"

func colorProbeExchange() (string, string) {
	query := "\x1b]10;?\a\x1b]11;?\a"
	reply := "\x1b]10;rgb:eded/eded/eded\x1b\\\x1b]11;rgb:0606/0606/0606\x1b\\"
	for i := 0; i < 16; i++ {
		query += fmt.Sprintf("\x1b]4;%d;?\a", i)
		reply += fmt.Sprintf("\x1b]4;%d;rgb:3f3f/d6d6/8f8f\x1b\\", i)
	}
	return query + "\x1b[c", reply + colorProbeDA
}

func TestPtyColorQueryHelper(t *testing.T) {
	if os.Args[len(os.Args)-1] != "ash-pty-color-helper" {
		return
	}
	in, out := windows.Handle(os.Stdin.Fd()), windows.Handle(os.Stdout.Fd())
	var inMode, outMode uint32
	if err := windows.GetConsoleMode(out, &outMode); err != nil {
		t.Fatal(err)
	}
	if err := windows.SetConsoleMode(out, outMode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING); err != nil {
		t.Fatal(err)
	}
	// Pi requests fullscreen/mouse before enabling raw input. Both those modes
	// and the later color queries must reach the actual terminal unchanged.
	fmt.Print("\x1b[?1049h\x1b[?1000h\x1b[?1006h")
	if err := windows.GetConsoleMode(in, &inMode); err != nil {
		t.Fatal(err)
	}
	mode := inMode & ^uint32(windows.ENABLE_LINE_INPUT|windows.ENABLE_ECHO_INPUT|windows.ENABLE_PROCESSED_INPUT)
	if err := windows.SetConsoleMode(in, mode|windows.ENABLE_VIRTUAL_TERMINAL_INPUT); err != nil {
		t.Fatal(err)
	}
	query, reply := colorProbeExchange()
	fmt.Print("ASH_COLOR_READY" + query)
	buf := make([]byte, len(reply))
	if _, err := io.ReadFull(os.Stdin, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != reply {
		t.Fatalf("terminal replies changed or arrived out of order: %q", buf)
	}
	fmt.Print("\r\nASH_COLOR_OK\r\n")
	os.Exit(0)
}

func TestConPtyPreservesTerminalColorExchange(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	proc, err := openConPTY(t.TempDir(), 120, 24, exe, []string{"-test.run=^TestPtyColorQueryHelper$", "--", "ash-pty-color-helper"})
	if err != nil {
		t.Fatal(err)
	}
	defer proc.Close()
	query, reply := colorProbeExchange()
	queried := make(chan struct{})
	exited := make(chan string, 1)
	go func() {
		var output strings.Builder
		buf := make([]byte, 4096)
		hostAnswered, signaled := false, false
		for {
			n, err := proc.Read(buf)
			output.Write(buf[:n])
			text := output.String()
			if !hostAnswered {
				da, marker := strings.Index(text, "\x1b[c"), strings.Index(text, "ASH_COLOR_READY")
				if da >= 0 && (marker < 0 || da < marker) {
					// Answer the host's own startup query, before the application's.
					proc.Write([]byte(colorProbeDA))
					hostAnswered = true
				}
			}
			if !signaled && strings.Contains(text, query) {
				close(queried)
				signaled = true
			}
			if err != nil {
				exited <- text
				return
			}
		}
	}()
	select {
	case <-queried:
	case text := <-exited:
		t.Fatalf("child exited before forwarding its color queries: %q", text)
	case <-time.After(8 * time.Second):
		t.Fatal("ConPTY dropped OSC 10/11, palette queries, or the final DA query")
	}
	if _, err := proc.Write([]byte(reply)); err != nil {
		t.Fatal(err)
	}
	select {
	case text := <-exited:
		if !strings.Contains(text, "ASH_COLOR_OK") {
			t.Fatalf("child did not receive the complete color replies before DA: %q", text)
		}
		if !strings.Contains(text, "\x1b[?1000h") || !strings.Contains(text, "\x1b[?1006h") {
			t.Fatal("ConPTY dropped mouse setup before raw mode")
		}
	case <-time.After(8 * time.Second):
		t.Fatal("ConPTY dropped terminal replies or failed to signal process exit")
	}
}

func TestConPtyExitClosesOutputPipe(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	proc, err := openConPTY(t.TempDir(), 120, 24, exe, []string{"-test.run=^TestPtyEnvironmentHelper$", "--", "ash-pty-env-helper"})
	if err != nil {
		t.Fatal(err)
	}
	defer proc.Close()
	exited := make(chan string, 1)
	go func() { data, _ := io.ReadAll(proc); exited <- string(data) }()
	select {
	case text := <-exited:
		if !strings.Contains(text, "ASH_PTY_ENV:xterm-256color|truecolor:END") {
			t.Fatalf("lost final process output: %q", text)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("child exited but ConPTY kept its output pipe alive")
	}
	if err := proc.Close(); err != nil {
		t.Fatal(err)
	}
	if err := proc.Close(); err != nil {
		t.Fatal("close must be idempotent:", err)
	}
	if err := proc.resize(80, 24); err == nil {
		t.Fatal("resize after close must not use a released HPCON")
	}
}
