// Package conpty hosts terminal sessions with a pinned Microsoft ConPTY runtime.
package conpty

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

const runtimeVersion = "1.25.260930003"
const runtimeArchiveSHA256 = "6d6f8b008c655d814c498d8205d4012dcd4d0b6dfc1096461d0a185d1e3caf03"

// Keep the signed, unmodified upstream package: all supported Windows CPU
// architectures, reproducible builds, and no network access at app startup.
//
//go:embed assets/Microsoft.Windows.Console.ConPTY.1.25.260930003.nupkg
var runtimeArchive []byte

//go:embed assets/LICENSE
var runtimeLicense []byte

func runtimeFiles(arch string) (map[string][]byte, error) {
	platform := map[string]string{"amd64": "x64", "arm64": "arm64", "386": "x86"}[arch]
	if platform == "" {
		return nil, fmt.Errorf("unsupported ConPTY architecture %q", arch)
	}
	if fmt.Sprintf("%x", sha256.Sum256(runtimeArchive)) != runtimeArchiveSHA256 {
		return nil, fmt.Errorf("bundled ConPTY archive checksum mismatch")
	}
	archive, err := zip.NewReader(bytes.NewReader(runtimeArchive), int64(len(runtimeArchive)))
	if err != nil {
		return nil, fmt.Errorf("open bundled ConPTY archive: %w", err)
	}
	// Only these exact members are extracted, never arbitrary archive paths.
	members := map[string]string{
		"runtimes/win-" + platform + "/native/conpty.dll":        "conpty.dll",
		"build/native/runtimes/" + platform + "/OpenConsole.exe": "OpenConsole.exe",
	}
	files := map[string][]byte{"LICENSE": runtimeLicense}
	for _, member := range archive.File {
		name, wanted := members[member.Name]
		if !wanted {
			continue
		}
		reader, err := member.Open()
		if err != nil {
			return nil, fmt.Errorf("open ConPTY %s: %w", name, err)
		}
		data, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			return nil, fmt.Errorf("read ConPTY %s: %w", name, err)
		}
		files[name] = data
	}
	if len(files) != len(members)+1 {
		return nil, fmt.Errorf("bundled ConPTY archive is missing runtime files for %s", arch)
	}
	return files, nil
}

// prepareRuntime repairs missing/corrupt cache files but leaves matching files
// untouched: another Ash instance may currently have the DLL/host loaded.
func prepareRuntime(cacheDir, arch string) (string, error) {
	files, err := runtimeFiles(arch)
	if err != nil {
		return "", err
	}
	dir, err := filepath.Abs(filepath.Join(cacheDir, "Ash", "ConPTY", runtimeVersion, arch))
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("create ConPTY runtime directory: %w", err)
	}
	for name, data := range files {
		if err := installRuntimeFile(filepath.Join(dir, name), data); err != nil {
			return "", fmt.Errorf("prepare ConPTY %s: %w", name, err)
		}
	}
	return filepath.Join(dir, "conpty.dll"), nil
}

func runtimeFileMatches(path string, want []byte) bool {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() != int64(len(want)) {
		return false
	}
	got, err := os.ReadFile(path)
	return err == nil && sha256.Sum256(got) == sha256.Sum256(want)
}

func installRuntimeFile(path string, data []byte) error {
	if runtimeFileMatches(path, data) {
		return nil
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".conpty-*")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	for attempt := 0; attempt < 10; attempt++ {
		// Another Ash may have installed/loaded this file while we wrote ours.
		// Concurrent reads/renames or an antivirus scan can briefly deny sharing
		// on Windows, so retry both the comparison and the atomic replacement.
		if runtimeFileMatches(path, data) {
			return nil
		}
		if err = os.Rename(tmp, path); err == nil {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return err
}
