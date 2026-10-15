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

func TestPtyRecognizesClosedWindowsPipes(t *testing.T) {
	for _, err := range []error{
		io.EOF, os.ErrClosed, windows.ERROR_BROKEN_PIPE,
		windows.ERROR_PIPE_NOT_CONNECTED, windows.ERROR_NO_DATA, windows.ERROR_INVALID_HANDLE,
	} {
		if !isPipeClosed(fmt.Errorf("read pty: %w", err)) {
			t.Fatalf("closed pipe would loop forever: %v", err)
		}
	}
	if isPipeClosed(windows.ERROR_IO_PENDING) {
		t.Fatal("transient error must not close a session")
	}
}

func TestPtyReportsActualWindowsBuild(t *testing.T) {
	info := NewPty().PtyBackend()
	if info.Backend != "conpty" || info.BuildNumber != windows.RtlGetVersion().BuildNumber {
		t.Fatalf("wrong xterm compatibility information: %+v", info)
	}
}

func TestPtyEnvironmentOverridesLauncherTerminal(t *testing.T) {
	inherited := []string{"Path=C:\\tools", "TERM=dumb", "term=vt100", "Colorterm=old", "KEEP=value=with=equals", "=C:=C:\\work"}
	got := ptyEnvironment(inherited)
	want := []string{"Path=C:\\tools", "KEEP=value=with=equals", "=C:=C:\\work", "TERM=xterm-256color", "COLORTERM=truecolor", "PI_PROGRAM_STATUS=1"}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("unexpected child environment: %q", got)
	}
	if inherited[1] != "TERM=dumb" || inherited[2] != "term=vt100" {
		t.Fatal("must not mutate the launcher's environment")
	}
}

func TestPtyEnvironmentKeepsUsersPiProgramStatus(t *testing.T) {
	got := ptyEnvironment([]string{"Path=C:\\tools", "pi_program_status=0"})
	want := []string{"Path=C:\\tools", "pi_program_status=0", "TERM=xterm-256color", "COLORTERM=truecolor"}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("overrode the user's PI_PROGRAM_STATUS: %q", got)
	}
}

func TestPtyEnvironmentHelper(t *testing.T) {
	if os.Args[len(os.Args)-1] != "ash-pty-env-helper" {
		return
	}
	fmt.Fprintf(os.Stdout, "ASH_PTY_ENV:%s|%s:END\r\n", os.Getenv("TERM"), os.Getenv("COLORTERM"))
	os.Exit(0)
}

func TestConPtyChildDoesNotInheritDumbTerminal(t *testing.T) {
	t.Setenv("TERM", "dumb")
	t.Setenv("COLORTERM", "old")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	proc, err := openConPTY(t.TempDir(), 120, 24, exe, []string{"-test.run=^TestPtyEnvironmentHelper$", "--", "ash-pty-env-helper"})
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
		if !strings.Contains(got, "ASH_PTY_ENV:xterm-256color|truecolor:END") {
			t.Fatalf("wrong environment in the real ConPTY child: %q", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ConPTY child did not report its environment")
	}
	if os.Getenv("TERM") != "dumb" {
		t.Fatal("starting a terminal changed the parent environment")
	}
}
