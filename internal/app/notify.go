package app

import (
	"os"
	"path/filepath"
	"sync"
)

var (
	appIcon  []byte
	iconOnce sync.Once
	iconPath string
)

// SetAppIcon provides the embedded Ash app icon (PNG bytes) so native Windows
// toasts can show the real logo. Called once from main before Run.
func SetAppIcon(b []byte) { appIcon = b }

// appIconPath materializes the app icon to a temp file on first use and returns
// its absolute path. Windows reads toast icon images by path from outside the
// working directory, so an embedded byte slice has to be written out first.
func appIconPath() string {
	iconOnce.Do(func() {
		if len(appIcon) == 0 {
			return
		}
		p := filepath.Join(os.TempDir(), "ash-toast-icon.png")
		if err := os.WriteFile(p, appIcon, 0o644); err != nil {
			return
		}
		iconPath = p
	})
	return iconPath
}
