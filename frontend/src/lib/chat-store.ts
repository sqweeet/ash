import { invoke } from "../backend/core";
import { homeDir } from "../backend/path";

import { Message } from "./agent-engine/types";
import { toast } from "./toast";

// Persistent agent chats — one JSON file per chat under ~/.ash/chats/, e.g.
// ~/.ash/chats/<chatId>.json. Files (vs the old single localStorage blob):
// no ~5 MB quota, individually visible/backup-able, and survive restarts.
// An in-memory cache keeps the read API synchronous (App builds its initial
// tabs from it at first render); writes are async, fire-and-forget.

export interface SavedChat {
  chatId: string;
  agentId: string;
  cwd: string;
  name: string;
  title: string;
  /** AgentThread's transcript Item[] — opaque here to avoid a UI import cycle. */
  items: unknown[];
  history: Message[];
  updatedAt: number;
}

interface DirItem {
  name: string;
  path: string;
  is_dir: boolean;
}

const LEGACY_KEY = "ash.agentChats";

let chats: SavedChat[] = [];
let dir: string | null = null;
// Chats deleted this session — a late unmount/beforeunload flush must not
// resurrect them by re-writing the file after removeChat() deleted it.
const removed = new Set<string>();

function fileFor(chatId: string): string {
  return `${dir}\\${chatId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

// Serialize writes PER chatId. A debounced save, an endTurn save, and a
// beforeunload flush can otherwise fire near-simultaneously and interleave two
// `write_text` calls on the same file, truncating the JSON. Chaining them means
// writes never overlap and the last-queued content wins.
const writeChains = new Map<string, Promise<unknown>>();

function writeFile(chat: SavedChat) {
  if (!dir) return;
  const path = fileFor(chat.chatId);
  const contents = JSON.stringify(chat);
  const prev = writeChains.get(chat.chatId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => removed.has(chat.chatId) ? undefined : invoke("write_text", { path, contents }))
    .catch((error) => {
      console.error("Couldn't save chat:", error);
      toast("Couldn't save chat to disk");
    });
  writeChains.set(chat.chatId, next);
  // Drop the entry once this is the settled tail, so the map doesn't grow.
  void next.finally(() => {
    if (writeChains.get(chat.chatId) === next) writeChains.delete(chat.chatId);
  });
}

async function readText(path: string): Promise<string | null> {
  try {
    return await invoke<string | null>("read_text", { path });
  } catch {
    return null;
  }
}

/** Load all chats from disk into the cache. Call once at startup before the
 * first render. Migrates the old localStorage store on first run. */
export async function loadChats(): Promise<void> {
  try {
    dir = (await homeDir()).replace(/[\\/]+$/, "") + "\\.ash\\chats";
  } catch {
    dir = null;
  }

  const loaded: SavedChat[] = [];
  if (dir) {
    let entries: DirItem[] = [];
    try {
      entries = await invoke<DirItem[]>("list_dir", { path: dir });
    } catch {
      entries = []; // dir doesn't exist yet — fine
    }
    // read all chat files in parallel — sequential awaits made startup scale
    // linearly with the number of saved chats
    const jsonFiles = entries.filter((e) => !e.is_dir && e.name.endsWith(".json"));
    const texts = await Promise.all(jsonFiles.map((e) => readText(e.path)));
    for (const t of texts) {
      if (!t) continue;
      try {
        const c = JSON.parse(t) as SavedChat;
        if (c && c.chatId) loaded.push(c);
      } catch {
        // skip a corrupt file
      }
    }
  }

  // First run with no files: migrate whatever the old localStorage store held.
  if (loaded.length === 0) {
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        for (const c of JSON.parse(legacy) as SavedChat[]) {
          loaded.push(c);
          writeFile(c);
        }
      }
    } catch {
      // ignore a malformed legacy blob
    }
  }

  chats = loaded.sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
}

export function listChats(): readonly SavedChat[] {
  return chats;
}

export function getChat(chatId: string): SavedChat | undefined {
  return chats.find((c) => c.chatId === chatId);
}

export function saveChat(chat: Omit<SavedChat, "updatedAt">) {
  if (removed.has(chat.chatId)) return; // deleted this session — don't resurrect
  const next: SavedChat = { ...chat, updatedAt: Date.now() };
  const i = chats.findIndex((c) => c.chatId === chat.chatId);
  if (i >= 0) chats[i] = next;
  else chats.push(next);
  writeFile(next);
}

export function removeChat(chatId: string) {
  removed.add(chatId);
  const i = chats.findIndex((c) => c.chatId === chatId);
  if (i >= 0) chats.splice(i, 1);
  if (dir) void deleteFile(chatId).catch(() => toast("Couldn't delete chat from disk"));
}

async function deleteFile(chatId: string): Promise<void> {
  await writeChains.get(chatId);
  await invoke("delete_path", { path: fileFor(chatId) });
}

/** Delete EVERY saved chat on disk + drop the in-memory cache. Used by the
 * "clear on exit" setting (all chats, or as part of a full clear). */
export async function clearAllChats(): Promise<void> {
  const ids = chats.map((c) => c.chatId);
  chats.forEach((c) => removed.add(c.chatId));
  chats = [];
  localStorage.removeItem(LEGACY_KEY);
  if (!dir) return;
  await Promise.all(ids.map(deleteFile));
}

/** Full reset: delete the on-disk app data (chats and settings) under
 * ~/.ash/ — skills are left alone. localStorage is cleared by the caller. */
export async function resetAshData(): Promise<void> {
  chats.forEach((chat) => removed.add(chat.chatId));
  await Promise.all(writeChains.values());
  let base = "";
  try {
    base = (await homeDir()).replace(/[\\/]+$/, "") + "\\.ash";
  } catch {
    chats = [];
    return;
  }
  for (const p of [`${base}\\chats`, `${base}\\settings.json`]) {
    try {
      await invoke("delete_path", { path: p });
    } catch {
      // missing / already gone — fine
    }
  }
  chats = [];
}
