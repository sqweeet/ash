//go:build !windows

package app

// ForegroundProcess mirrors the Windows type for shape parity; on non-Windows
// foreground-agent detection is not implemented (Ash is Windows-first).
type ForegroundProcess struct {
	Name     string       `json:"name"`
	Pid      int          `json:"pid"`
	Cwd      string       `json:"cwd"`
	Worktree *GitWorktree `json:"worktree"`
}

func foregroundProcess(rootPid int) (ForegroundProcess, error) {
	return ForegroundProcess{}, nil
}
