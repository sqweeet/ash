# Bundled ConPTY

Ash uses Microsoft's side-by-side ConPTY, not the copy of `conhost.exe` shipped
with Windows. Older system hosts swallow OSC 10/11 color queries, OSC replies,
and mouse setup issued before raw mode. They can also answer DA before the
terminal has answered preceding queries. For example, Pi's `system` theme then
receives no terminal palette and renders tool panels without their proper hue.

The unmodified, signed upstream NuGet package is embedded in Ash.exe:

- Package: `Microsoft.Windows.Console.ConPTY` **1.25.260930003**
- Release: https://github.com/microsoft/terminal/releases/tag/v1.25.2733.0
- Download: https://github.com/microsoft/terminal/releases/download/v1.25.2733.0/Microsoft.Windows.Console.ConPTY.1.25.260930003.nupkg
- SHA-256: `6d6f8b008c655d814c498d8205d4012dcd4d0b6dfc1096461d0a185d1e3caf03`
- License: MIT, reproduced in `assets/LICENSE` and included in the extracted runtime.
- Supported runtime targets: Windows amd64, arm64 and 386 (Windows 10 build 17763+).

On first use, Ash extracts only the matching `conpty.dll`, `OpenConsole.exe`,
and license into `%LOCALAPPDATA%\Ash\ConPTY\<version>\<architecture>`. Files are
checked against the embedded package, repaired atomically when needed, and left
untouched when already correct. The DLL is loaded by absolute path, searching
only its own directory and System32 for dependencies. No download, admin rights,
Windows Terminal installation, or change to the system console is required.
Failure to prepare/load this runtime is reported rather than silently returning
to the broken system host. The executable remains self-contained for updates.

`session_windows.go` uses the SDK's `Conpty*` functions consistently (never mixing
DLL and kernel32 handles). `ConptyReleasePseudoConsole` is called after child
creation so normal process exit closes the output stream. Original child-side
pipe handles and process/attribute-list handles are also released.

## Updating the SDK

1. Download the official `.nupkg` for a pinned Microsoft Terminal release and
   verify its provenance/checksum. Do not replace it with an unsigned repack.
2. Replace the package in `assets/`, then update the embed path, version and
   SHA-256 in `runtime.go` and this document.
3. Run `go test ./...`, `go vet ./...`, and the frontend tests/build.
4. Check live shells, Pi color-query replies, fullscreen mouse input, resize,
   Unicode, and exit/close behavior before releasing.

There is deliberately no build-time download: normal builds and tests can run
offline once the Go/npm dependencies are installed.
