import { invoke } from "./backend/core";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { applyAppTheme, applyUiScale, getSettings, loadSettings } from "./lib/settings";

// UI font (app chrome). Geist Mono / JetBrains Mono below stay for the terminal.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/cyrillic-500.css";
import "@fontsource/inter/cyrillic-600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/cyrillic-400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/cyrillic-400.css";
// extra terminal monospace faces for variety (weight 400 + cyrillic where the
// family ships it — keeps the terminal readable on ru/cyrillic output).
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/cyrillic-400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/cyrillic-400.css";
import "@fontsource/source-code-pro/400.css";
import "@fontsource/source-code-pro/cyrillic-400.css";
import "@fontsource/inconsolata/400.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/martian-mono/400.css";
import "@fontsource/martian-mono/cyrillic-400.css";
// Split from the former single style.css. base.css MUST load first (tokens +
// reset); the rest are per-concern sheets loaded in the original cascade order.
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/sidebar.css";
import "./styles/command-palette.css";
import "./styles/terminal.css";
import "./styles/welcome.css";
import "./styles/browser.css";
import "./styles/file-viewer.css";
import "./styles/explorer.css";
import "./styles/context-menu.css";
import "./styles/toast.css";
import "./styles/modals.css";
import "./styles/update.css";
import "./styles/settings.css";
import "./styles/xterm.css";


// macOS uses native traffic-light window controls, so tag the root: the
// layout reserves their top-left space and TitleBar hides our custom
// Windows-style buttons. UA sniffing is reliable here.
const realMac = navigator.userAgent.includes("Macintosh");
if (realMac) document.documentElement.classList.add("mac");

// Dev-only "Mac preview" (Ctrl+Shift+M) forces the Mac layout on Windows and
// draws SIMULATED traffic lights so the Mac look can be eyeballed without a
// Mac. This is a DEV toy — it must NEVER ship in a public release build
// (channel === "release"), only in local/dev binaries. The channel comes from
// the Go build var via AppInfo; until it resolves we assume dev so a local
// `wails build` still works without flags.
async function applyMacPreviewIfDev() {
  let channel = "dev";
  try {
    const info = await invoke<Record<string, string>>("app_info");
    channel = info?.channel ?? "dev";
  } catch {
    // binding not ready / shim missing — treat as dev (safe default for local).
  }
  if (channel === "release") return; // prod: no Mac-preview, no toggle.
  const macPreview = localStorage.getItem("ash.macPreview") === "1";
  if (macPreview) {
    document.documentElement.classList.add("mac");
    if (!realMac) document.documentElement.classList.add("mac-preview");
  }
  // Toggle the dev Mac-preview and reload so the detection above re-runs.
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === "m" || e.key === "M")) {
      e.preventDefault();
      localStorage.setItem("ash.macPreview", macPreview ? "0" : "1");
      location.reload();
    }
  });
}
void applyMacPreviewIfDev();

async function start() {
  // Surface any startup failure on-screen — without this a throw leaves the
  // gray splash up and there's no clue what's broken. Set up global handlers
  // FIRST so even an error before the try-block is visible.
  const showError = (e: unknown) => {
    const splash = document.getElementById("splash");
    if (splash) splash.remove();
    const root = document.getElementById("root")!;
    const message = document.createElement("pre");
    message.style.cssText = "color:#ff6369;padding:24px;white-space:pre-wrap;background:#0a0a0a;min-height:100vh";
    message.textContent = "Ash failed to start:\n\n" + String(e) + "\n\n" +
      (e instanceof Error ? e.stack ?? "" : "");
    root.replaceChildren(message);
    console.error("startup error:", e);
  };
  window.addEventListener("error", (e) => showError(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => showError(e.reason));

  try {
  // Kick off every independent startup read at once instead of serially:
  //  - settings.json (needed for the theme, so we await it first),
  //  - the fonts the terminal measures its cell size against.
  // The @font-face rules are already registered by the CSS imports above, so
  // font loading can begin immediately, overlapping the disk read.
  const settingsReady = loadSettings();
  // Terminals measure cell size at creation — the mono font must be in first.
  // Load a Cyrillic sample too so that subset is ready before any RU text.
  // Preload EVERY selectable terminal mono face (not just the default) so that
  // switching fonts in Settings doesn't stall on a first-use woff2 fetch —
  // that fetch was the lag that froze the dropdown animation mid-switch.
  const monoFaces = [
    '"Geist Mono"',
    '"JetBrains Mono"',
    '"Cascadia Mono"',
    '"Cascadia Code"',
    '"Fira Code"',
    '"IBM Plex Mono"',
    '"Source Code Pro"',
    '"Inconsolata"',
    '"Space Mono"',
    '"Martian Mono"',
  ];
  const fontsReady = Promise.all([
    ...monoFaces.flatMap((f) => [
      document.fonts.load(`13px ${f}`),
      document.fonts.load(`13px ${f}`, "Я"),
    ]),
    document.fonts.load('12px "Inter"'),
    document.fonts.load('12px "Inter"', "Я"),
  ]).catch(() => {
    // best-effort; fallback fonts still render
  });

  // Theme needs settings — apply as soon as they're in so there's no flash.
  await settingsReady;
  applyAppTheme(getSettings().theme);
  applyUiScale();

  // Block the first render only on what it truly needs: the terminal fonts
  // (already in flight, overlapping the settings read).
  await fontsReady;

  // No StrictMode: its double-mounted effects would spawn every PTY twice.
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
  } catch (e) {
    showError(e);
    return;
  }

  // The app is committed — fade the boot splash (index.html) away.
  const splash = document.getElementById("splash");
  if (splash) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        splash.classList.add("out");
        window.setTimeout(() => splash.remove(), 300);
      }),
    );
  }
}

start();
