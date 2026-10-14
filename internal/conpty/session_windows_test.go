//go:build windows

package conpty

import (
	"io"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"golang.org/x/sys/windows"
)

func TestEnvironmentBlockIsUnicodeSortedAndTerminated(t *testing.T) {
	env := []string{"Z=last", "name=Привет 😀", "A=value=with=equals", "=C:=C:\\work"}
	block, err := environmentBlock(env)
	if err != nil {
		t.Fatal(err)
	}
	want := "=C:=C:\\work\x00A=value=with=equals\x00name=Привет 😀\x00Z=last\x00\x00"
	if got := string(utf16.Decode(block)); got != want {
		t.Fatalf("wrong Windows environment block: %q", got)
	}
	if env[0] != "Z=last" {
		t.Fatal("must not mutate the caller's environment")
	}
	if block, err := environmentBlock(nil); err != nil || block != nil {
		t.Fatal("nil must inherit the parent environment")
	}
	if block, err := environmentBlock([]string{}); err != nil || len(block) != 2 || block[0] != 0 || block[1] != 0 {
		t.Fatal("empty environment must be double-NUL terminated")
	}
	if _, err := environmentBlock([]string{"A=before\x00B=after"}); err == nil {
		t.Fatal("embedded NUL must not create extra environment entries")
	}
}

func TestCloseUnblocksReaderWhileChildIsRunning(t *testing.T) {
	cmd, err := exec.LookPath("cmd.exe")
	if err != nil {
		t.Fatal(err)
	}
	proc, err := Start(Options{
		CommandLine: windows.EscapeArg(cmd) + ` /d /q /c "pause >nul"`,
		Directory:   t.TempDir(), Columns: 80, Rows: 24,
	})
	if err != nil {
		t.Fatal(err)
	}
	readDone := make(chan struct{})
	go func() { io.Copy(io.Discard, proc); close(readDone) }()
	time.Sleep(30 * time.Millisecond)
	closed := make(chan error, 1)
	go func() { closed <- proc.Close() }()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		if child, err := os.FindProcess(proc.Pid()); err == nil {
			child.Kill()
		}
		t.Fatal("close blocked on a running console client")
	}
	select {
	case <-readDone:
	case <-time.After(5 * time.Second):
		t.Fatal("close did not unblock the output reader")
	}
	if err := proc.Close(); err != nil {
		t.Fatal("repeated close must be safe:", err)
	}
}

func TestInvalidDimensionsDoNotStartAProcess(t *testing.T) {
	for _, dims := range [][2]uint16{{0, 24}, {80, 0}, {32768, 24}, {80, 65535}} {
		_, err := Start(Options{Columns: dims[0], Rows: dims[1]})
		if err == nil || !strings.Contains(err.Error(), "dimensions") {
			t.Fatalf("accepted dimensions %v: %v", dims, err)
		}
	}
}
