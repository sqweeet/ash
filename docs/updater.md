# Self-update

For a first install, use **Ash-Setup-vX.Y.Z.exe** from the
[latest release](https://github.com/sqweeet/ash/releases/latest). Setup installs
the same application as the standalone `Ash.exe`, including the default Gray
theme. Existing theme choices and `~/.ash` data are preserved.

Once installed, Ash updates by **swapping the binary**. Releases live on GitHub;
the app checks the latest release on startup and offers an **Update** button in
the sidebar header. Protected install locations can require a UAC prompt.

## How it works

1. **Check** — on startup (4s after launch) the frontend calls
   `check_update`, which hits
   `https://api.github.com/repos/sqweeet/ash/releases/latest` and compares the
   release tag (`vX.Y.Z`) against the build-time version (semver,
   component-wise).
2. **Badge** — if the latest release is newer, a blue **Update** button
   appears in the sidebar header.
3. **Download** — clicking it opens the update modal, which calls
   `download_update`. The Go side streams `Ash.exe` to `Ash.exe.new` (sibling
   of the running binary, or `%TEMP%` if the install dir isn't writable),
   emitting `update:progress` events with percent + bytes. The modal renders a
   progress bar.
4. **Install** — `apply_update` swaps the binary in place:
   - rename running `Ash.exe` → `Ash.exe.old` (Windows allows renaming a
     running exe, just not overwriting/deleting it),
   - rename `Ash.exe.new` → `Ash.exe`,
   - spawn the new instance, then `os.Exit(0)`.
   - If the install dir isn't user-writable (Program Files as non-admin), an
     elevated PowerShell snippet does the rename/move (one UAC prompt).
5. **Cleanup** — on the next launch, `Ash.exe.old` is deleted.

## Versioning

[semver](https://semver.org): `MAJOR.MINOR.PATCH`.

- A git tag `vX.Y.Z` triggers `.github/workflows/release.yml`. The workflow
  validates matching versions in Wails and npm metadata, runs regressions and
  static checks, and builds `Ash.exe` with version, commit, and release-channel
  linker flags. It publishes the recommended NSIS installer
  `Ash-Setup-vX.Y.Z.exe`, the bare `Ash.exe` self-update target, and
  `SHA256SUMS.txt`.
- The self-update asset **must** be named `Ash.exe` — that's what the updater
  looks for (`assetName` in `updater.go`). The installer name is cosmetic.
- The version defaults to `"dev"` for local `wails build` (no ldflags), so
  any real release is always considered newer.

## Files

- `updater.go` — check / download (progress events) / apply / restart, semver.
- `updater_windows.go` — `relaunch` (detached spawn) + `elevatedSwap` (UAC).
- `updater_other.go` — non-Windows stubs (dev only).
- `frontend/src/lib/updater.ts` — reactive store + event stream.
- `frontend/src/components/UpdateModal.tsx` — progress modal.
- `.github/workflows/release.yml` — tagged-release CI.
