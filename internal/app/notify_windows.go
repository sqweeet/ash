//go:build windows

package app

import (
	"fmt"

	"git.sr.ht/~jackmordaunt/go-toast/v2"
)

// Notify sends a native Windows toast for Ash. It uses go-toast directly rather
// than the Wails notification runtime. The Wails backend registers the toast
// under the executable's base name (filepath.Base(exePath)) — i.e. "Ash.exe" —
// with no app icon, which is what makes its toasts look generic. Registering
// our own AppUserModelID ("Ash") with the embedded app icon gives a properly
// branded system toast. No activation exe is set, so clicking the toast just
// dismisses it (no second app instance), which is the expected behaviour for an
// informational notification.
func (a *App) Notify(title, body string) error {
	icon := appIconPath()
	if err := toast.SetAppData(toast.AppData{
		AppID:    "Ash",
		IconPath: icon,
	}); err != nil {
		return fmt.Errorf("registering toast app: %w", err)
	}

	return (&toast.Notification{
		Title: title,
		Body:  body,
		Icon:  icon,
		Audio: toast.Default,
	}).Push()
}
