package app

import (
	"context"
	"embed"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Build-time vars (set via -ldflags "-X ash-wails/internal/app.Version=...").
// Defaults let a plain `go build` / `wails build` run without flags.
var (
	Version = "dev"
	Commit  = "none"
	// BuildChannel labels the build: "dev" for local/manual builds (the
	// binary you run from build/bin), "release" for the tagged GitHub build
	// that ships to users via the installer. Used to gate dev-only toys
	// (e.g. the Ctrl+Shift+M Mac-preview) out of public releases.
	BuildChannel = "dev"
)

// App is the root struct Wails binds to the frontend. Sub-systems (PTY, fs,
// git, tools, updater) hang off it so a single OnStartup feeds ctx
// into each, and a single OnShutdown tears them down. The frontend calls
// their methods through frontend/src/backend and generated Wails bindings.
type App struct {
	ready      atomic.Bool
	closing    atomic.Bool
	allowClose atomic.Bool
	ctx        context.Context
	pty        *Pty
	fs         *Fs
	git        *Git
	tools      *Tools
	updater    *Updater
}

func NewApp() *App {
	return &App{
		pty:     NewPty(),
		fs:      NewFs(),
		git:     NewGit(),
		tools:   NewTools(),
		updater: NewUpdater(),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// GUI launchers can hand us a PATH missing C:\Windows\System32, which
	// breaks every exec.LookPath / child spawn (powershell, git, rg…). Patch
	// it once, before any subsystem touches the shell.
	ensureSystemPath()
	a.pty.startup(ctx)
	a.updater.startup(ctx)
	storeToolsCtx(ctx)
}

// AppInfo exposes build metadata to the frontend (About section, update
// check, dev-feature gating). Version/Commit/BuildChannel are set at build
// time via -ldflags; default to "dev"/"none"/"dev".
func (a *App) AppInfo() map[string]string {
	return map[string]string{
		"version": Version,
		"commit":  Commit,
		"channel": BuildChannel,
	}
}

// Ready enables close interception only after the frontend subscribed.
func (a *App) Ready() { a.ready.Store(true) }

func (a *App) Close() {
	a.allowClose.Store(true)
	runtime.Quit(a.ctx)
}

func (a *App) beforeClose(ctx context.Context) bool {
	if !a.ready.Load() || a.allowClose.Load() {
		return false
	}
	if a.closing.CompareAndSwap(false, true) {
		runtime.EventsEmit(ctx, "app:close-requested")
		// A crashed frontend must never make the native window impossible to close.
		time.AfterFunc(2*time.Second, a.Close)
	}
	return true
}

func (a *App) shutdown(ctx context.Context) {
	a.pty.shutdown(ctx)
}

// Run builds the Wails app options and starts the event loop. assets is the
// embedded frontend/dist (embedded in package main so the //go:embed path
// resolves relative to the repo root) and passed in here. Keeping all the
// Wails wiring in the app package means main.go never touches unexported
// App fields/methods — only this package does.
func Run(assets embed.FS) error {
	a := NewApp()

	// React draws the titlebar; Wails handles native window dragging.
	return wails.Run(&options.App{
		Title:     "Ash",
		Width:     1180,
		Height:    740,
		MinWidth:  720,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// Match Gray's default chrome before the webview's first paint.
		BackgroundColour: &options.RGBA{R: 24, G: 24, B: 24, A: 255},
		Frameless:        true,
		// Wails frameless drag: an element with the CSS var
		// (--wails-draggable: drag) becomes a window drag handle. The property
		// and value must be declared here (the default only kicks in with these
		// set on Windows). Value unquoted in the CSS so the matcher sees `drag`.
		CSSDragProperty: "--wails-draggable",
		CSSDragValue:    "drag",
		OnStartup:       a.startup,
		OnShutdown:      a.shutdown,
		OnBeforeClose:   a.beforeClose,
		Bind: []interface{}{
			a,         // App (root) — AppInfo / Ready / Close
			a.pty,     // PtySpawn / PtyWrite / PtyResize / PtyKill
			a.fs,      // ReadText / WriteText / DeletePath / ListDir / HomeDir
			a.git,     // Branch / Status / DiffStat
			a.tools,   // DetectBins / SshHosts / OpenPath / OpenIn
			a.updater, // CheckUpdate / DownloadUpdate / ApplyUpdate / Restart
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
	})
}
