import type { ITheme } from "@xterm/xterm";
import { invoke } from "../backend/core";
import { homeDir } from "../backend/path";
import { toast } from "./toast";
import { DEFAULT_THEME_ID, FONTS, THEMES, resolvedPreset } from "./themes";
import type { ThinkingFormat } from "./agent-engine/thinking-config";
// Re-exported so existing `from "./settings"` importers (SettingsModal) keep working.
export { FONTS, THEMES };

export interface SectionToggles {
  commands: boolean;
  agents: boolean;
  ssh: boolean;
}

export type EnginePermissionMode = "full-auto" | "confirm";

// Model reasoning depth. "auto" sends no reasoning_effort (model's native
// default); "none" disables thinking; the rest map straight to the API's
// reasoning_effort value (verified accepted by GLM-5.2 on Fireworks).
export type ReasoningEffort = "auto" | "none" | "low" | "medium" | "high" | "max";

// Selectable context-window sizes for the model editor's slider.
export const CONTEXT_STOPS = [128_000, 200_000, 500_000, 1_000_000] as const;

export interface EngineModel {
  /** Stable local id. */
  id: string;
  /** Display name. */
  name: string;
  /** API model id sent to the provider. */
  modelId: string;
  /** Optional "fast" variant id, used when useFast is on. */
  fastId?: string;
  /** Context window in tokens (drives the battery gauge + compaction). */
  contextWindow: number;
  /** Whether the model accepts image inputs (else images are stripped). */
  supportsImages: boolean;
  /** Per-model thinking/reasoning format override. When set, the provider sends
   *  this shape instead of the family default — so a GLM on a proxy that only
   *  accepts reasoning_effort can use that, while one on raw Zhipu can use
   *  enable_thinking. Undefined = family heuristic (compat-safe default). */
  thinkingFormat?: ThinkingFormat;
  /** models.dev provider logo URL, set when the model is auto-detected. */
  logo?: string;
}

// An OpenAI-compatible endpoint the user has configured. Each provider carries
// its own model presets + key, so the user can keep several (Fireworks, a
// Cursor-style proxy, OpenRouter, …) and switch between them from the chat.
export interface EngineProvider {
  /** Stable local id. */
  id: string;
  /** Display name shown in Settings + the chat model picker. */
  name: string;
  /** OpenAI-compatible base URL (everything before /chat/completions). */
  baseUrl: string;
  apiKey: string;
  /** Model presets scoped to this provider. */
  models: EngineModel[];
}

export interface EngineSettings {
  /** User-managed providers. The active one is sent on every turn. */
  providers: EngineProvider[];
  activeProviderId: string;
  /** Active model id within the active provider. */
  activeModelId: string;
  /** Use the active model's fast variant when it has one. */
  useFast: boolean;
  permissionMode: EnginePermissionMode;
  /** Safe mode: writing background agents work in a sandbox copy of the project
   * and their changes are merged back only on the user's approval. */
  safeMode: boolean;
  /** Model reasoning depth (default for new chats; per-chat togglable in UI). */
  reasoningEffort: ReasoningEffort;
  /** Play a sound on task done / permission request. */
  sounds: boolean;
  /** OS notification on task done / permission request. */
  notifications: boolean;
}

/** The provider whose config is sent on every turn (first if the id dangles). */
export function activeProvider(s: Settings): EngineProvider {
  return (
    s.engine.providers.find((p) => p.id === s.engine.activeProviderId) ?? s.engine.providers[0]
  );
}

/** The active provider's active model (first if the id dangles). */
export function activeEngineModel(s: Settings): EngineModel | undefined {
  const p = activeProvider(s);
  return p?.models.find((m) => m.id === s.engine.activeModelId) ?? p?.models[0];
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
  /** What to wipe when the app quits: nothing, chats only, terminals only, or
   * both. Terminals aren't persisted (only live in memory), so clearing them
   * is a session teardown; chats are on-disk files deleted here. */
  clearOnExit: "none" | "chats" | "terminals" | "all";
  engine: EngineSettings;
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
  engine: {
    providers: [
      {
        id: "fireworks",
        name: "Fireworks",
        baseUrl: "https://api.fireworks.ai/inference/v1",
        apiKey: "",
        models: [
          {
            id: "glm-5p2",
            name: "GLM-5.2",
            modelId: "accounts/fireworks/models/glm-5p2",
            fastId: "accounts/fireworks/routers/glm-5p2-fast",
            contextWindow: 128_000,
            supportsImages: false,
          },
        ],
      },
    ],
    activeProviderId: "fireworks",
    activeModelId: "glm-5p2",
    useFast: true,
    permissionMode: "confirm",
    safeMode: false,
    reasoningEffort: "auto",
    sounds: true,
    notifications: true,
  },
};

export function fontFamily(s: Settings): string {
  return (FONTS.find((f) => f.id === s.font) ?? FONTS[0]).family;
}

export function terminalTheme(s: Settings): ITheme {
  const light = s.themeLight;
  return {
    ...resolvedPreset(s.theme, light).theme,
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

function normalizeReasoning(v: any): ReasoningEffort {
  return v === "none" || v === "low" || v === "medium" || v === "high" || v === "max" ? v : "auto";
}

function normalizeModels(arr: any[]): EngineModel[] {
  return arr
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      id: String(m.id ?? crypto.randomUUID()),
      name: String(m.name ?? "Model"),
      modelId: String(m.modelId ?? ""),
      fastId: m.fastId ? String(m.fastId) : undefined,
      contextWindow: Number(m.contextWindow) || 128_000,
      supportsImages: !!m.supportsImages,
      thinkingFormat: m.thinkingFormat,
      logo: m.logo ? String(m.logo) : undefined,
    }));
}

function normalizeProviders(arr: any[]): EngineProvider[] {
  return arr
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      id: String(p.id ?? crypto.randomUUID()),
      name: String(p.name ?? "Provider"),
      baseUrl: String(p.baseUrl ?? ""),
      apiKey: String(p.apiKey ?? ""),
      models: Array.isArray(p.models) ? normalizeModels(p.models) : [],
    }));
}

function defaultProviders(): EngineProvider[] {
  return DEFAULT_SETTINGS.engine.providers.map((p) => ({ ...p, models: p.models.map((m) => ({ ...m })) }));
}

/** Fold a parsed `engine` blob (which may be the new multi-provider shape OR a
 * legacy single-provider shape) into a valid EngineSettings. Legacy state is
 * migrated into one provider so the user keeps their old key + models. */
function mergeEngine(parsedEngine: any): EngineSettings {
  const common: EngineSettings = {
    ...DEFAULT_SETTINGS.engine,
    useFast: parsedEngine?.useFast ?? false,
    permissionMode: parsedEngine?.permissionMode === "full-auto" ? "full-auto" : "confirm",
    safeMode: !!parsedEngine?.safeMode,
    reasoningEffort: normalizeReasoning(parsedEngine?.reasoningEffort),
    sounds: parsedEngine?.sounds ?? true,
    notifications: parsedEngine?.notifications ?? true,
  };

  // New shape: a providers array is present.
  if (parsedEngine && Array.isArray(parsedEngine.providers)) {
    const providers = normalizeProviders(parsedEngine.providers);
    if (providers.length === 0)
      return { ...common, providers: defaultProviders(), activeProviderId: DEFAULT_SETTINGS.engine.activeProviderId, activeModelId: DEFAULT_SETTINGS.engine.activeModelId };
    const activeProviderId = providers.some((p) => p.id === parsedEngine.activeProviderId)
      ? parsedEngine.activeProviderId
      : providers[0].id;
    const ap = providers.find((p) => p.id === activeProviderId)!;
    const activeModelId = ap.models.some((m) => m.id === parsedEngine.activeModelId)
      ? parsedEngine.activeModelId
      : (ap.models[0]?.id ?? "");
    return { ...common, providers, activeProviderId, activeModelId };
  }

  // Legacy shape (pre multi-provider): fold openaiCompat + the global model
  // list into a single provider. anthropic was never wired up (config.ts threw
  // on it), so it's dropped here rather than carried as dead state.
  const old = parsedEngine ?? {};
  if (!old.openaiCompat && !Array.isArray(old.models))
    return { ...common, providers: defaultProviders(), activeProviderId: DEFAULT_SETTINGS.engine.activeProviderId, activeModelId: DEFAULT_SETTINGS.engine.activeModelId };

  const baseUrl = String(old.openaiCompat?.baseUrl ?? DEFAULT_SETTINGS.engine.providers[0].baseUrl);
  const apiKey = String(old.openaiCompat?.apiKey ?? "");
  const models: EngineModel[] = Array.isArray(old.models) && old.models.length
    ? normalizeModels(old.models)
    : [
        {
          id: "migrated",
          name: String(old.openaiCompat?.model ?? "").split("/").pop() || "Model",
          modelId: String(old.openaiCompat?.model ?? ""),
          contextWindow: 128_000,
          supportsImages: false,
        },
      ];
  const activeModelId = models.some((m) => m.id === old.activeModelId) ? old.activeModelId : (models[0]?.id ?? "");
  return {
    ...common,
    providers: [{ id: "migrated", name: "OpenAI-compatible", baseUrl, apiKey, models }],
    activeProviderId: "migrated",
    activeModelId,
  };
}

function mergeParsed(parsed: any): Settings {
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...parsed,
    sections: { ...DEFAULT_SETTINGS.sections, ...(parsed.sections ?? {}) },
    engine: mergeEngine(parsed?.engine),
  };
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
      current = mergeParsed(JSON.parse(text));
    } catch {
      // keep defaults on a corrupt file
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
  // Debounce the disk write: API key / base URL / model-id fields call this per
  // keystroke, and each call otherwise serialized + wrote the whole file (with
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
