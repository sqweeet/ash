import type { ITheme } from "@xterm/xterm";
import { invoke } from "../backend/core";
import { homeDir } from "../backend/path";
import { toast } from "./toast";
import { DEFAULT_THEME_ID, FONTS, THEMES, resolvedPreset } from "./themes";
// Re-exported so existing `from "./settings"` importers (SettingsModal) keep working.
export { FONTS, THEMES };

export interface SectionToggles {
  commands: boolean;
  agents: boolean;
  ssh: boolean;
}

export interface Settings {
  theme: string;
  /** Use the theme's derived light ("white") variant. */
  themeLight: boolean;
  font: string;
  fontSize: number;
  /** Whole-UI scale (1 = 100%). Applied as a zoom on the app root. */
  uiScale: number;
  /** Inset of the xterm viewport inside its pane — the visible gap between the
   * app surface and the terminal grid. Driven by --term-pad CSS var. */
  termPad: number;
  /** Corner radius of the terminal pane. Driven by --term-radius CSS var. */
  termRadius: number;
  explorerSide: "left" | "right";
  sidebarWidth: number;
  explorerWidth: number;
  sections: SectionToggles;
  /** What to wipe when the app quits: nothing, or the terminals. Terminals
   * aren't persisted (only live in memory), so clearing them is a session
   * teardown. */
  clearOnExit: "none" | "terminals";
}

export const DEFAULT_FONT_SIZE = 13;

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME_ID,
  themeLight: false,
  font: "geist-mono",
  fontSize: DEFAULT_FONT_SIZE,
  uiScale: 1.0,
  termPad: 10,
  termRadius: 18,
  explorerSide: "right",
  sidebarWidth: 190,
  explorerWidth: 230,
  sections: { commands: true, agents: false, ssh: false },
  clearOnExit: "none",
};

export function fontFamily(s: Settings): string {
  return (FONTS.find((f) => f.id === s.font) ?? FONTS[0]).family;
}

export function terminalTheme(s: Settings): ITheme {
  const light = s.themeLight;
  return {
    ...resolvedPreset(s.theme, light).theme,
    // The custom scrollbar width also enables xterm's ruler. Hide its white outline.
    overviewRulerBorder: "#00000000",
    scrollbarSliderBackground: light ? "rgba(0, 0, 0, 0.16)" : "rgba(255, 255, 255, 0.12)",
    scrollbarSliderHoverBackground: light ? "rgba(0, 0, 0, 0.28)" : "rgba(255, 255, 255, 0.22)",
    scrollbarSliderActiveBackground: light ? "rgba(0, 0, 0, 0.36)" : "rgba(255, 255, 255, 0.3)",
  };
}

/** Push the active theme's palette into CSS custom properties on :root. */
export function applyAppTheme(themeId: string) {
  const p = resolvedPreset(themeId, current.themeLight).app;
  const root = document.documentElement.style;
  root.setProperty("--bg", p.bg);
  root.setProperty("--surface", p.surface);
  root.setProperty("--raise", p.raise);
  root.setProperty("--border", p.border);
  root.setProperty("--text", p.text);
  root.setProperty("--muted", p.muted);
  root.setProperty("--faint", p.faint);
  root.setProperty("--icon", p.icon);
  root.setProperty("--hover", p.hover);
  // Theme-aware shadow color: on light themes the text color is dark and reads
  // as a soft cast shadow (not a sooty black blob — a flat #000 drop reads as
  // dirt on light surfaces); on dark themes plain black blends with the
  // already-dark backdrop so a lift reads without a hard edge.
  root.setProperty("--shadow", current.themeLight ? p.text : "#000000");
  // Terminal pane inset + corner radius (Settings > Terminal). The .pane uses
  // these so the gap between the app surface and the xterm grid is tunable.
  root.setProperty("--term-pad", `${current.termPad}px`);
  root.setProperty("--term-radius", `${current.termRadius}px`);
  // the html element paints the area behind everything (startup, overscroll)
  root.setProperty("background", p.bg);
  root.setProperty("color-scheme", current.themeLight ? "light" : "dark");
}

/** Push the whole-UI scale into the --ui-zoom custom property (see .app). */
export function applyUiScale() {
  document.documentElement.style.setProperty("--ui-zoom", String(current.uiScale));
}

// Settings live in ~/.ash/settings.json (a real, editable file), not the old
// localStorage blob. Loaded once at startup into `current`; the read API stays
// synchronous, writes are async fire-and-forget.
const LEGACY_KEY = "spark.settings";
let current: Settings = { ...DEFAULT_SETTINGS };
let settingsPath: string | null = null;

function mergeParsed(parsed: any): Settings {
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...parsed,
    sections: { ...DEFAULT_SETTINGS.sections, ...(parsed.sections ?? {}) },
  };
  // The built-in agent is gone: drop its block (providers + API keys) so the
  // keys don't linger in settings.json. loadSettings rewrites the file.
  delete (merged as any).engine;
  // "chats"/"all" cleared the agent's saved chats too; only terminals remain.
  if ((merged.clearOnExit as string) === "all") merged.clearOnExit = "terminals";
  else if (merged.clearOnExit !== "terminals") merged.clearOnExit = "none";
  // migrate older defaults to the current, slimmer one
  if (merged.sidebarWidth === 168 || merged.sidebarWidth === 216)
    merged.sidebarWidth = DEFAULT_SETTINGS.sidebarWidth;
  // Ash Gray was renamed to Gray. Preserve all other saved preferences.
  if (merged.theme === "ash-gray") merged.theme = DEFAULT_THEME_ID;
  // Removed/unknown presets use the current default; existing choices stay put.
  if (!THEMES.some((t) => t.id === merged.theme))
    merged.theme = DEFAULT_THEME_ID;
  return merged;
}

/** Load settings from ~/.ash/settings.json (migrating the old localStorage
 * store on first run). Call once at startup before the first render. */
export async function loadSettings(): Promise<void> {
  try {
    settingsPath = (await homeDir()).replace(/[\\/]+$/, "") + "\\.ash\\settings.json";
  } catch {
    settingsPath = null;
  }
  let text: string | null = null;
  if (settingsPath) {
    try {
      text = await invoke<string | null>("read_text", { path: settingsPath });
    } catch {
      text = null;
    }
  }
  if (text == null) {
    // migrate the old localStorage store, if present
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        text = legacy;
        if (settingsPath)
          invoke("write_text", { path: settingsPath, contents: legacy }).catch(() => {});
      }
    } catch {
      // ignore
    }
  }
  if (text) {
    try {
      const parsed = JSON.parse(text);
      current = mergeParsed(parsed);
      // scrub the removed agent's API keys from disk right away
      if (parsed && typeof parsed === "object" && "engine" in parsed) persistSettings();
    } catch {
      // keep defaults on a corrupt file
    }
  }
}

/** Full reset: delete the on-disk app data under ~/.ash/ (settings, plus the
 * removed agent's leftover chats) — skills are left alone. localStorage is
 * cleared by the caller. */
export async function resetAshData(): Promise<void> {
  let base = "";
  try {
    base = (await homeDir()).replace(/[\\/]+$/, "") + "\\.ash";
  } catch {
    return;
  }
  for (const p of [`${base}\\chats`, `${base}\\settings.json`]) {
    try {
      await invoke("delete_path", { path: p });
    } catch {
      // missing / already gone — fine
    }
  }
}

const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

let persistTimer: number | undefined;
function persistSettings() {
  if (!settingsPath) return;
  invoke("write_text", {
    path: settingsPath,
    contents: JSON.stringify(current, null, 2),
  }).catch((e) => {
    // A silently-swallowed write left the user believing a change saved when it
    // hadn't — surface it instead.
    console.error("Failed to persist settings:", e);
    toast("Couldn't save settings to disk");
  });
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  // Debounce the disk write: text fields call this per keystroke, and each call otherwise serialized + wrote the whole file (with
  // rapid writes able to resolve out of order). In-memory state + listeners
  // update synchronously so the UI and live terminals stay responsive.
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistSettings, 250);
  if (patch.theme || patch.themeLight !== undefined || patch.termPad !== undefined || patch.termRadius !== undefined) applyAppTheme(current.theme);
  if (patch.uiScale !== undefined) applyUiScale();
  listeners.forEach((fn) => fn(current));
}

// Flush a pending debounced write before the app closes/reloads so the last
// change isn't lost (best-effort — the async invoke is at least dispatched).
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", () => {
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer);
      persistSettings();
    }
  });

export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
