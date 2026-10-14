// Integration with models.dev (https://models.dev/api.json): look up a model's
// context window, image support, and provider logo by its API model id, so the
// model editor can auto-fill those instead of the user hand-entering them.
//
// api.json is keyed by provider id → { id, name, models }, and each model is
// { id, name, attachment, modalities: { input: [...] }, limit: { context } }.
// Provider logos live at https://models.dev/logos/<provider>.svg.

import { brandLogoDataUri } from "./brand-logos";

export interface ModelInfo {
  /** models.dev bare model id, e.g. "claude-opus-4-5". */
  id: string;
  /** Display name, e.g. "Claude Opus 4.5 (latest)". */
  name: string;
  /** Provider id (the reseller the model was found under, e.g. "302ai") — NOT
   * the brand. Kept for reference but the logo uses `brand` (below), derived
   * from the model's family, so GLM shows the Z.AI mark, Kimi shows Moonshot,
   * etc. — not whichever reseller hosted the lookup hit. */
  provider: string;
  /** Model family, e.g. "claude-opus", "glm", "kimi-k2", "minimax". Drives
   * the brand logo (families map to their canonical brand provider). */
  family: string;
  /** Context window in tokens (limit.context). */
  contextWindow: number;
  /** modalities.input includes "image". */
  supportsImages: boolean;
}

const API = "https://models.dev/api.json";
const CACHE_KEY = "ash.modelsDev.v2";
const TTL_MS = 24 * 60 * 60 * 1000; // refetch at most once a day

let catalog: ModelInfo[] | null = null;
let inflight: Promise<ModelInfo[]> | null = null;

function parse(json: Record<string, unknown>): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const [provId, provRaw] of Object.entries(json)) {
    const prov = provRaw as { id?: string; models?: Record<string, unknown> };
    const models = prov?.models;
    if (!models || typeof models !== "object") continue;
    const provider = String(prov.id ?? provId);
    for (const [mid, raw] of Object.entries(models)) {
      const m = raw as {
        id?: string;
        name?: string;
        family?: string;
        attachment?: boolean;
        modalities?: { input?: unknown };
        limit?: { context?: unknown };
      };
      const ctx = m?.limit?.context;
      if (typeof ctx !== "number") continue;
      const input = m?.modalities?.input;
      const supportsImages = Array.isArray(input)
        ? input.includes("image")
        : m?.attachment === true;
      out.push({
        id: String(m?.id ?? mid),
        name: String(m?.name ?? mid),
        provider,
        family: String(m?.family ?? ""),
        contextWindow: ctx,
        supportsImages,
      });
    }
  }
  return out;
}

/** Load + cache the models.dev catalog (localStorage, 24h TTL; in-memory once
 * fetched). Safe to call repeatedly. Rejects if offline / the fetch fails. */
export function loadModelsDev(): Promise<ModelInfo[]> {
  if (catalog) return Promise.resolve(catalog);
  if (inflight) return inflight;

  inflight = (async () => {
    // A fresh-enough localStorage copy avoids a network hit every launch.
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { at, data } = JSON.parse(raw) as { at?: number; data?: unknown };
        if (typeof at === "number" && Date.now() - at < TTL_MS && Array.isArray(data)) {
          catalog = data as ModelInfo[];
          return catalog;
        }
      }
    } catch {
      // ignore a corrupt cache
    }
    const res = await fetch(API, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`models.dev HTTP ${res.status}`);
    const parsed = parse(await res.json());
    catalog = parsed;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: parsed }));
    } catch {
      // localStorage full/unavailable — the in-memory cache still serves this session
    }
    return parsed;
  })();
  // Allow a retry after a transient failure (offline at launch, etc.).
  inflight.catch(() => {
    inflight = null;
  });
  return inflight;
}

const lastSeg = (s: string) => s.split("/").pop() || s;

/** Look up a model by API model id in the loaded catalog. Tries exact id, then
 * the last path segment (so "accounts/fireworks/models/kimi-k2" matches
 * "kimi-k2"), then the display name. Returns null if not loaded or no match. */
export function lookupModel(modelId: string | undefined): ModelInfo | null {
  const q = modelId?.trim().toLowerCase();
  if (!catalog || !q) return null;
  const qs = lastSeg(q);
  // Prefer a catalog entry that carries a `family` — the same model id is
  // listed under many resellers, some of which omit family (e.g. 302ai's grok
  // entries have family=undefined). Without this preference the first hit was
  // a family-less reseller row, so the brand lookup fell through to the
  // reseller's logo (OpenRouter) instead of the model's own brand (xAI).
  const withFamily = (m: ModelInfo) => m.family.trim() !== "";
  return (
    catalog.find((m) => m.id.toLowerCase() === q && withFamily(m)) ??
    catalog.find((m) => lastSeg(m.id.toLowerCase()) === qs && withFamily(m)) ??
    catalog.find((m) => m.name.toLowerCase() === q && withFamily(m)) ??
    catalog.find((m) => m.id.toLowerCase() === q) ??
    catalog.find((m) => lastSeg(m.id.toLowerCase()) === qs) ??
    catalog.find((m) => m.name.toLowerCase() === q) ??
    null
  );
}

/** Provider logo URL (SVG). Loads cross-origin fine in an <img> (no CORS need). */
export function providerLogo(provider: string): string {
  return `https://models.dev/logos/${provider}.svg`;
}

// Family → canonical BRAND provider id. models.dev keys logos by provider, and
// a model's `provider` field is whichever reseller hosted the lookup hit
// (302ai, abacus, …) — so GLM would show a 302ai mark, Kimi some reseller's,
// etc. Mapping the model's FAMILY to its brand owner gives each model its own
// mark: GLM → Z.AI, Kimi → Moonshot, Minimax → MiniMax, Opus/Sonnet/Haiku →
// Anthropic, GPT/Codex → OpenAI, Gemini → Google, Grok → xAI, Llama → Meta,
// DeepSeek/Mistral → their own. Verified each brand id ships a real (non-
// placeholder) SVG on models.dev. Families not in the map fall back to the
// reseller provider logo (current behavior).
const FAMILY_BRAND: { prefix: string; brand: string }[] = [
  { prefix: "claude", brand: "anthropic" },
  { prefix: "gpt-image", brand: "openai" },
  { prefix: "gpt", brand: "openai" },
  { prefix: "o", brand: "openai" }, // o1/o3/o4 family + "o", "o-mini", "o-pro"
  { prefix: "codex", brand: "openai" },
  { prefix: "gemini", brand: "google" },
  { prefix: "imagen", brand: "google" },
  { prefix: "grok", brand: "xai" },
  { prefix: "llama", brand: "meta" },
  { prefix: "deepseek", brand: "deepseek" },
  { prefix: "mistral", brand: "mistral" },
  { prefix: "mixtral", brand: "mistral" },
  { prefix: "command", brand: "mistral" },
  { prefix: "codestral", brand: "mistral" },
  { prefix: "magistral", brand: "mistral" },
  { prefix: "ministral", brand: "mistral" },
  { prefix: "pixtral", brand: "mistral" },
  { prefix: "devstral", brand: "mistral" },
  { prefix: "kimi", brand: "moonshotai" },
  { prefix: "glm", brand: "zai" },
  { prefix: "minimax", brand: "minimax" },
  { prefix: "qwen", brand: "alibaba" },
];

/** Brand provider id for a model family, or null if no mapping (caller falls
 * back to the reseller provider). Matches `family === prefix` or a hyphenated
 * child (e.g. "glm"/"glm-flash"), case-insensitively — a bare startsWith would
 * wrongly bind unrelated families sharing a leading stem. */
function brandOfFamily(family: string): string | null {
  const f = family.trim().toLowerCase();
  if (!f) return null;
  for (const { prefix, brand } of FAMILY_BRAND) {
    if (f === prefix || f.startsWith(prefix + "-")) return brand;
  }
  return null;
}

/** Brand provider id for a model's API id. Resolves the model's family from
 * the loaded catalog when available, and falls back to a name/id heuristic so
 * a brand is returned even before the catalog finishes loading (the inlined
 * logos then paint on the first frame). Public so startup can prefetch brand
 * logos for the user's configured models before any picker renders. */
export function brandForModelId(modelId: string): string | null {
  // Heuristic first — works with zero network/catalog, from the id/name stem.
  // The family prefixes double as id stems (grok-, glm-, kimi-, …).
  const hayId = modelId.toLowerCase();
  for (const { prefix, brand } of FAMILY_BRAND) {
    if (hayId === prefix || hayId.includes(prefix + "-") || hayId.includes("/" + prefix))
      return brand;
  }
  // Catalog lookup gives the authoritative family (handles ids that don't
  // contain the family stem, e.g. "o3" → openai via catalog family "o").
  const info = lookupModel(modelId);
  if (info) {
    const b = brandOfFamily(info.family);
    if (b) return b;
  }
  return info ? info.provider : null;
}

// HTTP cache of already-prefetched logo URLs so we never fetch the same brand
// SVG twice. A warm cache means the <img> in the picker paints on its first
// frame instead of flashing in a millisecond late.
const prefetched = new Set<string>();

/** Preload each logo once; optional artwork never blocks startup. */
export function prefetchLogos(urls: Iterable<string>): void {
  for (const url of urls) {
    if (prefetched.has(url)) continue;
    prefetched.add(url);
    const img = new Image();
    img.src = url;
  }
}

/** The stored logo, or a live one resolved from the loaded catalog — keyed
 * off the model's FAMILY → its canonical brand, so the icon is the model's own
 * mark (GLM→Z.AI, Kimi→Moonshot, Minimax→MiniMax, Claude→Anthropic, …) rather
 * than whichever reseller provider hosted the lookup hit. Inlined brand
 * logos (brand-logos.ts) are returned as data: URIs so the <img> paints on
 * the first frame with zero network and no flash; unknown brands fall back to
 * the models.dev URL (still prefetched at startup). */
export function modelLogo(model: { modelId: string; logo?: string }): string | undefined {
  // Resolve the brand FIRST (inlined data URI, instant + the model's own
  // mark), and only fall back to a stored `logo` if the brand is unknown.
  // The stored logo was auto-saved as the reseller provider URL in older
  // builds (e.g. an OpenRouter URL for a Grok model), so honoring it first
  // kept showing the reseller icon even after the brand fix.
  const brand = brandForModelId(model.modelId);
  if (brand) {
    const inlined = brandLogoDataUri(brand);
    if (inlined) return inlined;
    return providerLogo(brand);
  }
  if (model.logo) return model.logo;
  const info = lookupModel(model.modelId);
  return info ? providerLogo(info.provider) : undefined;
}
