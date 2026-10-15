//go:build !windows

package app

import "os/exec"

func hideProcessWindow(_ *exec.Cmd) {}
