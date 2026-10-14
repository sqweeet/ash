# Changelog

## 1.2.0

### Appearance

- Introduce **Gray**, a darker neutral default for new installations. Keep terminal ANSI colors muted but distinguishable and preserve application truecolor output.
- Migrate the earlier `ash-gray` theme preference to `gray` without changing other saved preferences.
- Match the startup splash and native window background to Gray.
- Use Windows 11 caption artwork with consistent sizing and remove the close-button edge gap.

### Terminal

- Bundle a pinned Microsoft ConPTY runtime with its license for reliable palette queries, early mouse setup, and terminal shutdown.
- Preserve terminal input ordering, including palette responses and their completion marker.
- Use native fullscreen mouse scrolling; prevent wheel-generated navigation keys. Retain a narrowly scoped Pi compatibility fallback.
- Keep fragmented UTF-8 and terminal output in order and avoid showing a second native caret.

### Desktop and distribution

- Complete the Go/Wails frontend adapters and remove unused Rust/Tauri code and dependencies.
- Keep optional model-catalog fetching out of the startup critical path.
- Preserve authoritative compacted chat history and prevent deleted chats from being recreated by queued writes.
- Make the Windows installer the recommended download and publish SHA-256 checksums alongside both release executables.
- Keep installer, executable, npm metadata, release tag, and in-app version synchronized.
- Preserve unrelated files and user preferences during installation and uninstall; require a running Ash to close rather than terminating it.
- Check frontend regressions, real Windows PTY behavior, and Go static analysis before publishing.

### Known limitations

- Safe mode is a project-copy workflow, not OS-level process isolation. Sandbox conflict detection, cancellation during command review, and background-agent error propagation still need follow-up work.
- Release downloads are not code-signed. Windows can display a SmartScreen warning.
- Non-Windows desktop builds are intended for UI development, not a production terminal backend.

## 1.1.5 and earlier

See the [GitHub releases](https://github.com/sqweeet/ash/releases) for historical changes.
