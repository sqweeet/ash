//go:build windows

package app

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// The sidebar's "agent is working" state comes from status sequences the CLI
// agents print: Pi's OSC 7501 program status and OSC 9;4 progress. They only
// reach xterm if the bundled ConPTY passes them through untouched.
func TestPtyAgentStatusHelper(t *testing.T) {
	if os.Args[len(os.Args)-1] != "ash-pty-status-helper" {
		return
	}
	out := windows.Handle(os.Stdout.Fd())
	var mode uint32
	if windows.GetConsoleMode(out, &mode) == nil {
		windows.SetConsoleMode(out, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING)
	}
	fmt.Fprintf(os.Stdout, "ASH_STATUS:%s|\x1b]7501;state=working:app=pi\x1b\\|\x1b]9;4;3\x07|:END\r\n", os.Getenv("PI_PROGRAM_STATUS"))
	os.Exit(0)
}

func TestConPtyPassesAgentStatusThrough(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	proc, err := openConPTY(t.TempDir(), 120, 24, exe, []string{"-test.run=^TestPtyAgentStatusHelper$", "--", "ash-pty-status-helper"})
	if err != nil {
		t.Fatal(err)
	}
	defer proc.Close()
	output := make(chan string, 1)
	go func() {
		var text strings.Builder
		buf := make([]byte, 4096)
		for {
			n, err := proc.Read(buf)
			text.Write(buf[:n])
			if err != nil || strings.Contains(text.String(), ":END") {
				output <- text.String()
				return
			}
		}
	}()
	select {
	case got := <-output:
		for _, want := range []string{"ASH_STATUS:1|", "\x1b]7501;state=working:app=pi\x1b\\", "\x1b]9;4;3\x07"} {
			if !strings.Contains(got, want) {
				t.Fatalf("missing %q in the real ConPTY output: %q", want, got)
			}
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ConPTY child did not report its status")
	}
}
