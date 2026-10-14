package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLinkedWorktreeFromGitFiles(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "ash")
	admin := filepath.Join(repo, ".git", "worktrees", "sidebar")
	wt := filepath.Join(repo, ".claude", "worktrees", "sidebar")
	writeFile(t, filepath.Join(repo, ".git", "HEAD"), "ref: refs/heads/main\n")
	writeFile(t, filepath.Join(admin, "HEAD"), "ref: refs/heads/feat/sidebar\n")
	writeFile(t, filepath.Join(admin, "commondir"), "../..\n")
	writeFile(t, filepath.Join(wt, ".git"), "gitdir: "+filepath.ToSlash(admin)+"\n")
	writeFile(t, filepath.Join(wt, "src", "x.ts"), "")

	if got := linkedWorktree(repo); got != nil {
		t.Fatalf("main checkout = %+v, want nil", got)
	}
	for _, dir := range []string{wt, filepath.Join(wt, "src")} {
		got := linkedWorktree(dir)
		if got == nil || got.Name != "sidebar" || got.Branch != "feat/sidebar" || got.Repo != repo {
			t.Fatalf("linkedWorktree(%s) = %+v, want sidebar on feat/sidebar in %s", dir, got, repo)
		}
	}

	writeFile(t, filepath.Join(admin, "HEAD"), "3e5f4389a0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5\n")
	if got := linkedWorktree(wt); got == nil || got.Branch != "" {
		t.Fatalf("detached worktree = %+v, want empty branch", got)
	}

	// Submodules also have a .git file, but it points into .git/modules.
	sub := filepath.Join(repo, "vendor", "lib")
	writeFile(t, filepath.Join(sub, ".git"), "gitdir: ../../.git/modules/lib\n")
	if got := linkedWorktree(sub); got != nil {
		t.Fatalf("submodule = %+v, want nil", got)
	}
	if got := linkedWorktree(filepath.Join(root, "elsewhere")); got != nil {
		t.Fatalf("outside a repo = %+v, want nil", got)
	}
}

func TestLinkedWorktreeMatchesRealGit(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	run := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
		}
	}
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	run(repo, "init", "-q")
	run(repo, "commit", "-q", "--allow-empty", "-m", "init")
	wt := filepath.Join(root, "repo-feature")
	run(repo, "worktree", "add", "-q", "-b", "feature", wt)

	// git records the long path; TMP may be an 8.3 short one (RUNNER~1 on
	// CI), so compare resolved paths.
	resolve := func(p string) string {
		r, err := filepath.EvalSymlinks(p)
		if err != nil {
			t.Fatalf("resolve %s: %v", p, err)
		}
		return r
	}
	got := linkedWorktree(wt)
	if got == nil || got.Name != "repo-feature" || got.Branch != "feature" || !strings.EqualFold(resolve(got.Repo), resolve(repo)) {
		t.Fatalf("linkedWorktree() = %+v, want repo-feature on feature in %s", got, repo)
	}
	if got := linkedWorktree(repo); got != nil {
		t.Fatalf("main checkout = %+v, want nil", got)
	}
}
