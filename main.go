package main

import (
	"embed"

	"ash-wails/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

func main() {
	// Entry point is intentionally thin: the embedded frontend assets live
	// here (//go:embed resolves relative to this file at the repo root) and
	// are handed to app.Run, which owns all the Wails wiring + bound structs.
	// See internal/app/app.go for the app package.
	app.SetAppIcon(appIcon)
	if err := app.Run(assets); err != nil {
		println("Error:", err.Error())
	}
}
