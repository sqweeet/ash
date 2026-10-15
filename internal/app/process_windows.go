//go:build windows

package app

import (
	"os/exec"
	"syscall"
)

func hideProcessWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
