//go:build !windows

package app

import "github.com/wailsapp/wails/v2/pkg/runtime"

// Notify falls back to the Wails runtime notification on platforms without a
// native toast path. macOS/Linux are UI-dev only, so this keeps the frontend's
// notifyAgentEvent working under `wails dev` without a dedicated backend.
func (a *App) Notify(title, body string) error {
	return runtime.SendNotification(a.ctx, runtime.NotificationOptions{
		Title: title,
		Body:  body,
	})
}
