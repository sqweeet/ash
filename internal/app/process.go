package app

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Process runs bounded, one-shot commands for agent tools (bash/grep/glob).
// Interactive or long-lived commands use the ConPTY path instead.
type Process struct {
	mu             sync.Mutex
	cancels        map[string]context.CancelFunc
	pendingCancels map[string]struct{}
}

func NewProcess() *Process {
	return &Process{
		cancels:        map[string]context.CancelFunc{},
		pendingCancels: map[string]struct{}{},
	}
}

type ProcessOutput struct {
	Code      *int   `json:"code"`
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	TimedOut  bool   `json:"timed_out"`
	Cancelled bool   `json:"cancelled"`
}

// track stores a cancel func for a frontend request. A Stop can race the Wails
// invocation arriving in Go, so remember an early cancellation briefly and
// apply it as soon as Run registers the request.
func (p *Process) track(id string, cancel context.CancelFunc) {
	if id == "" {
		return
	}
	p.mu.Lock()
	_, cancelled := p.pendingCancels[id]
	delete(p.pendingCancels, id)
	if !cancelled {
		p.cancels[id] = cancel
	}
	p.mu.Unlock()
	if cancelled {
		cancel()
	}
}

func (p *Process) untrack(id string) {
	if id == "" {
		return
	}
	p.mu.Lock()
	delete(p.cancels, id)
	delete(p.pendingCancels, id)
	p.mu.Unlock()
}

// Cancel stops the in-flight process associated with a frontend tool call.
// It is intentionally idempotent: a duplicate Stop or a command that already
// finished is harmless.
func (p *Process) Cancel(id string) {
	if id == "" {
		return
	}
	p.mu.Lock()
	cancel, active := p.cancels[id]
	if !active {
		p.pendingCancels[id] = struct{}{}
	}
	p.mu.Unlock()
	if active {
		cancel()
		return
	}
	// A request that never arrives (or already completed just before Stop) must
	// not leave an entry behind forever.
	time.AfterFunc(time.Minute, func() {
		p.mu.Lock()
		delete(p.pendingCancels, id)
		p.mu.Unlock()
	})
}

func processWorkDir(cwd string) string {
	if info, err := os.Stat(cwd); err == nil && info.IsDir() {
		return cwd
	}
	home, err := os.UserHomeDir()
	if err == nil {
		return home
	}
	return ""
}

// Run starts a short-lived process, waits for it without blocking the Wails UI
// thread, and captures both output streams. Timeout cancellation kills the
// child; callers receive its captured output along with TimedOut=true.
func (p *Process) Run(id string, program string, args []string, cwd string, timeoutMs int) (ProcessOutput, error) {
	if program == "" {
		return ProcessOutput{}, fmt.Errorf("program is required")
	}
	if timeoutMs <= 0 {
		timeoutMs = 120_000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	p.track(id, cancel)
	defer p.untrack(id)
	if ctx.Err() == context.Canceled {
		return ProcessOutput{Cancelled: true}, nil
	}

	// Pin an absolute path for bare shell names so Process.Run never depends on
	// PATH for the shell itself — mirrors the PTY path's findShell(). Non-shell
	// and already-absolute programs pass through unchanged.
	resolved := resolveProgram(program)
	cmd := exec.CommandContext(ctx, resolved, args...)
	cmd.Dir = processWorkDir(cwd)
	// CommandContext's default cancellation only kills the direct PowerShell
	// process. Commands such as npm can leave descendants holding a port or the
	// output pipes alive, so terminate the whole tree and bound Wait's pipe drain.
	cmd.Cancel = func() error { return stopProcessTree(cmd) }
	cmd.WaitDelay = 2 * time.Second
	hideProcessWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		switch ctx.Err() {
		case context.Canceled:
			return ProcessOutput{Cancelled: true}, nil
		case context.DeadlineExceeded:
			return ProcessOutput{TimedOut: true}, nil
		default:
			return ProcessOutput{}, err
		}
	}

	// os/exec waits for both output copies before closing their pipes.
	waitErr := cmd.Wait()

	out := ProcessOutput{
		Stdout:    stdout.String(),
		Stderr:    stderr.String(),
		TimedOut:  ctx.Err() == context.DeadlineExceeded,
		Cancelled: ctx.Err() == context.Canceled,
	}
	if cmd.ProcessState != nil {
		code := cmd.ProcessState.ExitCode()
		out.Code = &code
	}
	if waitErr != nil && !out.TimedOut && !out.Cancelled {
		if _, ok := waitErr.(*exec.ExitError); !ok {
			return ProcessOutput{}, waitErr
		}
	}
	return out, nil
}
