package app

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Native dialog and clipboard helpers exposed through Wails.
// These use the Wails runtime directly (no plugin install needed) — Ash's
// frontend calls ask()/openDialog()/clipboard read/write via the shim which
// routes here.

// Ask shows a yes/no message dialog; returns true for "Yes".
func (Tools) Ask(message string, title string) (bool, error) {
	btn, err := runtime.MessageDialog(toolsCtx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         title,
		Message:       message,
		Buttons:       []string{"Yes", "No"},
		DefaultButton: "Yes",
		CancelButton:  "No",
	})
	if err != nil {
		return false, err
	}
	return btn == "Yes", nil
}

// OpenDialog opens a file/folder picker. Ash uses it for "open folder" /
// workspace selection; we expose a single variant returning one path (empty
// string on cancel).
func (Tools) OpenDialog(title string, isDir bool) (string, error) {
	if isDir {
		return runtime.OpenDirectoryDialog(toolsCtx, runtime.OpenDialogOptions{Title: title})
	}
	return runtime.OpenFileDialog(toolsCtx, runtime.OpenDialogOptions{Title: title})
}

// ClipboardGetText returns the OS clipboard text (empty if not text/no data).
func (Tools) ClipboardGetText() (string, error) {
	return runtime.ClipboardGetText(toolsCtx)
}

// ClipboardSetText sets the OS clipboard text.
func (Tools) ClipboardSetText(text string) error {
	return runtime.ClipboardSetText(toolsCtx, text)
}

// storeToolsCtx is called from app.startup so the methods above can reach the
// Wails runtime (which needs the app context).
func storeToolsCtx(ctx context.Context) {
	toolsCtx = ctx
}
