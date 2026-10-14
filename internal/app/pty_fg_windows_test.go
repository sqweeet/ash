//go:build windows

package app

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestProcessCwdReadsAnotherProcessWorkingFolder(t *testing.T) {
	dir := t.TempDir()
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 10")
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		t.Fatalf("start child: %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	got := processCwd(uint32(cmd.Process.Pid))
	if !strings.EqualFold(filepath.Clean(got), filepath.Clean(dir)) {
		t.Fatalf("processCwd() = %q, want %q", got, dir)
	}
	if strings.HasSuffix(got, `\`) {
		t.Fatalf("processCwd() = %q, want no trailing backslash", got)
	}
}

func TestProcessCwdOfMissingProcessIsEmpty(t *testing.T) {
	// PIDs are multiples of 4 on Windows, so an odd one never exists.
	if got := processCwd(0xFFFFFFF1); got != "" {
		t.Fatalf("processCwd(missing) = %q, want empty", got)
	}
}
