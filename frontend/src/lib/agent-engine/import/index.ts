import { invoke } from "../../../backend/core";
import { homeDir } from "../../../backend/path";

import { saveChat } from "../../chat-store";
import { ImportedSessionMeta, ImportSource, ParsedSession } from "./types";
import {
  buildTranscriptItems,
  capToolResults,
  deriveTitle,
  ensureToolPairing,
  flattenText,
  mergeConsecutive,
} from "./common";
import { parseClaudeSession } from "./claude-code";
import { parsePiSession } from "./pi";

interface DirItem {
  name: string;
  path: string;
  is_dir: boolean;
}

const META_CACHE_KEY = "ash.importMeta";
const MAX_FILES = 500;
const READ_CONCURRENCY = 6;

export const IMPORT_SOURCE_LABEL: Record<ImportSource, string> = {
  "claude-code": "Claude Code",
  pi: "Pi",
};

async function listDir(path: string): Promise<DirItem[]> {
  try {
    return await invoke<DirItem[]>("list_dir", { path });
  } catch {
    return []; // root doesn't exist — fine
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await invoke<string | null>("read_text", { path });
  } catch {
    return null;
  }
}

/** All session .jsonl files under a "<root>/<project>/…/*.jsonl" tree. */
async function collectFiles(root: string, source: ImportSource): Promise<{ source: ImportSource; path: string }[]> {
  const projects = await listDir(root);
  const files: { source: ImportSource; path: string }[] = [];
  for (const p of projects) {
    if (!p.is_dir) continue;
    // Claude keeps files flat per project; Pi nests one level deeper — one
    // extra listing covers both without a full recursive walk.
    const level1 = await listDir(p.path);
    for (const f of level1) {
      if (!f.is_dir && f.name.endsWith(".jsonl")) files.push({ source, path: f.path });
      else if (f.is_dir) {
        const level2 = await listDir(f.path);
        for (const g of level2)
          if (!g.is_dir && g.name.endsWith(".jsonl")) files.push({ source, path: g.path });
      }
    }
  }
  return files;
}

// Light per-file scan for the list — first user prompt, last activity, count —
// without building the full message history (that waits until actual import).
function peekMeta(source: ImportSource, text: string): { title: string; updatedAt: number; cwd: string; msgCount: number } {
  let title = "";
  let updatedAt = 0;
  let cwd = "";
  let msgCount = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.timestamp) updatedAt = Math.max(updatedAt, Date.parse(o.timestamp) || 0);
    if (!cwd && o.cwd) cwd = o.cwd;
    if (source === "claude-code") {
      if ((o.type === "user" || o.type === "assistant") && !o.isSidechain && !o.isMeta && o.message) {
        msgCount++;
        if (!title && o.message.role === "user") {
          const t = flattenText(o.message.content).trim();
          if (t && !t.startsWith("<")) title = t;
        }
      }
    } else {
      if (o.type === "message" && o.message?.role) {
        if (o.message.role !== "toolResult") msgCount++;
        if (!title && o.message.role === "user") {
          const t = flattenText(o.message.content).trim();
          if (t && !t.startsWith("<")) title = t;
        }
      }
    }
  }
  return { title: title || "(untitled)", updatedAt, cwd, msgCount };
}

function loadCache(): Record<string, ImportedSessionMeta> {
  try {
    return JSON.parse(localStorage.getItem(META_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Scan Claude Code + Pi session stores; return session rows newest-first.
 * Per-file metadata is cached in localStorage so re-opening Search is instant. */
export async function discoverImports(): Promise<ImportedSessionMeta[]> {
  let home = "";
  try {
    home = (await homeDir()).replace(/[\\/]+$/, "");
  } catch {
    return [];
  }
  const files = [
    ...(await collectFiles(`${home}\\.claude\\projects`, "claude-code")),
    ...(await collectFiles(`${home}\\.pi\\agent\\sessions`, "pi")),
  ].slice(0, MAX_FILES);

  const cache = loadCache();
  const metas = await mapWithLimit(files, READ_CONCURRENCY, async ({ source, path }) => {
    const cached = cache[path];
    if (cached) return cached;
    const text = await readText(path);
    if (!text) return null;
    const p = peekMeta(source, text);
    if (p.msgCount === 0) return null;
    const name = path.split(/[\\/]/).pop() || path;
    const meta: ImportedSessionMeta = {
      source,
      path,
      sessionId: name.replace(/\.jsonl$/, ""),
      cwd: p.cwd,
      title: p.title,
      updatedAt: p.updatedAt,
      msgCount: p.msgCount,
    };
    cache[path] = meta;
    return meta;
  });

  const list = metas.filter((m): m is ImportedSessionMeta => !!m);
  try {
    localStorage.setItem(META_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // best-effort cache
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

function parseBySource(source: ImportSource, text: string): ParsedSession {
  return source === "claude-code" ? parseClaudeSession(text) : parsePiSession(text);
}

/** Read + fully parse one session, persist it as a SavedChat, and return the
 * new chat's identity so the caller (App) can open it as an agent tab. */
export async function importSession(
  meta: ImportedSessionMeta,
): Promise<{ chatId: string; cwd: string; name: string; title: string } | null> {
  const text = await readText(meta.path);
  if (!text) return null;
  const parsed = parseBySource(meta.source, text);
  const history = capToolResults(ensureToolPairing(mergeConsecutive(parsed.messages)));
  if (history.length === 0) return null;

  const chatId = crypto.randomUUID();
  const cwd = parsed.cwd || meta.cwd || "";
  const name = (cwd.split(/[\\/]/).filter(Boolean).pop() || "Imported") + "";
  const title = deriveTitle(history) || parsed.title || meta.title;

  saveChat({
    chatId,
    agentId: "ash",
    cwd,
    name,
    title,
    items: buildTranscriptItems(history),
    history,
  });
  return { chatId, cwd, name, title };
}
