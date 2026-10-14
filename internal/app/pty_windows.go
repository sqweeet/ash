//go:build windows

package app

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"ash-wails/internal/conpty"
	"golang.org/x/sys/windows"
)

// ptyProc wraps one Windows ConPTY session.
type ptyProc struct {
	proc      *conpty.Session
	closeOnce sync.Once
	closeErr  error
}

func platformPtyInfo() PtyInfo {
	return PtyInfo{Backend: "conpty", BuildNumber: windows.RtlGetVersion().BuildNumber}
}

// Ash hosts xterm regardless of which terminal (or automation) launched it.
// In particular, never forward a launcher's TERM=dumb to interactive shells.
// Build a child-only environment so commands outside the PTY are unaffected.
func ptyEnvironment(inherited []string) []string {
	env := make([]string, 0, len(inherited)+2)
	for _, entry := range inherited {
		key, _, _ := strings.Cut(entry, "=")
		if strings.EqualFold(key, "TERM") || strings.EqualFold(key, "COLORTERM") {
			continue
		}
		env = append(env, entry)
	}
	return append(env, "TERM=xterm-256color", "COLORTERM=truecolor")
}

func (p *ptyProc) Read(buf []byte) (int, error) { return p.proc.Read(buf) }
func (p *ptyProc) Write(b []byte) (int, error)  { return p.proc.Write(b) }

// pid returns the root shell's OS process id — the anchor for walking the
// process tree to find the foreground agent (claude.exe / agy.exe / …)
// currently driving this ConPTY.
func (p *ptyProc) pid() int {
	if p.proc != nil {
		return p.proc.Pid()
	}
	return 0
}

// resolveWorkDir mirrors Ash's pty_spawn: a real directory wins, otherwise
// fall back to the user's home. Never inherit the app's launch dir (e.g.
// C:\Program Files\Ash) — New Terminal should open in ~, not the install folder.
func resolveWorkDir(cwd string) string {
	if cwd != "" {
		if info, err := os.Stat(cwd); err == nil && info.IsDir() {
			return cwd
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	return cwd
}

func openConPTY(cwd string, cols, rows uint16, program string, args []string) (*ptyProc, error) {
	// Caller-supplied program wins (agent may spawn a specific shell); else
	// auto-detect pwsh/powershell/cmd (matches Ash's Windows-shell assumption).
	var cmdLine string
	if program != "" {
		cmdLine = "\"" + program + "\""
		for _, a := range args {
			cmdLine += " \"" + a + "\""
		}
	} else {
		shell := findShell()
		cmdLine = "\"" + shell[0] + "\""
	}
	workDir := resolveWorkDir(cwd)
	c, err := conpty.Start(conpty.Options{
		CommandLine: cmdLine,
		Directory:   workDir,
		Environment: ptyEnvironment(os.Environ()),
		Columns:     cols,
		Rows:        rows,
	})
	if err != nil {
		return nil, fmt.Errorf("conpty start: %w", err)
	}
	return &ptyProc{proc: c}, nil
}

func (p *ptyProc) resize(cols, rows uint16) error {
	return p.proc.Resize(cols, rows)
}

func (p *ptyProc) Close() error {
	p.closeOnce.Do(func() {
		if p.proc != nil {
			p.closeErr = p.proc.Close()
		}
	})
	return p.closeErr
}

func isPipeClosed(err error) bool {
	return errors.Is(err, io.EOF) || errors.Is(err, os.ErrClosed) ||
		errors.Is(err, windows.ERROR_BROKEN_PIPE) ||
		errors.Is(err, windows.ERROR_PIPE_NOT_CONNECTED) ||
		errors.Is(err, windows.ERROR_NO_DATA) ||
		errors.Is(err, windows.ERROR_INVALID_HANDLE)
}

func findShell() []string {
	// pwsh preferred, powershell fallback, cmd last resort — matches Ash's
	// Windows-shell assumption (AGENTS.md). LookPath works once ensureSystemPath
	// has patched PATH at startup; the absolute-path fallbacks guard against a
	// still-broken PATH so we never end up with a bare "cmd.exe" that can't be
	// spawned.
	for _, name := range []string{"pwsh", "powershell", "cmd"} {
		if path, err := exec.LookPath(name); err == nil {
			return []string{path}
		}
	}
	windir := os.Getenv("windir")
	if windir == "" {
		windir = os.Getenv("SystemRoot")
	}
	if windir == "" {
		windir = `C:\Windows`
	}
	candidates := []string{
		`C:\Program Files\PowerShell\7\pwsh.exe`,
		filepath.Join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
		filepath.Join(windir, "System32", "cmd.exe"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return []string{c}
		}
	}
	return []string{"cmd.exe"}
}
