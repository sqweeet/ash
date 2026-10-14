//go:build !windows

package app

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"
)

// Non-Windows stub: real ConPTY is Windows-only (matches Ash's backend
// constraint). On mac/linux `wails dev` still runs for UI work — this gives a
// plain pipe-backed PTY so xterm.js can show *something* without the Windows
// API. Not for production.
type ptyProc struct {
	proc *exec.Cmd
	in   io.WriteCloser
	out  io.ReadCloser
}

func platformPtyInfo() PtyInfo { return PtyInfo{} }

func (p *ptyProc) Read(buf []byte) (int, error) { return p.out.Read(buf) }
func (p *ptyProc) Write(b []byte) (int, error)  { return p.in.Write(b) }

// pid returns the root shell's OS process id. Used on non-Windows only for
// shape parity — foreground-agent detection is Windows-only for now.
func (p *ptyProc) pid() int {
	if p.proc != nil && p.proc.Process != nil {
		return p.proc.Process.Pid
	}
	return 0
}

func openConPTY(cwd string, cols, rows uint16, program string, args []string) (*ptyProc, error) {
	shell := "bash"
	if program != "" {
		shell = program
	} else if p, err := exec.LookPath("zsh"); err == nil {
		shell = p
	}
	cmd := exec.Command(shell, args...)
	// Same default as Windows: never inherit the app launch dir; empty/bad cwd → home.
	if cwd != "" {
		if info, err := os.Stat(cwd); err == nil && info.IsDir() {
			cmd.Dir = cwd
		}
	}
	if cmd.Dir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			cmd.Dir = home
		}
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{}

	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start shell: %w", err)
	}
	return &ptyProc{proc: cmd, in: in, out: out}, nil
}

func (p *ptyProc) resize(cols, rows uint16) error { return nil } // TIOCSWINSZ omitted for the stub

func (p *ptyProc) Close() error {
	if p.in != nil {
		p.in.Close()
	}
	if p.out != nil {
		p.out.Close()
	}
	return nil
}

func isPipeClosed(err error) bool { return err == io.EOF }
