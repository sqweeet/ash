package app

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Pty manages terminal sessions and streams pty:data / pty:exit Wails events.
type Pty struct {
	ctx   context.Context
	mu    sync.Mutex
	procs map[string]*ptyProc
}

func NewPty() *Pty {
	return &Pty{procs: map[string]*ptyProc{}}
}

func (p *Pty) startup(ctx context.Context) {
	p.ctx = ctx
}

type PtyInfo struct {
	Backend     string `json:"backend"`
	BuildNumber uint32 `json:"buildNumber"`
}

// PtyBackend supplies xterm's platform-specific resize/reflow compatibility.
func (p *Pty) PtyBackend() PtyInfo {
	return platformPtyInfo()
}

// PtySpawn uses the frontend pane id to route terminal events.
// program/args let the agent
// spawn a specific shell, null = auto-detect (pwsh/powershell/cmd on Windows).
func (p *Pty) PtySpawn(id string, cols, rows uint16, cwd string, program string, args []string) (string, error) {
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}
	proc, err := openConPTY(cwd, cols, rows, program, args)
	if err != nil {
		return "", fmt.Errorf("spawn pty: %w", err)
	}
	p.mu.Lock()
	// if a previous session reused this id, tear it down first
	if old := p.procs[id]; old != nil {
		old.Close()
	}
	p.procs[id] = proc
	p.mu.Unlock()

	// Stream ConPTY output → "pty:data" ({id, data}). EOF → "pty:exit" ({id}).
	go func() {
		buf := make([]byte, 8192)
		var decoder ptyOutputDecoder
		emit := func(data string) {
			if data != "" {
				runtime.EventsEmit(p.ctx, "pty:data", map[string]string{"id": id, "data": data})
			}
		}
		for {
			n, err := proc.Read(buf)
			if n > 0 {
				emit(decoder.decode(buf[:n]))
			}
			if err != nil {
				if err == io.EOF || isPipeClosed(err) {
					break
				}
				time.Sleep(20 * time.Millisecond) // transient — back off, don't spin
			}
		}
		emit(decoder.flush())
		proc.Close()
		p.mu.Lock()
		current := p.procs[id] == proc
		if current {
			delete(p.procs, id)
		}
		p.mu.Unlock()
		if current {
			runtime.EventsEmit(p.ctx, "pty:exit", map[string]string{"id": id})
		}
	}()

	return id, nil
}

// PtyWrite sends user keystrokes to the PTY's stdin.
func (p *Pty) PtyWrite(id, data string) error {
	p.mu.Lock()
	proc, ok := p.procs[id]
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("no pty %s", id)
	}
	_, err := proc.Write([]byte(data))
	return err
}

// PtyResize resizes the ConPTY for a pane geometry change.
func (p *Pty) PtyResize(id string, cols, rows uint16) error {
	p.mu.Lock()
	proc, ok := p.procs[id]
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("no pty %s", id)
	}
	return proc.resize(cols, rows)
}

// PtyKill terminates the process + closes the PTY.
func (p *Pty) PtyKill(id string) error {
	p.mu.Lock()
	proc, ok := p.procs[id]
	p.mu.Unlock()
	if !ok {
		return nil
	}
	return proc.Close()
}

// PtyForegroundProcess returns the deepest tty-attached descendant of the
// ConPTY's root shell — the program actually driving the terminal right now
// (claude.exe / agy.exe / opencode.exe, or the shell itself at a bare prompt).
// The frontend polls this to badge a terminal with the CLI agent running in it.
func (p *Pty) PtyForegroundProcess(id string) (ForegroundProcess, error) {
	p.mu.Lock()
	proc, ok := p.procs[id]
	p.mu.Unlock()
	if !ok {
		return ForegroundProcess{}, fmt.Errorf("no pty %s", id)
	}
	return foregroundProcess(proc.pid())
}

// shutdown tears down every live PTY when the app quits.
func (p *Pty) shutdown(_ context.Context) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, proc := range p.procs {
		proc.Close()
	}
}
