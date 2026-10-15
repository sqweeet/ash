package app

import (
	"os"
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

// GitWorktree is a linked worktree (`git worktree add`, Claude Code's
// .claude/worktrees, …) that a folder belongs to.
type GitWorktree struct {
	// Name is the worktree's admin name (.git/worktrees/<name>).
	Name string `json:"name"`
	// Branch is the checked-out branch; "" when HEAD is detached.
	Branch string `json:"branch"`
	// Repo is the main checkout the worktree was created from.
	Repo string `json:"repo"`
}

// linkedWorktree returns the linked worktree containing dir, or nil when dir
// is in a main checkout or outside any repo. It reads the .git file and HEAD
// directly instead of spawning git: the CLI-agent poll calls it every 2s.
func linkedWorktree(dir string) *GitWorktree {
	if dir == "" {
		return nil
	}
	for d := filepath.Clean(dir); ; {
		info, err := os.Lstat(filepath.Join(d, ".git"))
		if err == nil {
			if info.IsDir() {
				return nil // main checkout
			}
			return worktreeFromGitFile(d)
		}
		parent := filepath.Dir(d)
		if parent == d {
			return nil
		}
		d = parent
	}
}

// worktreeFromGitFile resolves a checkout whose .git is a "gitdir: …" file.
// Submodules use the same file but point into .git/modules, so only a gitdir
// under a "worktrees" folder counts.
func worktreeFromGitFile(top string) *GitWorktree {
	raw, err := os.ReadFile(filepath.Join(top, ".git"))
	if err != nil {
		return nil
	}
	gitdir, ok := strings.CutPrefix(strings.TrimSpace(string(raw)), "gitdir:")
	if !ok {
		return nil
	}
	gitdir = filepath.FromSlash(strings.TrimSpace(gitdir))
	if !filepath.IsAbs(gitdir) {
		gitdir = filepath.Join(top, gitdir)
	}
	gitdir = filepath.Clean(gitdir)
	if !strings.EqualFold(filepath.Base(filepath.Dir(gitdir)), "worktrees") {
		return nil
	}

	wt := &GitWorktree{Name: filepath.Base(gitdir)}
	// HEAD is "ref: refs/heads/<branch>" on a branch, a bare commit id when detached.
	if head, err := os.ReadFile(filepath.Join(gitdir, "HEAD")); err == nil {
		if b, ok := strings.CutPrefix(strings.TrimSpace(string(head)), "ref: refs/heads/"); ok {
			wt.Branch = b
		}
	}
	// commondir points at the shared .git ("../.."); fall back to the layout
	// git always uses: <repo>/.git/worktrees/<name>.
	common := filepath.Dir(filepath.Dir(gitdir))
	if c, err := os.ReadFile(filepath.Join(gitdir, "commondir")); err == nil {
		p := filepath.FromSlash(strings.TrimSpace(string(c)))
		if !filepath.IsAbs(p) {
			p = filepath.Join(gitdir, p)
		}
		common = filepath.Clean(p)
	}
	wt.Repo = common
	if strings.EqualFold(filepath.Base(common), ".git") {
		wt.Repo = filepath.Dir(common) // a bare repo has no checkout to strip to
	}
	return wt
}
