import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "../backend/opener";
import { readText, writeText } from "../backend/clipboard";
import "@xterm/xterm/css/xterm.css";
import { configureTerminalWheel } from "./terminal-wheel";
import { createTerminalOutput } from "./terminal-output";

import {
  DEFAULT_FONT_SIZE,
  fontFamily,
  getSettings,
  onSettingsChange,
  terminalTheme,
  updateSettings,
} from "./settings";
import {
  offPty,
  onPtyData,
  onPtyExit,
  ptyBackend,
  ptyResize,
  ptySpawn,
  ptyWrite,
} from "./pty";

/**
 * Terminal sessions live here, OUTSIDE React. React components only attach
 * and detach the session's DOM container. This survives re-parenting during
 * split-layout changes — remounting a pane must not respawn its PTY.
 */

export interface TermSession {
  id: string;
  term: Terminal;
  /** null until a renderer is attached (background sessions start headless). */
  fit: FitAddon | null;
  webgl: WebglAddon | null;
  /** null until a renderer is attached (background sessions start headless). */
  container: HTMLDivElement | null;
  /** false for a headless background session that has never been opened. */
  rendered: boolean;
  /** Last OSC window title seen from this terminal — used by agent detection
   *  to extract a conversation topic (Claude Code emits {spinner} {topic}). */
  lastTitle: string;
  /** Timers and output queues must stop before disposing xterm. */
  cleanup: (() => void)[];
}

interface SessionEvents {
  onShell: (id: string, shell: string) => void;
  onTitle: (id: string, title: string) => void;
  onExit: (id: string) => void;
  /** Where a localhost link should open in-app (ctrl+click). */
  onOpenLocalUrl: (id: string, url: string) => void;
  /** cwd for newly spawned shells (active workspace). */
  getCwd: () => string | null;
  /** Known fullscreen SGR application whose early mouse setup ConPTY may lose. */
  usesSgrMouseInAltScreen?: (id: string) => boolean;
}

const sessions = new Map<string, TermSession>();
let events: SessionEvents | null = null;

// Sessions the user actually touched (typed/pasted) or that started with a
// command/program. A pristine session can be safely re-created elsewhere
// (drag-to-workspace respawns it in the folder); a used one must be kept.
const used = new Set<string>();

function copyToClipboard(text: string): void {
  writeText(text).catch(() => {});
}

/** Read the clipboard, retrying briefly so a dictation app (Wispr Flow) that
 *  sets the clipboard and simulates the keystroke near-simultaneously doesn't
 *  lose the race. Tries both the native binding and the web navigator.clipboard
 *  API — whichever returns text first wins. */
async function readClipboardReliable(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const nativeText = await readText().catch(() => "");
    if (nativeText) return nativeText;
    // Web Clipboard API — sometimes populated sooner by the dictation app.
    try {
      const webText = await navigator.clipboard.readText();
      if (webText) return webText;
    } catch {
      // navigator.clipboard can be unavailable (permissions / non-secure
      // context) — retry the native clipboard below.
    }
    // Backoff: 30 → 60 → 90 → 120 → 150 ms. Total worst case ~450 ms, which
    // is imperceptible for a paste but covers the clipboard-settle race.
    await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
  }
  return "";
}

/** Paste from the clipboard into pane `id`, marking the session used. Used by
 *  the Ctrl+V keybind and the right-click paste — the synchronous `paste`
 *  event listener (in attachRenderer) handles external paste dispatches.
 *
 *  Pastes go through `term.paste()` (not a raw ptyWrite) so xterm can wrap them
 *  in bracketed-paste markers (\x1b[200~ … \x1b[201~) when the running app has
 *  enabled DECSET 2004. CLI agents like Pi rely on this to show a pasted blob
 *  as a single [PASTED TEXT] block instead of interpreting each line as a
 *  separate input — without the markers, a multi-line paste gets fed to the
 *  app one line at a time and can't be cancelled with Esc because the bytes
 *  are already queued in the PTY. */
function pasteFromClipboard(id: string): void {
  readClipboardReliable()
    .then((text) => {
      if (!text) return;
      used.add(id);
      const term = getSession(id)?.term;
      if (term) term.paste(text);
      else ptyWrite(id, text); // headless session — no xterm to wrap, write raw
    })
    .catch(() => {});
}

/** True if anything happened in this terminal since it spawned. */
export function isSessionUsed(id: string): boolean {
  return used.has(id);
}

/** Per-pane overrides consumed at spawn time (utility / ssh launchers). */
interface SpawnOptions {
  cwd?: string | null;
  /** Typed into the shell after it starts (quick commands). */
  command?: string;
  /** Spawned directly as the PTY process instead of the shell (ssh). */
  program?: string;
  args?: string[];
  /** Auto-typed once when the process asks for a password. */
  password?: string;
}
const pendingSpawn = new Map<string, SpawnOptions>();

export function setSpawnOptions(id: string, opts: SpawnOptions) {
  pendingSpawn.set(id, opts);
}

export function configureSessions(e: SessionEvents) {
  events = e;
}

export function getSession(id: string): TermSession | undefined {
  return sessions.get(id);
}

export function adjustFontSize(delta: number) {
  const size =
    delta === 0
      ? DEFAULT_FONT_SIZE
      : Math.min(24, Math.max(9, getSettings().fontSize + delta));
  updateSettings({ fontSize: size });
}

// Re-apply visual settings to every live terminal — but ONLY when a terminal
// visual actually changed. onSettingsChange fires on EVERY settings write
// (sidebar/explorer width, section toggles, …); re-fitting and clearing every
// terminal's WebGL glyph atlas on an unrelated write (e.g. a sidebar drag-stop)
// caused visible flicker.
let lastFont = "";
let lastTheme = "";
let lastSize = -1;
onSettingsChange((s) => {
  // compute once, not per session
  const fam = fontFamily(s);
  const theme = terminalTheme(s);
  const themeKey = JSON.stringify(theme);
  if (s.fontSize === lastSize && fam === lastFont && themeKey === lastTheme) return;
  lastSize = s.fontSize;
  lastFont = fam;
  lastTheme = themeKey;
  // Defer the per-terminal refit/repaint to the next animation frame: the
  // WebGL atlas clear + fit + full-buffer refresh is heavy and was stalling
  // the current frame — running it in rAF lets the dropdown's open/close
  // animation keep its frame budget, so the switch reads as instant.
  requestAnimationFrame(() => {
    sessions.forEach((session) => {
      session.term.options.fontSize = s.fontSize;
      session.term.options.fontFamily = fam;
      session.term.options.theme = theme;
      // Headless background sessions have no renderer to refit/repaint.
      if (!session.rendered) return;
      // WebGL caches rendered glyphs in a texture atlas — without clearing it,
      // already-drawn text keeps the old font/theme while new text uses the new.
      session.webgl?.clearTextureAtlas();
      session.fit?.fit();
      session.term.refresh(0, session.term.rows - 1);
    });
  });
});

export function isLocalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"].includes(
      url.hostname,
    );
  } catch {
    return false;
  }
}

function buildTerminal(opts?: { scrollback?: number }): Terminal {
  const settings = getSettings();
  return new Terminal({
    allowProposedApi: true,
    cursorBlink: false,
    cursorStyle: "bar",
    cursorInactiveStyle: "none",
    fontFamily: fontFamily(settings),
    fontSize: settings.fontSize,
    lineHeight: 1.2,
    scrollback: opts?.scrollback ?? 10000,
    // Match xterm.css; the pane counts this gutter as part of its right inset.
    overviewRuler: { width: 11 },
    theme: terminalTheme(settings),
  });
}

// Wire PTY data/exit + spawn. Shared by headless and rendered sessions: the PTY
// side is identical whether or not a renderer is attached.
function wireAndSpawn(
  session: TermSession,
  spawnOpts: SpawnOptions | undefined,
): Promise<void> {
  const { id, term } = session;
  // A terminal that starts by running something (utility, ssh, agent command)
  // is "used" from birth — only a bare shell counts as pristine.
  if (spawnOpts?.command || spawnOpts?.program) used.add(id);
  // Explicit spawn options (even with no cwd field) opt out of the ambient
  // workspace cwd — that's how a "no workspace" tab starts in the shell's
  // own default directory instead of inheriting whatever's active.
  const cwd = spawnOpts ? (spawnOpts.cwd ?? null) : (events?.getCwd() ?? null);

  // Auto-type a saved password once, when ssh/sudo prompts for it.
  let passwordPending = spawnOpts?.password ?? "";
  let promptBuffer = "";
  const output = createTerminalOutput(term);
  session.cleanup.push(() => output.dispose());
  onPtyData(id, (data) => {
    output.write(data);
    if (passwordPending) {
      promptBuffer = (promptBuffer + data).slice(-200);
      if (/(password|passphrase)[^:]*:\s*$/i.test(promptBuffer)) {
        ptyWrite(id, passwordPending + "\r");
        passwordPending = "";
        promptBuffer = "";
      }
    }
  });
  onPtyExit(id, () => output.flush(() => {
    if (sessions.get(id) === session) events?.onExit(id);
  }));

  return ptyBackend()
    .then((info) => {
      if (sessions.get(id) === session && info.backend === "conpty") {
        term.options.windowsPty = { backend: "conpty", buildNumber: info.buildNumber };
      }
    })
    .then(() => {
      if (sessions.get(id) !== session) return null;
      return ptySpawn(id, term.cols, term.rows, cwd, spawnOpts?.program ?? null, spawnOpts?.args ?? null);
    })
    .then(async (shell) => {
      if (shell === null || sessions.get(id) !== session) return;
      events?.onShell(id, shell.replace(/\.exe$/i, ""));
      // Only shells get a typed command; a direct program (ssh) runs itself.
      if (spawnOpts?.command && !spawnOpts?.program)
        await ptyWrite(id, spawnOpts.command + "\r");
    })
    .catch((err) => {
      if (sessions.get(id) === session) term.writeln(`\x1b[31mfailed to start:\x1b[0m ${err}`);
      throw err;
    });
}

// Attach a renderer (DOM container + interaction handlers) to a session, opening
// the terminal so its buffer actually fills. `useWebgl` is off for background
// sessions: they open offscreen only to buffer output, and a fleet of WebGL
// contexts is exactly what froze the app — the DOM renderer buffers just fine.
function attachRenderer(session: TermSession, host: HTMLElement, useWebgl = true) {
  const { id, term } = session;
  const container = document.createElement("div");
  container.className = "term-container";
  host.appendChild(container);

  const fit = new FitAddon();
  term.loadAddon(fit);
  // Ctrl+Click: localhost goes to the in-app browser pane, the rest to the OS.
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      if (!event.ctrlKey) return;
      if (isLocalUrl(uri)) events?.onOpenLocalUrl(id, uri);
      else openUrl(uri).catch(() => {});
    }),
  );
  term.open(container);
  session.cleanup.push(configureTerminalWheel(term, () =>
    term.options.windowsPty?.backend === "conpty" &&
    (events?.usesSgrMouseInAltScreen?.(id) ?? false),
  ));
  let webgl: WebglAddon | null = null;
  if (useWebgl) {
    try {
      webgl = new WebglAddon();
      term.loadAddon(webgl);
      const addon = webgl;
      addon.onContextLoss(() => {
        addon.dispose();
        session.webgl = null;
        term.refresh(0, term.rows - 1);
      });
    } catch {
      // WebGL unavailable — DOM renderer still works fine.
      webgl = null;
    }
  }
  fit.fit();

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    if (e.ctrlKey && e.shiftKey && e.code === "KeyC" && term.hasSelection()) {
      copyToClipboard(term.getSelection());
      return false;
    }
    // Paste: Ctrl+V / Ctrl+Shift+V. DON'T preventDefault here — let the
    // browser's native paste event fire on xterm's textarea, and let the
    // synchronous `paste` listener on the container (see below) catch it.
    // That listener reads e.clipboardData synchronously (zero race), which is
    // exactly how the chat composer pastes — so external dictation apps
    // (Wispr Flow) that set the clipboard and simulate Ctrl+V work without
    // holding any modifier. Returning false here used to kill the native
    // paste event and force a racy async clipboard read, which is why Wispr
    // Flow lost the race and didn't auto-insert.
    //
    // We only suppress Ctrl+V when the terminal has no host (defensive —
    // shouldn't happen) so xterm never sends the 0x16 literal-next byte.
    if (e.ctrlKey && !e.altKey && e.code === "KeyV") {
      return true; // let the native paste event flow → sync listener handles it
    }
    // App-level shortcuts pass through untouched.
    if (
      e.ctrlKey &&
      e.shiftKey &&
      ["KeyT", "KeyW", "KeyD", "KeyE", "KeyB", "KeyL", "KeyO", "KeyP"].includes(e.code)
    )
      return false;
    if (e.ctrlKey && e.code === "Tab") return false;
    if (
      e.altKey &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)
    )
      return false;
    if (e.ctrlKey && ["=", "+", "-", "0", ","].includes(e.key)) return false;
    return true;
  });

  // Right click: copy selection if there is one, otherwise paste.
  container.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      copyToClipboard(term.getSelection());
      term.clearSelection();
    } else {
      pasteFromClipboard(id);
    }
  });

  // Synchronous paste event — the reliable path for ALL pastes (human
  // Ctrl+V, Ctrl+Shift+V, right-click paste, and external dictation apps like
  // Wispr Flow that set the clipboard + simulate Ctrl+V). e.clipboardData is
  // available synchronously inside the event, so there's zero race — we get
  // exactly the text being pasted, the instant it's pasted. This mirrors how
  // the chat composer pastes (onPaste + e.clipboardData), which is why the
  // chat works and the terminal didn't. Capture + stopImmediatePropagation so
  // xterm's own textarea paste handler never also fires (no double-paste).
  container.addEventListener(
    "paste",
    (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        e.preventDefault();
        e.stopImmediatePropagation();
        used.add(id);
        // Route through term.paste() so xterm applies bracketed-paste markers
        // when the app (e.g. Pi) has enabled DECSET 2004 — a multi-line paste
        // then arrives as one [PASTED TEXT] block, not line-by-line input that
        // can't be cancelled with Esc. preventDefault + stopImmediatePropagation
        // keep xterm's own textarea paste handler from also firing (no double).
        term.paste(text);
      }
    },
    true, // capture: beat xterm's own paste handler (runs before the textarea target phase)
  );

  term.onData((data) => {
    used.add(id); // any keystroke makes the terminal non-pristine
    ptyWrite(id, data);
  });
  // Pane layout already debounces fits during drags. Coalesce native resizes
  // briefly so the TUI doesn't draw against the previous grid for another 80ms.
  let resizeTimer = 0;
  session.cleanup.push(() => clearTimeout(resizeTimer));
  term.onResize(({ cols, rows }) => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => ptyResize(id, cols, rows), 16);
  });
  term.onTitleChange((title) => {
    session.lastTitle = title;
    events?.onTitle(id, title);
  });

  session.container = container;
  session.fit = fit;
  session.webgl = webgl;
  session.rendered = true;
}

export function ensureSession(id: string, host: HTMLElement): TermSession {
  const existing = sessions.get(id);
  if (existing) {
    // Re-parent the existing (already-open) terminal into this host — including
    // a background terminal moving from its offscreen host into a visible pane.
    if (existing.container && existing.container.parentElement !== host) {
      host.appendChild(existing.container);
      existing.fit?.fit();
    }
    return existing;
  }

  const spawnOpts = pendingSpawn.get(id);
  pendingSpawn.delete(id);
  const term = buildTerminal();
  const session: TermSession = {
    id,
    term,
    fit: null,
    webgl: null,
    container: null,
    rendered: false,
    lastTitle: "",
    cleanup: [],
  };
  attachRenderer(session, host);
  // Register before spawning so an immediate PTY event can always find the
  // session. A visible terminal keeps its rendered startup error for the user.
  sessions.set(id, session);
  // Spawn at the fitted size so the shell starts with the right geometry.
  void wireAndSpawn(session, spawnOpts).catch(() => {});
  return session;
}

// A PTY+xterm session for agent background terminals (dev servers, watchers).
// It's opened into an OFFSCREEN host so its buffer actually fills — that's what
// read_terminal / wait_for_terminal read — but with NO WebGL: a fleet of WebGL
// contexts is what froze the app ("not responding"), while the DOM renderer
// buffers fine. Opening it in a pane later just re-parents the same container.
export async function ensureBackgroundSession(id: string): Promise<TermSession> {
  const existing = sessions.get(id);
  if (existing) return existing;

  const spawnOpts = pendingSpawn.get(id);
  pendingSpawn.delete(id);
  // Small scrollback: read_terminal only ever reads the last ~300 lines, so a
  // fleet of chatty background servers needn't each hold 10k lines of history.
  const term = buildTerminal({ scrollback: 1000 });
  const session: TermSession = {
    id,
    term,
    fit: null,
    webgl: null,
    container: null,
    rendered: false,
    lastTitle: "",
    cleanup: [],
  };
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:500px;overflow:hidden;";
  document.body.appendChild(host);
  session.cleanup.push(() => host.remove());
  attachRenderer(session, host, false);
  // Register before spawning so output that arrives immediately isn't dropped.
  sessions.set(id, session);
  // Unlike a user-visible terminal, a background tool must not claim success
  // before its PTY exists: surface the actual startup error to the agent.
  try {
    await wireAndSpawn(session, spawnOpts);
    return session;
  } catch (error) {
    disposeSession(id);
    throw error;
  }
}

/** Scroll a session's viewport to the bottom (safe before a renderer exists). */
export function scrollSessionToBottom(id: string) {
  const s = sessions.get(id);
  if (s?.rendered) s.term.scrollToBottom();
}

/** All live session ids (rendered or headless). Used by the agent-detection
 *  poller to know which terminals to ask the backend about. */
export function sessionIds(): string[] {
  return [...sessions.keys()];
}

export function disposeSession(id: string) {
  // Clear any unconsumed spawn options FIRST: a tab can be created with
  // setSpawnOptions() and closed before its pane ever mounts (so no session
  // exists), which otherwise leaks the entry forever.
  pendingSpawn.delete(id);
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  used.delete(id);
  offPty(id);
  session.cleanup.forEach((cleanup) => cleanup());
  session.term.dispose();
  session.container?.remove();
}

/** Dispose of every live terminal session (PTY + xterm). Used by the
 * "clear terminals on exit" setting — terminals aren't persisted, so this is
 * purely a teardown of the in-memory sessions. */
export function disposeAllSessions() {
  for (const id of [...sessions.keys()]) disposeSession(id);
}
