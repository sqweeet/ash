package app

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Fs struct{}

func NewFs() *Fs { return &Fs{} }

// DirItem is one explorer entry.
type DirItem struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

// ReadText returns nil for missing files, as settings/chat loaders expect.
func (Fs) ReadText(path string) (*string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	s := string(b)
	return &s, nil
}

// WriteText writes contents to path, creating parent dirs as needed (Ash's
// chat-store + settings rely on ~/.ash/ being auto-created).
func (Fs) WriteText(path, contents string) error {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(path, []byte(contents), 0o644)
}

// CreateFile never truncates an existing file.
func (Fs) CreateFile(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	return file.Close()
}

func (Fs) CreateDir(path string) error {
	return os.MkdirAll(path, 0o755)
}

// DeletePath removes a file or directory (recursive for dirs). Missing is fine.
func (Fs) DeletePath(path string) error {
	err := os.RemoveAll(path)
	if err == nil || os.IsNotExist(err) {
		return nil
	}
	return err
}

// ListDir lists one directory level: name, absolute path, is_dir, size.
// Sorted dirs-first then alphabetical (case-insensitive); truncated to 1000
// entries. The `path` field is absolute so the frontend
// can recurse / open files without re-joining.
func (Fs) ListDir(path string) ([]DirItem, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	items := make([]DirItem, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		var size int64
		if err == nil {
			size = info.Size()
		}
		items = append(items, DirItem{
			Name:  e.Name(),
			Path:  filepath.Join(path, e.Name()),
			IsDir: e.IsDir(),
			Size:  size,
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir // dirs first
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
	if len(items) > 1000 {
		items = items[:1000]
	}
	return items, nil
}

// HomeDir returns the user's home directory (~ on Windows = USERPROFILE).
func (Fs) HomeDir() (string, error) {
	h, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("home dir: %w", err)
	}
	return h, nil
}
