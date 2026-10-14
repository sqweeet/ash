import type { ITheme } from "@xterm/xterm";

// Theme + font presets and light-variant derivation. Extracted verbatim from
// settings.ts; self-contained (only depends on xterm's ITheme type).

export interface FontPreset {
  id: string;
  label: string;
  family: string;
}

export const FONTS: FontPreset[] = [
  {
    id: "geist-mono",
    label: "Geist Mono",
    family: '"Geist Mono", Consolas, monospace',
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    family: '"JetBrains Mono", Consolas, monospace',
  },
  {
    id: "cascadia-mono",
    label: "Cascadia Mono",
    family: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  },
  {
    id: "fira-code",
    label: "Fira Code",
    family: '"Fira Code", Consolas, monospace',
  },
  {
    id: "ibm-plex-mono",
    label: "IBM Plex Mono",
    family: '"IBM Plex Mono", Consolas, monospace',
  },
  {
    id: "source-code-pro",
    label: "Source Code Pro",
    family: '"Source Code Pro", Consolas, monospace',
  },
  {
    id: "inconsolata",
    label: "Inconsolata",
    family: '"Inconsolata", Consolas, monospace',
  },
  {
    id: "space-mono",
    label: "Space Mono",
    family: '"Space Mono", Consolas, monospace',
  },
  {
    id: "martian-mono",
    label: "Martian Mono",
    family: '"Martian Mono", Consolas, monospace',
  },
  {
    id: "consolas",
    label: "Consolas",
    family: "Consolas, monospace",
  },
];

/** App-chrome colors driven by the active theme. */
export interface AppPalette {
  bg: string;
  surface: string;
  raise: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  icon: string;
  hover: string;
}

export interface ThemePreset {
  id: string;
  label: string;
  app: AppPalette;
  theme: ITheme;
}

export const DEFAULT_THEME_ID = "gray";

export const THEMES: ThemePreset[] = [
  {
    id: DEFAULT_THEME_ID,
    label: "Gray",
    // Neutral gray chrome, not Graphite's monochrome ANSI ramp. Accents stay
    // recognizably colored, just quieter than Vercel Dark's saturated palette.
    app: {
      bg: "#181818",
      surface: "#202020",
      raise: "#2b2b2b",
      border: "rgba(255,255,255,0.09)",
      text: "#e4e4e4",
      muted: "#ababab",
      faint: "#818181",
      icon: "#bdbdbd",
      hover: "rgba(255,255,255,0.06)",
    },
    theme: {
      background: "#202020",
      foreground: "#dedede",
      cursor: "#dedede",
      cursorAccent: "#202020",
      selectionBackground: "rgba(255,255,255,0.16)",
      black: "#343434",
      red: "#d78989",
      green: "#a4bf91",
      yellow: "#d4bd88",
      blue: "#91aecb",
      magenta: "#b39ac1",
      cyan: "#8fbbbb",
      white: "#dedede",
      brightBlack: "#909090",
      brightRed: "#e6a3a3",
      brightGreen: "#b9d3a7",
      brightYellow: "#e3cfa4",
      brightBlue: "#acc6df",
      brightMagenta: "#cbb2d7",
      brightCyan: "#aad2d2",
      brightWhite: "#f0f0f0",
    },
  },
  {
    id: "vercel-dark",
    label: "Vercel Dark",
    app: {
      bg: "#000000",
      surface: "#060606",
      raise: "#161616",
      border: "rgba(255,255,255,0.09)",
      text: "#ededed",
      muted: "#a1a1a1",
      faint: "#6b6b6b",
      icon: "#b4b4b4",
      hover: "rgba(255,255,255,0.06)",
    },
    theme: {
      background: "#060606",
      foreground: "#ededed",
      cursor: "#ededed",
      cursorAccent: "#060606",
      selectionBackground: "rgba(255,255,255,0.16)",
      black: "#262626",
      red: "#ff6369",
      green: "#3fd68f",
      yellow: "#f2b83b",
      blue: "#52a8ff",
      magenta: "#bf7af0",
      cyan: "#29c8d8",
      white: "#ededed",
      brightBlack: "#666666",
      brightRed: "#ff8589",
      brightGreen: "#62e6a8",
      brightYellow: "#ffd166",
      brightBlue: "#75bfff",
      brightMagenta: "#d29dff",
      brightCyan: "#56dfef",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "nord",
    label: "Nord",
    app: {
      bg: "#242933",
      surface: "#2b313d",
      raise: "#374050",
      border: "rgba(255,255,255,0.07)",
      text: "#e8ecf2",
      muted: "#98a2b4",
      faint: "#5f6b85",
      icon: "#cfd7e3",
      hover: "rgba(255,255,255,0.05)",
    },
    theme: {
      background: "#2b313d",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      cursorAccent: "#2b313d",
      selectionBackground: "rgba(76,86,106,0.75)",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  {
    id: "one-dark",
    label: "One Dark",
    app: {
      bg: "#21252b",
      surface: "#282c34",
      raise: "#333842",
      border: "rgba(255,255,255,0.07)",
      text: "#d7dae0",
      muted: "#9da5b4",
      faint: "#636d83",
      icon: "#b6bdca",
      hover: "rgba(255,255,255,0.05)",
    },
    theme: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      cursorAccent: "#282c34",
      selectionBackground: "rgba(62,68,81,0.99)",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "github-dark",
    label: "GitHub Dark",
    app: {
      bg: "#0d1117",
      surface: "#161b22",
      raise: "#262c36",
      border: "rgba(240,246,252,0.1)",
      text: "#e6edf3",
      muted: "#9ea7b3",
      faint: "#767f89",
      icon: "#b6c0cc",
      hover: "rgba(177,186,196,0.08)",
    },
    theme: {
      background: "#161b22",
      foreground: "#e6edf3",
      cursor: "#e6edf3",
      cursorAccent: "#161b22",
      selectionBackground: "rgba(56,139,253,0.3)",
      black: "#484f58",
      red: "#ff7b72",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#58a6ff",
      magenta: "#bc8cff",
      cyan: "#39c5cf",
      white: "#b1bac4",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#56d364",
      brightYellow: "#e3b341",
      brightBlue: "#79c0ff",
      brightMagenta: "#d2a8ff",
      brightCyan: "#56d4dd",
      brightWhite: "#f0f6fc",
    },
  },
  {
    id: "raycast",
    label: "Raycast",
    app: {
      bg: "#09090b",
      surface: "#161619",
      raise: "#222227",
      border: "rgba(255,255,255,0.09)",
      text: "#f2f2f3",
      muted: "#9c9ca4",
      faint: "#63636c",
      icon: "#bababf",
      hover: "rgba(255,255,255,0.06)",
    },
    theme: {
      background: "#161619",
      foreground: "#f0f0f1",
      cursor: "#ff6363",
      cursorAccent: "#161619",
      selectionBackground: "rgba(255,99,99,0.24)",
      black: "#26262b",
      red: "#ff6363",
      green: "#4ef8a7",
      yellow: "#ffc531",
      blue: "#56c2ff",
      magenta: "#cf2f98",
      cyan: "#52eee5",
      white: "#e6e6e8",
      brightBlack: "#63636c",
      brightRed: "#ff8484",
      brightGreen: "#7cfabf",
      brightYellow: "#ffd60a",
      brightBlue: "#72d3ff",
      brightMagenta: "#e065b8",
      brightCyan: "#84f5ee",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "linear",
    label: "Linear",
    app: {
      bg: "#0f1014",
      surface: "#16171d",
      raise: "#22232b",
      border: "rgba(255,255,255,0.08)",
      text: "#e6e6ea",
      muted: "#9b9ca8",
      faint: "#63646f",
      icon: "#c0c1cc",
      hover: "rgba(140,150,255,0.07)",
    },
    theme: {
      background: "#16171d",
      foreground: "#e6e6ea",
      cursor: "#8a8fff",
      cursorAccent: "#16171d",
      selectionBackground: "rgba(94,106,210,0.28)",
      black: "#22232b",
      red: "#eb5757",
      green: "#4cb782",
      yellow: "#f2c94c",
      blue: "#5e6ad2",
      magenta: "#b18aff",
      cyan: "#4ea1d3",
      white: "#d5d6df",
      brightBlack: "#63646f",
      brightRed: "#ff7a7a",
      brightGreen: "#63cd97",
      brightYellow: "#ffd968",
      brightBlue: "#8a8fff",
      brightMagenta: "#c9aaff",
      brightCyan: "#6fbce0",
      brightWhite: "#f0f0f4",
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    // Fully monochrome — grays/black/white only, zero hue. The ANSI slots are a
    // neutral lightness ramp so terminal output still has hierarchy without any
    // color (no green/red/blue tint anywhere).
    app: {
      bg: "#0b0b0b",
      surface: "#151515",
      raise: "#202020",
      border: "rgba(255,255,255,0.08)",
      text: "#e6e6e6",
      muted: "#9d9d9d",
      faint: "#666666",
      icon: "#b3b3b3",
      hover: "rgba(255,255,255,0.055)",
    },
    theme: {
      background: "#151515",
      foreground: "#e2e2e2",
      cursor: "#e2e2e2",
      cursorAccent: "#151515",
      selectionBackground: "rgba(255,255,255,0.14)",
      black: "#2a2a2a",
      red: "#8c8c8c",
      green: "#bcbcbc",
      yellow: "#d4d4d4",
      blue: "#9a9a9a",
      magenta: "#ababab",
      cyan: "#c6c6c6",
      white: "#dedede",
      brightBlack: "#6a6a6a",
      brightRed: "#a6a6a6",
      brightGreen: "#d8d8d8",
      brightYellow: "#ececec",
      brightBlue: "#b6b6b6",
      brightMagenta: "#c8c8c8",
      brightCyan: "#e0e0e0",
      brightWhite: "#f5f5f5",
    },
  },
  {
    id: "notion",
    label: "Notion",
    app: {
      bg: "#191919",
      surface: "#202020",
      raise: "#2c2c2c",
      border: "rgba(255,255,255,0.09)",
      text: "#e9e8e4",
      muted: "#9b9a95",
      faint: "#6f6e69",
      icon: "#c2c1bb",
      hover: "rgba(255,255,255,0.055)",
    },
    theme: {
      background: "#202020",
      foreground: "#e9e8e4",
      cursor: "#e9e8e4",
      cursorAccent: "#202020",
      selectionBackground: "rgba(255,255,255,0.14)",
      black: "#2c2c2c",
      red: "#ff7369",
      green: "#4dab9a",
      yellow: "#ffa344",
      blue: "#529cca",
      magenta: "#9a6dd7",
      cyan: "#4dab9a",
      white: "#d4d3ce",
      brightBlack: "#6f6e69",
      brightRed: "#ff8f86",
      brightGreen: "#63c3b1",
      brightYellow: "#ffb865",
      brightBlue: "#6fb2dd",
      brightMagenta: "#b088e6",
      brightCyan: "#63c3b1",
      brightWhite: "#f1f0ec",
    },
  },
  {
    id: "vesper",
    label: "Vesper",
    app: {
      bg: "#0a0a0a",
      surface: "#101010",
      raise: "#1c1c1c",
      border: "rgba(255,255,255,0.08)",
      text: "#ececec",
      muted: "#a0a0a0",
      faint: "#65645f",
      icon: "#b4b4b0",
      hover: "rgba(255,255,255,0.055)",
    },
    theme: {
      background: "#101010",
      foreground: "#ffffff",
      cursor: "#ffc799",
      cursorAccent: "#101010",
      selectionBackground: "#2a2a2a",
      black: "#101010",
      red: "#ff8080",
      green: "#99ffe4",
      yellow: "#ffc799",
      blue: "#a0a0a0",
      magenta: "#ff7300",
      cyan: "#99ffe4",
      white: "#ffffff",
      brightBlack: "#505050",
      brightRed: "#ff8080",
      brightGreen: "#99ffe4",
      brightYellow: "#ffcfa8",
      brightBlue: "#a0a0a0",
      brightMagenta: "#ff8080",
      brightCyan: "#99ffe4",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "homebrew",
    label: "Homebrew",
    app: {
      bg: "#000000",
      surface: "#040904",
      raise: "#0c1a0e",
      border: "rgba(75,217,104,0.16)",
      text: "#4bd968",
      muted: "#2e9247",
      faint: "#1d5e30",
      icon: "#3fc257",
      hover: "rgba(75,217,104,0.08)",
    },
    theme: {
      background: "#000000",
      foreground: "#3adb5a",
      cursor: "#4dff6a",
      cursorAccent: "#000000",
      selectionBackground: "rgba(74,222,110,0.22)",
      black: "#000000",
      red: "#e05a4d",
      green: "#33cc4e",
      yellow: "#c9c257",
      blue: "#4b8fd4",
      magenta: "#b06cc9",
      cyan: "#3ec5c7",
      white: "#c0d0c0",
      brightBlack: "#3f6b45",
      brightRed: "#ff7a6e",
      brightGreen: "#55f06e",
      brightYellow: "#ffff54",
      brightBlue: "#6a9fff",
      brightMagenta: "#e08ce8",
      brightCyan: "#54ffff",
      brightWhite: "#e6ffe6",
    },
  },
];

function presetOf(id: string): ThemePreset {
  // Keep previews and existing Ash Gray preferences compatible with the rename.
  const resolvedId = id === "ash-gray" ? DEFAULT_THEME_ID : id;
  return THEMES.find((t) => t.id === resolvedId) ?? THEMES[0];
}

// ── light variants ─────────────────────────────────────────
// Every theme gets a derived light ("white") version instead of hand-authored
// twins: neutrals are rebuilt around the theme's own hue, ANSI accents are
// darkened until they read on a light background.

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Keep the hue, cap the lightness — accents stay themselves but gain contrast. */
function darkenFor(hex: string | undefined, maxL: number, fallback: string): string {
  if (!hex || !hex.startsWith("#")) return fallback;
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, Math.min(l, maxL));
}

const lightCache = new Map<string, ThemePreset>();

function lightOf(p: ThemePreset): ThemePreset {
  const cached = lightCache.get(p.id);
  if (cached) return cached;
  const [h, s] = hexToHsl(p.app.bg);
  const tint = Math.min(s, 0.22);
  const app: AppPalette = {
    bg: hslToHex(h, tint, 0.94),
    surface: hslToHex(h, tint, 0.98),
    raise: hslToHex(h, tint, 1.0),
    border: "rgba(0,0,0,0.12)",
    text: hslToHex(h, Math.min(s, 0.3), 0.12),
    muted: hslToHex(h, Math.min(s, 0.2), 0.38),
    faint: hslToHex(h, Math.min(s, 0.15), 0.55),
    icon: hslToHex(h, Math.min(s, 0.2), 0.3),
    hover: "rgba(0,0,0,0.05)",
  };
  const t = p.theme;
  const light: ThemePreset = {
    ...p,
    app,
    theme: {
      background: app.surface,
      foreground: app.text,
      cursor: app.text,
      cursorAccent: app.surface,
      selectionBackground: "rgba(0,0,0,0.14)",
      // A neutral base must not acquire a red tint from HSL's zero hue.
      black: hslToHex(h, Math.min(s, 0.05), 0.25),
      red: darkenFor(t.red, 0.42, "#c62f3f"),
      green: darkenFor(t.green, 0.36, "#1e7d3c"),
      yellow: darkenFor(t.yellow, 0.38, "#9a6a00"),
      blue: darkenFor(t.blue, 0.42, "#1f6fd6"),
      magenta: darkenFor(t.magenta, 0.42, "#8a3fc0"),
      cyan: darkenFor(t.cyan, 0.36, "#0f7f8f"),
      white: hslToHex(h, Math.min(s, 0.05), 0.35),
      brightBlack: hslToHex(h, Math.min(s, 0.05), 0.45),
      brightRed: darkenFor(t.brightRed, 0.48, "#d64550"),
      brightGreen: darkenFor(t.brightGreen, 0.4, "#249447"),
      brightYellow: darkenFor(t.brightYellow, 0.44, "#b07d0a"),
      brightBlue: darkenFor(t.brightBlue, 0.48, "#3b82e0"),
      brightMagenta: darkenFor(t.brightMagenta, 0.48, "#9d55d1"),
      brightCyan: darkenFor(t.brightCyan, 0.42, "#159aad"),
      brightWhite: hslToHex(h, Math.min(s, 0.05), 0.1),
    },
  };
  lightCache.set(p.id, light);
  return light;
}

/** The active preset, honoring the global light-mode switch. */
export function resolvedPreset(themeId: string, lightMode: boolean): ThemePreset {
  const p = presetOf(themeId);
  return lightMode ? lightOf(p) : p;
}
