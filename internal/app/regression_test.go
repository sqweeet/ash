package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCreateFileDoesNotOverwrite(t *testing.T) {
	fs := Fs{}
	path := filepath.Join(t.TempDir(), "nested", "file.txt")
	if err := fs.CreateFile(path); err != nil {
		t.Fatal(err)
	}
	if err := fs.WriteText(path, "keep me"); err != nil {
		t.Fatal(err)
	}
	if err := fs.CreateFile(path); !os.IsExist(err) {
		t.Fatalf("expected exists error, got %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "keep me" {
		t.Fatalf("existing content changed: %q, %v", data, err)
	}
	if err := fs.CreateDir(filepath.Join(filepath.Dir(path), "new-dir")); err != nil {
		t.Fatal(err)
	}
}

func TestGitParsers(t *testing.T) {
	root := t.TempDir()
	entries := parseGitStatus(root, " M leading space.txt\x00R  renamed file.txt\x00old name.txt\x00?? new file.txt\x00 D deleted.txt\x00")
	if len(entries) != 4 {
		t.Fatalf("entries: %#v", entries)
	}
	for i, want := range []string{"M", "R", "A", "D"} {
		if entries[i].Status != want {
			t.Fatalf("entry %d: %#v", i, entries[i])
		}
	}
	if entries[1].Path != filepath.Join(root, "renamed file.txt") {
		t.Fatal(entries[1])
	}
	if got := parseGitDiff("12\t3\tfile name\n-\t-\tbinary\n2\t4\tother\n"); got != (GitDiff{14, 7}) {
		t.Fatal(got)
	}
}

func TestWindowCloseBeforeReadyAndAfterApproval(t *testing.T) {
	a := NewApp()
	if a.beforeClose(nil) {
		t.Fatal("must close before frontend is ready")
	}
	a.Ready()
	a.allowClose.Store(true)
	if a.beforeClose(nil) {
		t.Fatal("must close after frontend approved")
	}
}
