# Ash

> A terminal and AI workspace for Windows. Your shell, your models, one quiet desktop.

[![version](https://img.shields.io/github/v/release/sqweeet/ash?style=flat-square&color=666666)](https://github.com/sqweeet/ash/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/sqweeet/ash/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/sqweeet/ash/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/sqweeet/ash?style=flat-square&color=666666)](LICENSE)

**[Download the Windows installer](https://github.com/sqweeet/ash/releases/download/v1.2.1/Ash-Setup-v1.2.1.exe)** · [What's new](CHANGELOG.md) · [All releases](https://github.com/sqweeet/ash/releases)

## Install

**Recommended:** run `Ash-Setup-v1.2.1.exe`. Setup installs Ash to `C:\Program Files\Ash`, adds Start-menu and desktop shortcuts, and installs WebView2 if it is missing. Close Ash before upgrading; Setup does not terminate your terminals or overwrite your saved preferences.

New profiles start with **Gray**, a darker neutral theme with soft, recognizable terminal colors. Existing theme choices are preserved. Change themes in **Settings → Appearance**.

Prefer a standalone executable? Download `Ash.exe` from the same release. This is also the file used by the in-app updater. `SHA256SUMS.txt` contains checksums for both downloads.

**Requirements:** Windows 10 version 1809 or later / Windows 11, x64, and WebView2 Runtime. Go and Node.js are only needed to build from source. Releases are not code-signed; Windows may show a publisher/SmartScreen warning.

## Features

- **Terminal + AI in one window.** Run a real shell beside a built-in agent. Connect an OpenAI-compatible endpoint and your own API key.
- **A quiet interface.** Gray surfaces, muted accents, and Windows 11 caption icons. Other dark and light themes remain available; application truecolor is not desaturated.
- **Reliable fullscreen TUIs.** Native mouse scrolling, ordered terminal input/output, and working terminal palette queries. The wheel does not inject arrow or PageUp/PageDown keys.
- **Workspaces and split panes.** Bind a folder to a workspace, arrange terminal and agent panes, and keep terminal sessions alive when moving panes.
- **Home-directory shell startup.** New terminals open in your home or selected workspace, not the install directory.
- **Direct clipboard paste.** Ctrl+V, Ctrl+Shift+V, and right-click paste without duplicate input.
- **In-app updates.** An Update button links a new release to its download and restart flow. Protected install locations can require a UAC prompt. See [self-update details](docs/updater.md).

Microsoft's modern ConPTY runtime is embedded in `Ash.exe` and cached under `%LOCALAPPDATA%\Ash\ConPTY` on first use. It needs no startup download, administrator rights, or separate Windows Terminal installation. See [runtime details and license](internal/conpty/README.md).

> **Agent safety:** tools run with your Windows account's permissions. Safe mode is a project-copy and review workflow, not an OS sandbox. Review commands and proposed merges before approving them.

## Build from source

Install [Go 1.25+](https://go.dev/dl/), [Node.js 22.12+](https://nodejs.org/), and [Wails CLI v2](https://wails.io/docs/gettingstarted/installation). Install NSIS as well to build Setup.

```bash
git clone https://github.com/sqweeet/ash.git
cd ash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.13.0
npm --prefix frontend ci
wails dev          # hot reload
wails build        # build/bin/Ash.exe
wails build -nsis  # also builds build/bin/Ash-amd64-installer.exe
```

`make build`, `make installer`, `make dev`, and `make run` are shortcuts. Windows is the production terminal target; macOS/Linux builds are for UI development only.

## Checks

```bash
npm --prefix frontend test
npm --prefix frontend run build
go test -count=1 ./...
go vet ./...
```

The desktop backend is Go/Wails. Frontend commands live in `frontend/src/backend/`; no Rust/Tauri toolchain is required.

## Releases

Versions use [semver](https://semver.org). Update `wails.json`, `frontend/package.json`, and its lockfile together, and add `docs/releases/vX.Y.Z.md`. A `vX.Y.Z` tag runs the checked [release workflow](.github/workflows/release.yml) and publishes:

- **`Ash-Setup-vX.Y.Z.exe`** — recommended installer;
- `Ash.exe` — standalone application and self-update target;
- `SHA256SUMS.txt` — checksums.

## License

[MIT](LICENSE). The bundled ConPTY runtime includes [Microsoft's MIT license](internal/conpty/assets/LICENSE).
