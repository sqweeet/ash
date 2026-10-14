package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Updater implements in-place binary self-update against GitHub Releases.
// No installer: the new Ash.exe is downloaded to a temp file, the running
// binary is renamed to Ash.exe.old (Windows allows renaming a running exe,
// just not overwriting/deleting it), the new file is moved into place, and
// the app is relaunched. On the next launch, Ash.exe.old is deleted.
//
// Release source of truth: https://github.com/sqweeet/ash/releases/latest
// The release asset must be named Ash.exe (uploaded by the release CI).
type Updater struct {
	ctx context.Context
}

const (
	ghOwner    = "sqweeet"
	ghRepo     = "ash"
	assetName  = "Ash.exe"
	oldSuffix  = ".old"
	newSuffix  = ".new"
	ghAPIToken = "" // set empty → anonymous, 60 req/h per IP (plenty for one app)
)

func NewUpdater() *Updater { return &Updater{} }

func (u *Updater) startup(ctx context.Context) {
	u.ctx = ctx
	// Best-effort: clean up a .old binary left by a previous self-update.
	// Safe to ignore errors (file may be locked on a quick relaunch — it'll
	// be retried next launch).
	go cleanupOldBinary()
}

// UpdateRelease is the subset of a GitHub release the frontend needs.
type UpdateRelease struct {
	HasUpdate    bool   `json:"hasUpdate"`
	Latest       string `json:"latest"`       // "1.2.0" (no v prefix)
	Current      string `json:"current"`      // build-time Version
	Notes        string `json:"notes"`        // release body
	URL          string `json:"url"`          // release html url
	DownloadURL  string `json:"downloadUrl"`  // asset browser_download_url
	DownloadSize int64  `json:"downloadSize"` // asset size in bytes
	AssetName    string `json:"assetName"`
}

// CheckUpdate queries GitHub for the latest release and compares versions
// (semver). Returns whether an update is available + release metadata.
func (u *Updater) CheckUpdate() (UpdateRelease, error) {
	out := UpdateRelease{Current: Version}
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", ghOwner, ghRepo)
	req, err := http.NewRequestWithContext(u.ctx, http.MethodGet, url, nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if ghAPIToken != "" {
		req.Header.Set("Authorization", "Bearer "+ghAPIToken)
	}
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return out, fmt.Errorf("check update: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("github api: %s", resp.Status)
	}
	var raw struct {
		TagName string `json:"tag_name"`
		Name    string `json:"name"`
		Body    string `json:"body"`
		HTML    string `json:"html_url"`
		Assets  []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
			Size int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return out, fmt.Errorf("decode release: %w", err)
	}
	out.Latest = strings.TrimPrefix(raw.TagName, "v")
	out.Notes = raw.Body
	out.URL = raw.HTML
	out.AssetName = assetName
	for _, a := range raw.Assets {
		if a.Name == assetName {
			out.DownloadURL = a.URL
			out.DownloadSize = a.Size
			break
		}
	}
	if out.DownloadURL == "" {
		return out, fmt.Errorf("release %s has no %s asset", raw.TagName, assetName)
	}
	out.HasUpdate = semverLess(normalizeVer(Version), normalizeVer(out.Latest))
	return out, nil
}

// DownloadUpdate downloads the Ash.exe asset to a temp path next to the
// running binary, streaming "update:progress" events with percent + bytes.
// Returns the local path of the downloaded file (the .new candidate).
func (u *Updater) DownloadUpdate() (string, error) {
	info, err := u.CheckUpdate()
	if err != nil {
		return "", err
	}
	if !info.HasUpdate {
		return "", fmt.Errorf("no update available")
	}
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve exe: %w", err)
	}
	exePath, _ = filepath.Abs(exePath)
	dir := filepath.Dir(exePath)
	dest := filepath.Join(dir, newSuffix) // Ash.exe.new sibling

	req, err := http.NewRequestWithContext(u.ctx, http.MethodGet, info.DownloadURL, nil)
	if err != nil {
		return "", err
	}
	// GitHub redirects browser_download_url to S3; follow via default client.
	resp, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		return "", fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download: %s", resp.Status)
	}

	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		// dir not writable (e.g. Program Files as non-admin) → fall back to temp.
		tmp = filepath.Join(os.TempDir(), assetName+newSuffix+".part")
		dest = filepath.Join(os.TempDir(), assetName+newSuffix)
		f, err = os.Create(tmp)
		if err != nil {
			return "", fmt.Errorf("create temp: %w", err)
		}
	}
	defer f.Close()

	total := resp.ContentLength
	if total <= 0 {
		total = info.DownloadSize
	}
	var written int64
	buf := make([]byte, 64*1024)
	last := time.Now()
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return "", werr
			}
			written += int64(n)
			if time.Since(last) > 120*time.Millisecond {
				last = time.Now()
				pct := 0
				if total > 0 {
					pct = int(written * 100 / total)
				}
				wruntime.EventsEmit(u.ctx, "update:progress", map[string]any{
					"percent":    pct,
					"downloaded": written,
					"total":      total,
					"stage":      "downloading",
				})
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return "", rerr
		}
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, dest); err != nil {
		return "", fmt.Errorf("finalize download: %w", err)
	}
	wruntime.EventsEmit(u.ctx, "update:progress", map[string]any{
		"percent": 100, "downloaded": written, "total": total, "stage": "downloaded",
	})
	return dest, nil
}

// ApplyUpdate swaps the downloaded binary into place and relaunches the app.
// Windows allows renaming a running exe, so: rename current → .old, rename
// .new → current, spawn the new process, then quit. The .old file is cleaned
// up on the next launch (see startup). If the install dir isn't writable
// (Program Files as non-admin), an elevated helper swaps the files.
func (u *Updater) ApplyUpdate(newPath string) error {
	wruntime.EventsEmit(u.ctx, "update:progress", map[string]any{"stage": "installing", "percent": 100})
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve exe: %w", err)
	}
	exePath, _ = filepath.Abs(exePath)
	oldPath := exePath + oldSuffix

	swapped := false
	// Try a direct swap first (works for user-scope installs / elevated runs).
	if err := directSwap(exePath, newPath, oldPath); err == nil {
		swapped = true
	} else if runtime.GOOS == "windows" {
		// Permission denied in Program Files → elevated helper (one UAC prompt).
		if err := elevatedSwap(exePath, newPath, oldPath); err != nil {
			return fmt.Errorf("elevated swap: %w", err)
		}
		swapped = true
	} else {
		return fmt.Errorf("swap failed (non-windows self-update not supported)")
	}
	if !swapped {
		return fmt.Errorf("swap failed")
	}

	// Spawn the new instance, then quit this one. The new binary now lives at
	// exePath; .old is removed on the next launch.
	if err := relaunch(exePath); err != nil {
		return fmt.Errorf("relaunch: %w", err)
	}
	wruntime.EventsEmit(u.ctx, "update:progress", map[string]any{"stage": "restarting", "percent": 100})
	// Give the frontend a beat to render "Restarting…", then exit. os.Exit is
	// deliberate here — Wails teardown would cancel the just-spawned child.
	go func() {
		time.Sleep(600 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}

// Restart relaunches the app without applying an update (e.g. after a manual
// swap). Spawns a new instance and quits this one.
func (u *Updater) Restart() error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	return relaunch(exePath)
}

// directSwap: rename running exe → .old, move new → exe. Fails if the dir
// isn't writable.
func directSwap(exePath, newPath, oldPath string) error {
	_ = os.Remove(oldPath) // leftover from a prior attempt
	if err := os.Rename(exePath, oldPath); err != nil {
		return err
	}
	if err := os.Rename(newPath, exePath); err != nil {
		// rollback so the app keeps running on failure
		_ = os.Rename(oldPath, exePath)
		return err
	}
	return nil
}

// cleanupOldBinary removes Ash.exe.old once the new binary owns the process.
func cleanupOldBinary() {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	old := exePath + oldSuffix
	for i := 0; i < 10; i++ {
		if err := os.Remove(old); err == nil || os.IsNotExist(err) {
			return
		}
		time.Sleep(300 * time.Millisecond)
	}
}

// normalizeVer turns "v1.2.3" / "1.2.3" / "dev" into [3]int (missing → 0).
// "dev" sorts as 0.0.0 so any real release is considered newer.
func normalizeVer(s string) [3]int {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	if s == "" || s == "dev" || s == "none" {
		return [3]int{}
	}
	var v [3]int
	parts := strings.SplitN(s, ".", 4)
	for i := 0; i < 3 && i < len(parts); i++ {
		n, _ := strconv.Atoi(strings.SplitN(parts[i], "-", 2)[0])
		v[i] = n
	}
	return v
}

// semverLess: a < b (component-wise).
func semverLess(a, b [3]int) bool {
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return false
}
