# Changelog

## Unreleased

### Removed

- Remove Ash's built-in agent: the chat panes, model providers and API keys, background agents, Safe mode, chat history and import, and agent notifications. Ash now focuses on the CLI agents you run in its terminals.
- Drop the saved provider settings, including API keys, from `~/.ash/settings.json` on first launch. "Clear on exit" now offers only terminals; a saved "Chats + terminals" choice keeps clearing terminals.

### Sidebar

- Show when a CLI agent is working: Claude Code's title spinner is read from the terminal, and the tab title shines while a turn runs. Spinner glyphs no longer leak into tab titles.
- Fade long tab titles at the edge and scroll them on hover instead of cutting them off with "…".

### Terminal

- Give emoji two cells (Unicode 11 widths), matching ConPTY and TUIs, so table borders no longer zigzag.

## 1.2.1

### Sidebar

- Show the mark of the CLI agent running in a terminal (Claude Code, Codex, Pi, OpenCode) in the sidebar's single icon color.
- Add a second line to agent tabs with the agent's working folder, read from the agent process itself, so a `cd` before launch is reflected.
- In a linked git worktree, show the main repository and the worktree's branch instead of the worktree path.
- Detect Codex (`codex.exe`, and the older `codex-<target>.exe` binary name).
- Add a tab context menu with Rename, Pin, and Close. An unchanged rename no longer pins the title.
- Show the pane count on split tabs that run an agent.
- Restyle all context menus to match the composer's menus.

### Terminal

- Let the scrollbar gutter fill the terminal's right inset instead of adding padding on top, and hide its ruler outline.

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
