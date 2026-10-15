//go:build windows

package app

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/sys/windows"
)

type Tools struct{}

func NewTools() *Tools { return &Tools{} }

// ctx is stashed on startup so dialog/clipboard helpers can call Wails runtime
// (OpenFileDialog, MessageDialog, ClipboardGetText/SetText).
var toolsCtx context.Context

// DetectBins returns the subset of `names` that exist on PATH. Always returns
// a non-nil slice (empty = []); a nil slice would serialize to JSON `null` in
// Wails and crash the frontend's .map.
func (Tools) DetectBins(names []string) []string {
	out := []string{}
	for _, n := range names {
		if _, err := exec.LookPath(n); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// SshHosts parses Host entries from ~/.ssh/config (Windows: USERPROFILE).
// Wildcard/negated hosts are excluded — only concrete hostnames.
func (Tools) SshHosts() []string {
	home := os.Getenv("USERPROFILE")
	if home == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			return []string{}
		}
		home = h
	}
	b, err := os.ReadFile(filepath.Join(home, ".ssh", "config"))
	if err != nil {
		return []string{}
	}
	// Always return a non-nil slice (empty = []); nil would serialize to JSON
	// `null` in Wails and crash the frontend's .map.
	hosts := []string{}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		if !strings.HasPrefix(lower, "host ") {
			continue
		}
		rest := strings.TrimSpace(line[5:])
		for _, h := range strings.Fields(rest) {
			if !strings.ContainsAny(h, "*?!") {
				hosts = append(hosts, h)
			}
		}
	}
	sort.Strings(hosts)
	// dedup into a non-nil slice (empty = [] not null).
	out := []string{}
	for i, h := range hosts {
		if i == 0 || h != hosts[i-1] {
			out = append(out, h)
		}
	}
	return out
}

// OpenPath uses the file's default Windows association, without a command shell.
func (Tools) OpenPath(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(abs)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, nil, file, nil, nil, windows.SW_SHOWNORMAL)
}

// OpenIn launches an external app for a path: "explorer" reveals/opens it,
// or an editor CLI on PATH opens the file.
func (Tools) OpenIn(app, path string, isDir bool) error {
	if app == "explorer" {
		if isDir {
			return exec.Command("explorer.exe", path).Start()
		}
		return exec.Command("explorer.exe", "/select,"+path).Start()
	}
	if exe, err := exec.LookPath(app); err == nil {
		if strings.HasSuffix(strings.ToLower(exe), ".exe") {
			return exec.Command(exe, path).Start()
		}
		return exec.Command("cmd", "/c", exe, path).Start()
	}
	return fmt.Errorf("editor not found: %s", app)
}
