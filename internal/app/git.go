package app

import (
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type Git struct{}

func NewGit() *Git { return &Git{} }

// Preserve whitespace: porcelain -z paths can contain spaces and newlines.
func gitRun(dir string, args ...string) (string, error) {
	if dir == "" {
		return "", nil
	}
	if _, err := exec.LookPath("git"); err != nil {
		return "", nil
	}
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	hideProcessWindow(cmd)
	out, err := cmd.Output()
	if _, ok := err.(*exec.ExitError); ok {
		return "", nil // not a repository / no commits yet
	}
	return string(out), err
}

func (Git) Branch(dir string) (string, error) {
	branch, err := gitRun(dir, "branch", "--show-current")
	return strings.TrimSpace(branch), err
}

type GitEntry struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

func parseGitStatus(root, output string) []GitEntry {
	entries := []GitEntry{}
	parts := strings.Split(output, "\x00")
	for i := 0; i < len(parts); i++ {
		p := parts[i]
		if len(p) < 4 {
			continue
		}
		status := p[0]
		if p[1] != ' ' && p[1] != '?' {
			status = p[1]
		}
		if status == '?' {
			status = 'A'
		}
		entries = append(entries, GitEntry{filepath.Join(root, p[3:]), string(status)})
		// -z emits destination first, followed by the old path for renames/copies.
		if strings.ContainsAny(p[:2], "RC") {
			i++
		}
	}
	return entries
}

func (Git) Status(dir string) ([]GitEntry, error) {
	root, err := gitRun(dir, "rev-parse", "--show-toplevel")
	if err != nil || strings.TrimSpace(root) == "" {
		return []GitEntry{}, err
	}
	output, err := gitRun(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	return parseGitStatus(strings.TrimSpace(root), output), err
}

type GitDiff struct {
	Added   int `json:"added"`
	Removed int `json:"removed"`
}

func parseGitDiff(output string) GitDiff {
	var diff GitDiff
	for _, line := range strings.Split(output, "\n") {
		fields := strings.SplitN(line, "\t", 3)
		if len(fields) != 3 {
			continue
		}
		added, _ := strconv.Atoi(fields[0])
		removed, _ := strconv.Atoi(fields[1])
		diff.Added += added
		diff.Removed += removed
	}
	return diff
}

func (Git) DiffStat(dir string) (GitDiff, error) {
	output, err := gitRun(dir, "diff", "--numstat")
	return parseGitDiff(output), err
}
