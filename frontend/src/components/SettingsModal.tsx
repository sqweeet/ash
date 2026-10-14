import { useEffect, useRef, useState } from "react";

interface SelectOption {
  value: string;
  label: string;
}

// Custom dropdown replacing native <select> so the popup can be a squircle
// surface that opens with the same pop the rest of the app uses (native
// selects can't be styled past their trigger). Fixed-positioned from the
// trigger's rect so it isn't clipped by the settings scroll container.
function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, w: 208, h: 32 });
  const trigRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const openMenu = () => {
    // Position the menu ON the trigger (same top-left) and capture its size —
    // the menu then grows from the trigger's own rect (clip-path reveal), not
    // as a separate popup appearing below it.
    const r = trigRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.top, w: r.width, h: r.height });
    setClosing(false);
    setOpen(true);
  };
  const closeMenu = () => {
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 140);
  };
  const pick = (v: string) => {
    onChange(v);
    closeMenu();
  };

  // Escape closes; everything else is handled by the backdrop / option clicks.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className="ash-select">
      <button
        ref={trigRef}
        type="button"
        className={`ash-select-trigger${open ? " open" : ""}`}
        onClick={() => (open ? closeMenu() : openMenu())}
      >
        <span className="ash-select-value">{selected?.label}</span>
        <svg
          className={`ash-select-chev${open ? " open" : ""}`}
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onMouseDown={closeMenu} />
          <div
            className={`ash-select-menu${closing ? " closing" : ""}`}
            style={{
              left: pos.left,
              top: pos.top,
              "--tw": `${pos.w}px`,
              "--th": `${pos.h}px`,
            } as React.CSSProperties}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={o.value === value ? "sel" : ""}
                onClick={() => pick(o.value)}
              >
                <span className="ash-select-opt-name">{o.label}</span>
                {o.value === value && (
                  <svg
                    className="ash-select-check"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Numeric stepper with custom arrow buttons — replaces the ugly native
// number-input spinners (browser-default, old-looking) with a text field
// plus styled up/down chevrons. Type a value or nudge with the arrows.
function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const [text, setText] = useState(String(value));
  // Keep the text in sync when the value changes from outside (e.g. Ctrl+0).
  useEffect(() => setText(String(value)), [value]);
  const commit = (t: string) => {
    const v = Number(t);
    if (Number.isFinite(v)) {
      const c = clamp(Math.round(v));
      setText(String(c));
      onChange(c);
    } else {
      setText(String(value));
    }
  };
  return (
    <div className="stepper">
      <input
        type="text"
        inputMode="numeric"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const c = clamp(value + 1);
            onChange(c);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const c = clamp(value - 1);
            onChange(c);
          }
        }}
      />
      <div className="stepper-btns">
        <button
          type="button"
          className="stepper-btn"
          title="Increase"
          disabled={value >= max}
          onClick={() => onChange(clamp(value + 1))}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <button
          type="button"
          className="stepper-btn"
          title="Decrease"
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1))}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

import {
  FONTS,
  THEMES,
  getSettings,
  updateSettings,
  Settings,
  SectionToggles,
  CONTEXT_STOPS,
  DEFAULT_SETTINGS,
  EngineModel,
  EngineProvider,
} from "../lib/settings";
import type { ThinkingFormat } from "../lib/agent-engine/thinking-config";
import { invoke } from "../backend/core";
import { resetAshData } from "../lib/chat-store";
import { loadModelsDev, lookupModel, providerLogo, modelLogo } from "../lib/models-dev";
import type { ModelInfo } from "../lib/models-dev";

interface SettingsModalProps {
  onClose: () => void;
}

const APPEARANCE_ICON = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);
const LAYOUT_ICON = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
  </svg>
);
const SECTIONS_ICON = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
const TERMINAL_ICON = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m4 17 6-6-6-6" />
    <path d="M12 19h8" />
  </svg>
);
const AGENTS_ICON = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4M8 16h.01M16 16h.01" />
  </svg>
);
const SHORTCUTS_ICON = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <path d="M9 9h.01M15 15h.01" />
  </svg>
);
const ABOUT_ICON = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

const CATEGORIES = [
  { id: "appearance", label: "Appearance" },
  { id: "layout", label: "Layout" },
  { id: "sections", label: "Sidebar sections" },
  { id: "terminal", label: "Terminal" },
  { id: "agents", label: "Agents" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "about", label: "About" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

const SETTING_SEARCH_ITEMS: { key: string; cat: CategoryId; label: string; hint: string; keywords?: string }[] = [
  { key: "theme", cat: "appearance", label: "Theme", hint: "Colors for the whole app and terminal", keywords: "color dark light" },
  { key: "themeLight", cat: "appearance", label: "Light mode", hint: "Use the theme's white variant", keywords: "white bright" },
  { key: "uiScale", cat: "appearance", label: "Interface scale", hint: "Zoom the whole UI", keywords: "ui size zoom percent" },
  { key: "font", cat: "appearance", label: "Terminal font", hint: "Font family for terminal text", keywords: "mono geist jetbrains fira ibm plex source code inconsolata space martian" },
  { key: "fontSize", cat: "appearance", label: "Font size", hint: "Terminal font size", keywords: "ctrl plus minus" },
  { key: "explorerSide", cat: "layout", label: "Explorer side", hint: "File tree position", keywords: "files sidebar left right" },
  { key: "sections.commands", cat: "sections", label: "Commands", hint: "Quick-launch commands section", keywords: "sidebar quick launch" },
  { key: "sections.agents", cat: "sections", label: "Agents", hint: "Detected CLI agents section", keywords: "claude codex sidebar" },
  { key: "sections.ssh", cat: "sections", label: "SSH", hint: "SSH hosts section", keywords: "hosts config remote" },
  { key: "termPad", cat: "terminal", label: "Padding", hint: "Space between the app surface and terminal grid", keywords: "gap inset spacing пробел отступ" },
  { key: "termRadius", cat: "terminal", label: "Corner radius", hint: "Rounding of terminal pane corners", keywords: "round radius скругление" },
  { key: "clearOnExit", cat: "terminal", label: "Clear on exit", hint: "Wipe chats or terminals when the app quits", keywords: "reset delete cleanup quit close" },
  { key: "engine.permissionMode", cat: "agents", label: "Permission mode", hint: "Confirm risky actions or full auto", keywords: "approval bash file edits" },
  { key: "engine.sounds", cat: "agents", label: "Sound", hint: "Chime when a task finishes or needs approval", keywords: "audio notification ding" },
  { key: "engine.notifications", cat: "agents", label: "Notifications", hint: "System notification when the window isn’t focused", keywords: "toast alert" },
  { key: "providers", cat: "agents", label: "Providers", hint: "OpenAI-compatible endpoints", keywords: "api base url key openrouter fireworks" },
  { key: "models", cat: "agents", label: "Models", hint: "Active model, context window, vision and fast variant", keywords: "glm grok claude gpt gemini reasoning context" },
  { key: "shortcuts", cat: "shortcuts", label: "Shortcuts", hint: "Keyboard shortcuts", keywords: "hotkeys keybindings ctrl alt" },
  { key: "reset", cat: "about", label: "Reset everything", hint: "Delete chats and reset app data", keywords: "factory default wipe" },
];

function RestoreButton({
  show,
  onClick,
}: {
  show: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`setting-restore${show ? " show" : ""}`}
      title="Restore default"
      aria-label="Restore default"
      disabled={!show}
      onClick={onClick}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M18.364 3.05762C18.7782 3.05762 19.114 3.3934 19.114 3.80762V8.05026C19.114 8.46447 18.7782 8.80026 18.364 8.80026H14.1213C13.7071 8.80026 13.3713 8.46447 13.3713 8.05026C13.3713 7.63604 13.7071 7.30026 14.1213 7.30026H16.4817C13.6363 5.05718 9.4987 5.24825 6.87348 7.87348C4.04217 10.7048 4.04217 15.2952 6.87348 18.1265C9.70478 20.9578 14.2952 20.9578 17.1265 18.1265C19.0234 16.2297 19.6504 13.5428 19.0039 11.1219C18.897 10.7217 19.1348 10.3106 19.535 10.2038C19.9352 10.0969 20.3462 10.3347 20.4531 10.7349C21.2321 13.6518 20.478 16.8964 18.1872 19.1872C14.7701 22.6043 9.2299 22.6043 5.81282 19.1872C2.39573 15.7701 2.39573 10.2299 5.81282 6.81282C9.04483 3.5808 14.1762 3.40576 17.614 6.28768V3.80762C17.614 3.3934 17.9497 3.05762 18.364 3.05762Z"
          fill="currentColor"
        />
      </svg>
    </button>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className={`switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  );
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>(getSettings());
  const [cat, setCat] = useState<CategoryId>("appearance");
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Build version comes from the Go AppInfo binding (ldflags -X Version=…),
  // not a hardcoded string — so About reflects the real shipped release.
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    invoke<Record<string, string>>("app_info")
      .then((info) => setAppVersion(info?.version ?? ""))
      .catch(() => setAppVersion(""));
  }, []);
  const [modelEdit, setModelEdit] = useState<EngineModel | null>(null);
  // models.dev auto-detect: the match for the edited model id, and whether the
  // catalog has loaded (so the model list can resolve logos). initialModelId
  // lets us fill fields only when the id is CHANGED, never on merely opening one.
  const [modelDetect, setModelDetect] = useState<ModelInfo | null>(null);
  const [catReady, setCatReady] = useState(false);
  const initialModelId = useRef("");
  const [modelIsNew, setModelIsNew] = useState(false);
  const [providerEdit, setProviderEdit] = useState<EngineProvider | null>(null);
  const [providerIsNew, setProviderIsNew] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [searchPos, setSearchPos] = useState({ left: 0, top: 0, w: 196, h: 32 });

  const doReset = async () => {
    setResetting(true);
    try {
      await resetAshData();
    } finally {
      // wipe the rest (workspaces, pins, commands, ssh, legacy blobs) and restart
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
      window.location.reload();
    }
  };

  const apply = (patch: Partial<Settings>) => {
    updateSettings(patch);
    setSettings(getSettings());
  };

  // ── providers + models ───────────────────────────────────────
  const ctxLabel = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}K`);
  const providers = settings.engine.providers;
  const activeProv =
    providers.find((p) => p.id === settings.engine.activeProviderId) ?? providers[0];
  const models = activeProv?.models ?? [];
  const activeModel = models.find((m) => m.id === settings.engine.activeModelId);

  const setProviders = (list: EngineProvider[], patch?: Partial<Settings["engine"]>) =>
    apply({ engine: { ...settings.engine, providers: list, ...(patch ?? {}) } });

  // Switching provider also jumps to that provider's first model so the
  // resolver never silently falls back to a model that doesn't exist there.
  const setActiveProvider = (id: string) => {
    const p = providers.find((x) => x.id === id);
    apply({
      engine: { ...settings.engine, activeProviderId: id, activeModelId: p?.models[0]?.id ?? "" },
    });
  };
  const openAddProvider = () => {
    setProviderIsNew(true);
    setProviderEdit({ id: crypto.randomUUID(), name: "", baseUrl: "", apiKey: "", models: [] });
  };
  const openEditProvider = (p: EngineProvider) => {
    setProviderIsNew(false);
    setProviderEdit({ ...p });
  };
  const saveProvider = () => {
    if (!providerEdit || !providerEdit.name.trim() || !providerEdit.baseUrl.trim()) return;
    const clean: EngineProvider = {
      ...providerEdit,
      name: providerEdit.name.trim(),
      baseUrl: providerEdit.baseUrl.trim(),
    };
    const list = providerIsNew
      ? [...providers, clean]
      : providers.map((p) => (p.id === clean.id ? clean : p));
    // Adding a brand-new provider also makes it active so the user can start
    // filling in its models immediately.
    const patch: Partial<Settings["engine"]> = providerIsNew
      ? { activeProviderId: clean.id, activeModelId: clean.models[0]?.id ?? "" }
      : {};
    setProviders(list, patch);
    setProviderEdit(null);
  };
  const removeProvider = (id: string) => {
    if (providers.length <= 1) return;
    const list = providers.filter((p) => p.id !== id);
    const patch: Partial<Settings["engine"]> = {};
    if (settings.engine.activeProviderId === id) {
      patch.activeProviderId = list[0].id;
      patch.activeModelId = list[0].models[0]?.id ?? "";
    }
    setProviders(list, patch);
  };

  // Models are scoped to the active provider — edits rewrite that provider's
  // slice of the providers list.
  const setModels = (list: EngineModel[], activeId?: string) => {
    if (!activeProv) return;
    const nextProviders = providers.map((p) =>
      p.id === activeProv.id ? { ...p, models: list } : p,
    );
    setProviders(nextProviders, activeId ? { activeModelId: activeId } : {});
  };
  const openAddModel = () => {
    setModelIsNew(true);
    initialModelId.current = "";
    setModelDetect(null);
    setModelEdit({ id: crypto.randomUUID(), name: "", modelId: "", contextWindow: 128_000, supportsImages: false });
  };
  const openEditModel = (m: EngineModel) => {
    setModelIsNew(false);
    initialModelId.current = m.modelId;
    setModelDetect(null);
    setModelEdit({ ...m });
  };
  const saveModel = () => {
    if (!modelEdit || !modelEdit.name.trim() || !modelEdit.modelId.trim()) return;
    const clean: EngineModel = {
      ...modelEdit,
      name: modelEdit.name.trim(),
      modelId: modelEdit.modelId.trim(),
      fastId: modelEdit.fastId?.trim() || undefined,
    };
    const list = modelIsNew ? [...models, clean] : models.map((m) => (m.id === clean.id ? clean : m));
    setModels(list, modelIsNew ? clean.id : undefined);
    setModelEdit(null);
  };
  const removeModel = (id: string) => {
    const list = models.filter((m) => m.id !== id);
    if (!list.length) return;
    setModels(list, settings.engine.activeModelId === id ? list[0].id : undefined);
  };
  const setActiveModel = (id: string) => apply({ engine: { ...settings.engine, activeModelId: id } });

  // Load the models.dev catalog once (for logos + auto-detect); silent if offline.
  useEffect(() => {
    loadModelsDev()
      .then(() => setCatReady(true))
      .catch(() => {});
  }, []);

  // Auto-detect context window / vision / logo from models.dev by the edited
  // model's id (debounced). Fills the fields when the id is CHANGED; on merely
  // opening an existing model it only refreshes the derived logo, never clobbers
  // a saved context window.
  const editModelId = modelEdit?.modelId ?? "";
  useEffect(() => {
    const q = editModelId.trim();
    if (!q) {
      setModelDetect(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        await loadModelsDev();
      } catch {
        return; // offline / failed — skip silently
      }
      if (!alive) return;
      const info = lookupModel(q);
      setModelDetect(info);
      const changed = q !== initialModelId.current;
      setModelEdit((cur) => {
        if (!cur || cur.modelId.trim() !== q) return cur;
        if (!info) return cur.logo ? { ...cur, logo: undefined } : cur;
        return {
          ...cur,
          logo: providerLogo(info.provider),
          ...(changed
            ? {
                contextWindow: info.contextWindow,
                supportsImages: info.supportsImages,
                name: cur.name.trim() ? cur.name : info.name,
              }
            : {}),
        };
      });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editModelId]);

  const applySection = (key: keyof SectionToggles, value: boolean) => {
    apply({ sections: { ...settings.sections, [key]: value } });
  };

  // Esc dismisses the topmost open sub-modal first (edit-model or reset), and
  // only closes the whole settings page when none is open.
  const resetOpenRef = useRef(resetOpen);
  resetOpenRef.current = resetOpen;
  const modelEditRef = useRef(modelEdit);
  modelEditRef.current = modelEdit;
  const providerEditRef = useRef(providerEdit);
  providerEditRef.current = providerEdit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (modelEditRef.current) setModelEdit(null);
      else if (providerEditRef.current) setProviderEdit(null);
      else if (resetOpenRef.current) setResetOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const searchQuery = search.trim().toLowerCase();
  const searchResults = searchQuery
    ? SETTING_SEARCH_ITEMS.filter((item) =>
        `${item.label} ${item.hint} ${item.keywords ?? ""} ${CATEGORIES.find((c) => c.id === item.cat)?.label ?? ""}`
          .toLowerCase()
          .includes(searchQuery),
      )
    : [];
  const visibleSearchResults = searchResults.slice(0, 8);
  useEffect(() => setSearchIndex(0), [searchQuery]);
  const jumpToSearchResult = (item: (typeof SETTING_SEARCH_ITEMS)[number]) => {
    setCat(item.cat);
    setSearch("");
    setSearchActive(false);
    setHighlightKey(item.key);
    window.setTimeout(() => setHighlightKey((cur) => (cur === item.key ? null : cur)), 1200);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.querySelector(`[data-setting-key="${item.key}"]`)?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      });
    });
  };

  return (
    <div className="settings-page">
      <nav className="settings-nav" data-window-drag>
        <button
          className="settings-back"
          onClick={onClose}
          title="Back (Esc)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="settings-search-wrap" data-window-drag>
          <div className={`settings-search${searchQuery && searchActive ? " open" : ""}`} ref={searchRef}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              spellCheck={false}
              onFocus={() => {
                setSearchActive(true);
                const r = searchRef.current?.getBoundingClientRect();
                if (r) setSearchPos({ left: r.left, top: r.top + r.height, w: r.width, h: r.height });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && search) {
                  e.stopPropagation();
                  setSearch("");
                  setSearchActive(false);
                } else if (e.key === "ArrowDown" && visibleSearchResults.length) {
                  e.preventDefault();
                  setSearchActive(true);
                  setSearchIndex((i) => Math.min(visibleSearchResults.length - 1, i + 1));
                } else if (e.key === "ArrowUp" && visibleSearchResults.length) {
                  e.preventDefault();
                  setSearchIndex((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter" && visibleSearchResults[searchIndex]) {
                  e.preventDefault();
                  jumpToSearchResult(visibleSearchResults[searchIndex]);
                }
              }}
            />
            {search && (
              <button type="button" className="settings-search-clear" onClick={() => { setSearch(""); setSearchActive(false); }} aria-label="Clear search">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchQuery && searchActive && (
            <div
              className="settings-search-results"
              style={{
                left: searchPos.left,
                top: searchPos.top,
                "--tw": `${searchPos.w}px`,
              } as React.CSSProperties}
            >
              {visibleSearchResults.length ? (
                visibleSearchResults.map((item, i) => (
                  <button
                    key={`${item.cat}:${item.label}`}
                    type="button"
                    className={`settings-search-result${i === searchIndex ? " active" : ""}`}
                    onMouseEnter={() => setSearchIndex(i)}
                    onClick={() => jumpToSearchResult(item)}
                  >
                    <span className="settings-search-result-main">
                      <span>{item.label}</span>
                      <small>{item.hint}</small>
                    </span>
                    <span className="settings-search-result-cat">
                      {CATEGORIES.find((c) => c.id === item.cat)?.label}
                    </span>
                  </button>
                ))
              ) : (
                <div className="settings-search-empty">No settings found</div>
              )}
            </div>
          )}
        </div>
        <div className="settings-cats">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`nav-item${cat === c.id ? " active" : ""}`}
              onClick={() => setCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="settings-content" data-window-drag>
          <div className="settings-inner" data-window-drag>
            {cat === "appearance" && (
              <section>
                <h3>Appearance</h3>
                <div className={`setting-row${highlightKey === "theme" ? " setting-highlight" : ""}`} data-setting-key="theme">
                  <div className="setting-info">
                    <label>Theme</label>
                    <span className="setting-hint">
                      Colors for the whole app and terminal
                    </span>
                  </div>
                  <div className="setting-control">
                    <Select
                      value={settings.theme}
                      onChange={(v) => apply({ theme: v })}
                      options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
                    />
                    <RestoreButton
                      show={settings.theme !== DEFAULT_SETTINGS.theme}
                      onClick={() => apply({ theme: DEFAULT_SETTINGS.theme })}
                    />
                  </div>
                </div>
                <div className={`setting-row${highlightKey === "themeLight" ? " setting-highlight" : ""}`} data-setting-key="themeLight">
                  <div className="setting-info">
                    <label>Light mode</label>
                    <span className="setting-hint">
                      Use the theme's white variant (works with every theme)
                    </span>
                  </div>
                  <div className="setting-control">
                    <Toggle
                      checked={settings.themeLight}
                      onChange={(v) => apply({ themeLight: v })}
                    />
                    <RestoreButton
                      show={settings.themeLight !== DEFAULT_SETTINGS.themeLight}
                      onClick={() => apply({ themeLight: DEFAULT_SETTINGS.themeLight })}
                    />
                  </div>
                </div>
                <div className={`setting-row${highlightKey === "uiScale" ? " setting-highlight" : ""}`} data-setting-key="uiScale">
                  <div className="setting-info">
                    <label>Interface scale</label>
                    <span className="setting-hint">
                      Zoom the whole UI (sidebar, tabs, chat, panels)
                    </span>
                  </div>
                  <div className="setting-control">
                    <Select
                      value={String(settings.uiScale)}
                      onChange={(v) => apply({ uiScale: Number(v) })}
                      options={[
                        { value: "0.8", label: "80%" },
                        { value: "0.85", label: "85%" },
                        { value: "0.9", label: "90%" },
                        { value: "0.95", label: "95%" },
                        { value: "1", label: "100%" },
                        { value: "1.1", label: "110%" },
                      ]}
                    />
                    <RestoreButton
                      show={settings.uiScale !== DEFAULT_SETTINGS.uiScale}
                      onClick={() => apply({ uiScale: DEFAULT_SETTINGS.uiScale })}
                    />
                  </div>
                </div>
                <div className={`setting-row${highlightKey === "font" ? " setting-highlight" : ""}`} data-setting-key="font">
                  <div className="setting-info">
                    <label>Terminal font</label>
                    <span className="setting-hint">
                      Geist Mono and JetBrains Mono are bundled
                    </span>
                  </div>
                  <div className="setting-control">
                    <Select
                      value={settings.font}
                      onChange={(v) => apply({ font: v })}
                      options={FONTS.map((f) => ({ value: f.id, label: f.label }))}
                    />
                    <RestoreButton
                      show={settings.font !== DEFAULT_SETTINGS.font}
                      onClick={() => apply({ font: DEFAULT_SETTINGS.font })}
                    />
                  </div>
                </div>
                <div className={`setting-row${highlightKey === "fontSize" ? " setting-highlight" : ""}`} data-setting-key="fontSize">
                  <div className="setting-info">
                    <label>Font size</label>
                    <span className="setting-hint">Ctrl+= / Ctrl+- / Ctrl+0</span>
                  </div>
                  <div className="setting-control">
                    <Stepper
                      value={settings.fontSize}
                      min={9}
                      max={24}
                      onChange={(v) => apply({ fontSize: v })}
                    />
                    <RestoreButton
                      show={settings.fontSize !== DEFAULT_SETTINGS.fontSize}
                      onClick={() => apply({ fontSize: DEFAULT_SETTINGS.fontSize })}
                    />
                  </div>
                </div>
              </section>
            )}

            {cat === "layout" && (
              <section>
                <h3>Layout</h3>
                <div className={`setting-row${highlightKey === "explorerSide" ? " setting-highlight" : ""}`} data-setting-key="explorerSide">
                  <div className="setting-info">
                    <label>Explorer side</label>
                    <span className="setting-hint">
                      File tree position (Ctrl+Shift+O)
                    </span>
                  </div>
                  <Select
                    value={settings.explorerSide}
                    onChange={(v) =>
                      apply({ explorerSide: v as "left" | "right" })
                    }
                    options={[
                      { value: "left", label: "Left" },
                      { value: "right", label: "Right" },
                    ]}
                  />
                </div>
              </section>
            )}

            {cat === "sections" && (
              <section>
                <h3>Sidebar sections</h3>
                <div className={`setting-row${highlightKey === "sections.commands" ? " setting-highlight" : ""}`} data-setting-key="sections.commands">
                  <div className="setting-info">
                    <label>Commands</label>
                    <span className="setting-hint">Quick-launch commands</span>
                  </div>
                  <Toggle
                    checked={settings.sections.commands}
                    onChange={(v) => applySection("commands", v)}
                  />
                </div>
                <div className={`setting-row${highlightKey === "sections.agents" ? " setting-highlight" : ""}`} data-setting-key="sections.agents">
                  <div className="setting-info">
                    <label>Agents</label>
                    <span className="setting-hint">
                      Detected CLI agents (Claude Code, Codex, …)
                    </span>
                  </div>
                  <Toggle
                    checked={settings.sections.agents}
                    onChange={(v) => applySection("agents", v)}
                  />
                </div>
                <div className={`setting-row${highlightKey === "sections.ssh" ? " setting-highlight" : ""}`} data-setting-key="sections.ssh">
                  <div className="setting-info">
                    <label>SSH</label>
                    <span className="setting-hint">
                      Hosts from ~/.ssh/config and custom
                    </span>
                  </div>
                  <Toggle
                    checked={settings.sections.ssh}
                    onChange={(v) => applySection("ssh", v)}
                  />
                </div>
              </section>
            )}

            {cat === "terminal" && (
              <section>
                <h3>Terminal</h3>
                <div className={`setting-row${highlightKey === "termPad" ? " setting-highlight" : ""}`} data-setting-key="termPad">
                  <div className="setting-info">
                    <label>Padding</label>
                    <span className="setting-hint">
                      Space between the app surface and the terminal grid
                    </span>
                  </div>
                  <div className="setting-control">
                    <Stepper
                      value={settings.termPad}
                      min={0}
                      max={32}
                      onChange={(v) => apply({ termPad: v })}
                    />
                    <RestoreButton
                      show={settings.termPad !== DEFAULT_SETTINGS.termPad}
                      onClick={() => apply({ termPad: DEFAULT_SETTINGS.termPad })}
                    />
                  </div>
                </div>
                <div className={`setting-row${highlightKey === "termRadius" ? " setting-highlight" : ""}`} data-setting-key="termRadius">
                  <div className="setting-info">
                    <label>Corner radius</label>
                    <span className="setting-hint">Rounding of the terminal pane corners</span>
                  </div>
                  <div className="setting-control">
                    <Stepper
                      value={settings.termRadius}
                      min={0}
                      max={36}
                      onChange={(v) => apply({ termRadius: v })}
                    />
                    <RestoreButton
                      show={settings.termRadius !== DEFAULT_SETTINGS.termRadius}
                      onClick={() => apply({ termRadius: DEFAULT_SETTINGS.termRadius })}
                    />
                  </div>
                </div>
                <div className={`setting-row${highlightKey === "clearOnExit" ? " setting-highlight" : ""}`} data-setting-key="clearOnExit">
                  <div className="setting-info">
                    <label>Clear on exit</label>
                    <span className="setting-hint">
                      Wipe data when the app quits — chats are deleted from disk,
                      terminals are session-only
                    </span>
                  </div>
                  <div className="setting-control">
                    <Select
                      value={settings.clearOnExit}
                      onChange={(v) => apply({ clearOnExit: v as Settings["clearOnExit"] })}
                      options={[
                        { value: "none", label: "Keep everything" },
                        { value: "chats", label: "Chats" },
                        { value: "terminals", label: "Terminals" },
                        { value: "all", label: "Chats + terminals" },
                      ]}
                    />
                    <RestoreButton
                      show={settings.clearOnExit !== DEFAULT_SETTINGS.clearOnExit}
                      onClick={() => apply({ clearOnExit: DEFAULT_SETTINGS.clearOnExit })}
                    />
                  </div>
                </div>
              </section>
            )}

            {cat === "agents" && (
              <section>
                <h3>Agents</h3>
                <div className={`setting-row${highlightKey === "engine.permissionMode" ? " setting-highlight" : ""}`} data-setting-key="engine.permissionMode">
                  <div className="setting-info">
                    <label>Permission mode</label>
                    <span className="setting-hint">
                      How Ash's built-in agent handles risky actions (bash,
                      file edits/writes)
                    </span>
                  </div>
                  <Select
                    value={settings.engine.permissionMode}
                    onChange={(v) =>
                      apply({
                        engine: {
                          ...settings.engine,
                          permissionMode: v as "full-auto" | "confirm",
                        },
                      })
                    }
                    options={[
                      { value: "confirm", label: "Ask before risky actions" },
                      { value: "full-auto", label: "Full auto (no prompts)" },
                    ]}
                  />
                </div>
                <div className={`setting-row${highlightKey === "engine.sounds" ? " setting-highlight" : ""}`} data-setting-key="engine.sounds">
                  <div className="setting-info">
                    <label>Sound</label>
                    <span className="setting-hint">
                      Chime when a task finishes or needs approval
                    </span>
                  </div>
                  <Toggle
                    checked={settings.engine.sounds}
                    onChange={(v) =>
                      apply({ engine: { ...settings.engine, sounds: v } })
                    }
                  />
                </div>
                <div className={`setting-row${highlightKey === "engine.notifications" ? " setting-highlight" : ""}`} data-setting-key="engine.notifications">
                  <div className="setting-info">
                    <label>Notifications</label>
                    <span className="setting-hint">
                      System notification when the window isn’t focused
                    </span>
                  </div>
                  <Toggle
                    checked={settings.engine.notifications}
                    onChange={(v) =>
                      apply({ engine: { ...settings.engine, notifications: v } })
                    }
                  />
                </div>
                <div className={`setting-row stack${highlightKey === "providers" ? " setting-highlight" : ""}`} data-setting-key="providers">
                  <div className="setting-info">
                    <label>Providers</label>
                    <span className="setting-hint">
                      OpenAI-compatible endpoints. The active one is used on every turn; its models
                      are listed below.
                    </span>
                  </div>
                  <div className="provider-list">
                    {providers.map((p) => (
                      <div
                        key={p.id}
                        className={`provider-row${p.id === settings.engine.activeProviderId ? " active" : ""}`}
                        onClick={() => setActiveProvider(p.id)}
                      >
                        <span className="provider-radio" />
                        <div className="provider-main">
                          <span className="provider-name">{p.name}</span>
                          <span className="provider-sub">{p.baseUrl}</span>
                        </div>
                        <span className="provider-badges">
                          <span className="model-badge">
                            {p.models.length} model{p.models.length === 1 ? "" : "s"}
                          </span>
                        </span>
                        <button
                          className="model-btn"
                          title="Edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditProvider(p);
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                        {providers.length > 1 && (
                          <button
                            className="model-btn"
                            title="Remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeProvider(p.id);
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="model-actions">
                    <button className="settings-action" onClick={openAddProvider}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Add provider
                    </button>
                  </div>
                </div>

                <div className={`setting-row stack${highlightKey === "models" ? " setting-highlight" : ""}`} data-setting-key="models">
                  <div className="setting-info">
                    <label>Models{activeProv ? ` · ${activeProv.name}` : ""}</label>
                    <span className="setting-hint">
                      Pick the active model for the current provider. Add your own with its API id,
                      context window, and whether it accepts images.
                    </span>
                  </div>
                  {models.length === 0 ? (
                    <div className="settings-empty">No models yet — add one below.</div>
                  ) : (
                    <div className="model-list">
                      {models.map((m) => {
                        const logo = catReady ? modelLogo(m) : m.logo;
                        return (
                        <div
                          key={m.id}
                          className={`model-row${m.id === settings.engine.activeModelId ? " active" : ""}`}
                          onClick={() => setActiveModel(m.id)}
                        >
                          <span className="model-radio" />
                          {logo && (
                            <img
                              className="model-logo"
                              src={logo}
                              alt=""
                              onError={(e) => (e.currentTarget.style.display = "none")}
                            />
                          )}
                          <div className="model-main">
                            <span className="model-name">{m.name}</span>
                            <span className="model-sub">{m.modelId}</span>
                          </div>
                          <span className="model-badges">
                            <span className="model-badge">{ctxLabel(m.contextWindow)}</span>
                            {m.supportsImages && <span className="model-badge">vision</span>}
                            {m.fastId && <span className="model-badge">fast</span>}
                          </span>
                          <button
                            className="model-btn"
                            title="Edit"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModel(m);
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                          {models.length > 1 && (
                            <button
                              className="model-btn"
                              title="Remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeModel(m.id);
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M18 6 6 18M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="model-actions">
                    <button className="settings-action" onClick={openAddModel} disabled={!activeProv}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Add model
                    </button>
                    {activeModel?.fastId && (
                      <label className="model-fast">
                        <Toggle
                          checked={settings.engine.useFast}
                          onChange={(v) => apply({ engine: { ...settings.engine, useFast: v } })}
                        />
                        Use fast variant
                      </label>
                    )}
                  </div>
                </div>

              </section>
            )}

            {cat === "shortcuts" && (
              <section>
                <h3>Shortcuts</h3>
                <div className={`shortcut-grid${highlightKey === "shortcuts" ? " setting-highlight" : ""}`} data-setting-key="shortcuts">
                  <span>New tab</span><kbd>Ctrl+Shift+T</kbd>
                  <span>Close pane</span><kbd>Ctrl+Shift+W</kbd>
                  <span>Split right</span><kbd>Ctrl+Shift+D</kbd>
                  <span>Split down</span><kbd>Ctrl+Shift+E</kbd>
                  <span>Browser pane</span><kbd>Ctrl+Shift+L</kbd>
                  <span>Explorer</span><kbd>Ctrl+Shift+O</kbd>
                  <span>Sidebar</span><kbd>Ctrl+Shift+B</kbd>
                  <span>Switch tabs</span><kbd>Ctrl+Tab</kbd>
                  <span>Move between panes</span><kbd>Alt+Arrows</kbd>
                  <span>Settings</span><kbd>Ctrl+,</kbd>
                </div>
              </section>
            )}

            {cat === "about" && (
              <section>
                <h3>About</h3>
                <div className="settings-empty">
                  Ash {appVersion || "dev"} — minimal agentic terminal.
                </div>

                <div className={`setting-row stack${highlightKey === "reset" ? " setting-highlight" : ""}`} data-setting-key="reset">
                  <div className="setting-info">
                    <label>Reset everything</label>
                    <span className="setting-hint">
                      Deletes all chats and resets settings, workspaces and commands to defaults.
                      This can't be undone.
                    </span>
                  </div>
                  <button className="settings-action danger" onClick={() => setResetOpen(true)}>
                    Reset everything
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>

        {resetOpen && (
          <div className="settings-modal-overlay" onMouseDown={() => !resetting && setResetOpen(false)}>
            <div className="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="settings-modal-title">Reset everything?</div>
              <div className="settings-modal-hint">
                This permanently deletes all chats and resets settings, workspaces and commands to
                defaults. The app will restart. This can't be undone.
              </div>
              <div className="settings-modal-actions">
                <button className="settings-link" onClick={() => setResetOpen(false)} disabled={resetting}>
                  Cancel
                </button>
                <button className="settings-action danger" onClick={doReset} disabled={resetting}>
                  {resetting ? "Resetting…" : "Delete everything"}
                </button>
              </div>
            </div>
          </div>
        )}

        {modelEdit && (
          <div className="settings-modal-overlay" onMouseDown={() => setModelEdit(null)}>
            <div className="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="settings-modal-title">{modelIsNew ? "Add model" : "Edit model"}</div>
              <div className="model-form">
                <label className="model-field">
                  <span>Name</span>
                  <input
                    autoFocus
                    spellCheck={false}
                    placeholder="GLM-5.2"
                    value={modelEdit.name}
                    onChange={(e) => setModelEdit({ ...modelEdit, name: e.target.value })}
                  />
                </label>
                <label className="model-field">
                  <span>Model id</span>
                  <input
                    spellCheck={false}
                    placeholder="accounts/fireworks/models/glm-5p2"
                    value={modelEdit.modelId}
                    onChange={(e) => setModelEdit({ ...modelEdit, modelId: e.target.value })}
                  />
                </label>

                {modelDetect && (
                  <div className="model-detected">
                    <img
                      className="model-logo"
                      src={providerLogo(modelDetect.provider)}
                      alt=""
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                    <span className="model-detected-name">{modelDetect.name}</span>
                    <span className="model-detected-meta">
                      {ctxLabel(modelDetect.contextWindow)}
                      {modelDetect.supportsImages ? " · vision" : ""} · models.dev
                    </span>
                  </div>
                )}

                {modelEdit.fastId !== undefined && (
                  <label className="model-field">
                    <span>Fast model id</span>
                    <input
                      spellCheck={false}
                      placeholder="accounts/fireworks/routers/glm-5p2-fast"
                      value={modelEdit.fastId}
                      onChange={(e) => setModelEdit({ ...modelEdit, fastId: e.target.value })}
                    />
                  </label>
                )}

                <div className="model-field">
                  <span>Context window</span>
                  {(() => {
                    const idx = Math.max(
                      0,
                      CONTEXT_STOPS.indexOf(modelEdit.contextWindow as (typeof CONTEXT_STOPS)[number]),
                    );
                    const fill = `${(idx / (CONTEXT_STOPS.length - 1)) * 100}%`;
                    return (
                      <>
                        <input
                          className="model-slider"
                          type="range"
                          min={0}
                          max={CONTEXT_STOPS.length - 1}
                          step={1}
                          value={idx}
                          style={{ "--fill": fill } as React.CSSProperties}
                          onChange={(e) =>
                            setModelEdit({ ...modelEdit, contextWindow: CONTEXT_STOPS[+e.target.value] })
                          }
                        />
                        <div className="model-ticks">
                          {CONTEXT_STOPS.map((s) => (
                            <button
                              key={s}
                              className={s === modelEdit.contextWindow ? "on" : ""}
                              onClick={() => setModelEdit({ ...modelEdit, contextWindow: s })}
                            >
                              {ctxLabel(s)}
                            </button>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* two boolean options share one row so the editor stays compact */}
                <label className="model-field">
                  <span>Thinking format</span>
                  <Select
                    value={modelEdit.thinkingFormat ?? "auto"}
                    onChange={(v) =>
                      setModelEdit({
                        ...modelEdit,
                        thinkingFormat: v === "auto" ? undefined : (v as ThinkingFormat),
                      })
                    }
                    options={[
                      { value: "auto", label: "Auto (safe default)" },
                      { value: "reasoning_effort", label: "reasoning_effort (OpenAI-compat)" },
                      { value: "enable_thinking", label: "enable_thinking (GLM/Zhipu)" },
                      { value: "thinking_object", label: "thinking object (Anthropic)" },
                      { value: "native", label: "Native (no param)" },
                    ]}
                  />
                </label>
                <div className="model-toggles">
                  <label className="model-toggle-row">
                    <span>Fast variant</span>
                    <Toggle
                      checked={modelEdit.fastId !== undefined}
                      onChange={(v) => setModelEdit({ ...modelEdit, fastId: v ? "" : undefined })}
                    />
                  </label>
                  <label className="model-toggle-row">
                    <span>Vision</span>
                    <Toggle
                      checked={modelEdit.supportsImages}
                      onChange={(v) => setModelEdit({ ...modelEdit, supportsImages: v })}
                    />
                  </label>
                </div>
              </div>
              <div className="settings-modal-actions">
                <button className="settings-link" onClick={() => setModelEdit(null)}>
                  Cancel
                </button>
                <button
                  className="settings-action"
                  onClick={saveModel}
                  disabled={!modelEdit.name.trim() || !modelEdit.modelId.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {providerEdit && (
          <div className="settings-modal-overlay" onMouseDown={() => setProviderEdit(null)}>
            <div className="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="settings-modal-title">{providerIsNew ? "Add provider" : "Edit provider"}</div>
              <div className="model-form">
                <label className="model-field">
                  <span>Name</span>
                  <input
                    autoFocus
                    spellCheck={false}
                    placeholder="Fireworks"
                    value={providerEdit.name}
                    onChange={(e) => setProviderEdit({ ...providerEdit, name: e.target.value })}
                  />
                </label>
                <label className="model-field">
                  <span>Base URL</span>
                  <input
                    spellCheck={false}
                    placeholder="https://api.fireworks.ai/inference/v1"
                    value={providerEdit.baseUrl}
                    onChange={(e) => setProviderEdit({ ...providerEdit, baseUrl: e.target.value })}
                  />
                </label>
                <label className="model-field">
                  <span>API key</span>
                  <input
                    type="password"
                    spellCheck={false}
                    placeholder="sk-…"
                    value={providerEdit.apiKey}
                    onChange={(e) => setProviderEdit({ ...providerEdit, apiKey: e.target.value })}
                  />
                </label>
              </div>
              <div className="settings-modal-actions">
                <button className="settings-link" onClick={() => setProviderEdit(null)}>
                  Cancel
                </button>
                <button
                  className="settings-action"
                  onClick={saveProvider}
                  disabled={!providerEdit.name.trim() || !providerEdit.baseUrl.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
