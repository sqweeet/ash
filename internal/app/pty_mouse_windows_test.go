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

const mouseProbeInput = "\x1b[<64;13;6M\x1b[<73;13;6M"

func TestPtyMouseInputHelper(t *testing.T) {
	if os.Args[len(os.Args)-1] != "ash-pty-mouse-helper" {
		return
	}
	in, out := windows.Handle(os.Stdin.Fd()), windows.Handle(os.Stdout.Fd())
	var inMode, outMode uint32
	if err := windows.GetConsoleMode(in, &inMode); err != nil {
		t.Fatal(err)
	}
	if err := windows.GetConsoleMode(out, &outMode); err != nil {
		t.Fatal(err)
	}
	if err := windows.SetConsoleMode(out, outMode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING); err != nil {
		t.Fatal(err)
	}
	// Mirror Pi's startup order: fullscreen + mouse setup precedes raw input.
	// Legacy ConPTY may swallow this setup, but SGR input must still reach the
	// TUI unchanged. Newer hosts may preserve it and use xterm's native path.
	fmt.Print("\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h")
	rawMode := inMode & ^uint32(windows.ENABLE_LINE_INPUT|windows.ENABLE_ECHO_INPUT|windows.ENABLE_PROCESSED_INPUT)
	if err := windows.SetConsoleMode(in, rawMode|windows.ENABLE_VIRTUAL_TERMINAL_INPUT); err != nil {
		t.Fatal(err)
	}
	fmt.Print("ASH_MOUSE_READY")
	buf := make([]byte, len(mouseProbeInput))
	if _, err := io.ReadFull(os.Stdin, buf); err != nil {
		t.Fatal(err)
	}
	fmt.Printf("\r\nASH_MOUSE_INPUT:%x:END\r\n", buf)
	os.Exit(0)
}

func TestConPtyPreservesFullscreenMouseInput(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	proc, err := openConPTY(t.TempDir(), 120, 24, exe, []string{"-test.run=^TestPtyMouseInputHelper$", "--", "ash-pty-mouse-helper"})
	if err != nil {
		t.Fatal(err)
	}
	defer proc.Close()
	ready := make(chan struct{})
	output := make(chan string, 1)
	go func() {
		var text strings.Builder
		buf := make([]byte, 4096)
		signaled := false
		for {
			n, err := proc.Read(buf)
			text.Write(buf[:n])
			if !signaled && strings.Contains(text.String(), "ASH_MOUSE_READY") {
				close(ready)
				signaled = true
			}
			if err != nil || strings.Contains(text.String(), ":END") {
				output <- text.String()
				return
			}
		}
	}()
	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("mouse test child did not enter raw mode")
	}
	if _, err := proc.Write([]byte(mouseProbeInput)); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-output:
		want := fmt.Sprintf("ASH_MOUSE_INPUT:%x:END", mouseProbeInput)
		if !strings.Contains(got, want) {
			t.Fatalf("mouse reports changed in transit: %q", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("mouse reports did not reach the fullscreen child")
	}
}
