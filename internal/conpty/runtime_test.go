package conpty

import (
	"bytes"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestBundledRuntimeArchitectures(t *testing.T) {
	for _, arch := range []string{"amd64", "arm64", "386"} {
		t.Run(arch, func(t *testing.T) {
			files, err := runtimeFiles(arch)
			if err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"conpty.dll", "OpenConsole.exe"} {
				if !bytes.HasPrefix(files[name], []byte("MZ")) {
					t.Fatalf("%s is not a Windows executable", name)
				}
			}
			if !bytes.Contains(files["LICENSE"], []byte("Microsoft Corporation")) {
				t.Fatal("runtime must ship with its license")
			}
		})
	}
	if _, err := runtimeFiles("not-an-arch"); err == nil {
		t.Fatal("unsupported architectures must not load the wrong DLL")
	}
}

func TestRuntimeCacheReuseAndRepair(t *testing.T) {
	cache := t.TempDir()
	dll, err := prepareRuntime(cache, "amd64")
	if err != nil {
		t.Fatal(err)
	}
	files, _ := runtimeFiles("amd64")
	// A matching DLL may be in use by another Ash. It must not be rewritten.
	stamp := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := os.Chtimes(dll, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareRuntime(cache, "amd64"); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(dll)
	if !info.ModTime().Equal(stamp) {
		t.Fatal("matching DLL was overwritten")
	}
	host := filepath.Join(filepath.Dir(dll), "OpenConsole.exe")
	if err := os.WriteFile(host, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareRuntime(cache, "amd64"); err != nil {
		t.Fatal(err)
	}
	for name, want := range files {
		if !runtimeFileMatches(filepath.Join(filepath.Dir(dll), name), want) {
			t.Fatalf("%s was not restored from the pinned package", name)
		}
	}
	if matches, _ := filepath.Glob(filepath.Join(filepath.Dir(dll), ".conpty-*")); len(matches) != 0 {
		t.Fatalf("temporary cache files leaked: %v", matches)
	}
}

func TestConcurrentRuntimePreparation(t *testing.T) {
	cache := t.TempDir()
	var workers sync.WaitGroup
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if _, err := prepareRuntime(cache, "amd64"); err != nil {
				t.Error(err)
			}
		}()
	}
	workers.Wait()
}

func TestRuntimeCacheFailureIsNotHidden(t *testing.T) {
	file := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(file, []byte("occupied"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareRuntime(file, "amd64"); err == nil {
		t.Fatal("an unusable runtime cache must be reported")
	}
}
