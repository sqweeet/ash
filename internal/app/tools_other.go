//go:build !windows

package app

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// Non-Windows stub of the tools backend. Full parity isn't needed for `wails
// dev` UI work on mac/linux — these return sensible values so the frontend
// doesn't error. ConPTY / explorer.exe / Windows env vars are Windows-only
// (AGENTS.md); real production is Windows.

type Tools struct{}

func NewTools() *Tools { return &Tools{} }

var toolsCtx context.Context

func (Tools) DetectBins(names []string) []string {
	out := []string{}
	for _, n := range names {
		if _, err := exec.LookPath(n); err == nil {
			out = append(out, n)
		}
	}
	return out
}

func (Tools) SshHosts() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return []string{}
	}
	b, err := os.ReadFile(filepath.Join(home, ".ssh", "config"))
	if err != nil {
		return []string{}
	}
	hosts := []string{}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(strings.ToLower(line), "host ") {
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
	out := []string{}
	for i, h := range hosts {
		if i == 0 || h != hosts[i-1] {
			out = append(out, h)
		}
	}
	return out
}

func (Tools) OpenPath(path string) error {
	for _, name := range []string{"xdg-open", "open"} {
		if exe, err := exec.LookPath(name); err == nil {
			return exec.Command(exe, path).Start()
		}
	}
	return fmt.Errorf("no system opener")
}

func (Tools) OpenIn(app, path string, isDir bool) error {
	if app == "explorer" {
		// no explorer on mac/linux; open the parent dir with the platform opener
		if opener, err := exec.LookPath("open"); err == nil {
			return exec.Command(opener, path).Start()
		}
		return fmt.Errorf("no opener")
	}
	if _, err := exec.LookPath(app); err == nil {
		return exec.Command(app, path).Start()
	}
	return fmt.Errorf("editor not found: %s", app)
}
