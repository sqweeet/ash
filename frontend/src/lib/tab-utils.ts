import type { Tab } from "../App";
import { termLeaf } from "./layout";

// Pure tab/pane helpers. Extracted verbatim from App.tsx.

export function makeTab(
  title = "shell",
  pinned = false,
  workspaceId: string | null = null,
): Tab {
  const paneId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    title,
    titlePinned: pinned,
    root: termLeaf(paneId),
    activePane: paneId,
    workspaceId,
  };
}

/** The list with tab `id` moved to sit right before `targetId` (or right
 *  after it). The same array comes back when nothing would move. */
export function moveTabNextTo<T extends { id: string }>(
  list: T[],
  id: string,
  targetId: string,
  after: boolean,
): T[] {
  const item = list.find((t) => t.id === id);
  if (!item || id === targetId) return list;
  const next = list.filter((t) => t !== item);
  const at = next.findIndex((t) => t.id === targetId);
  if (at < 0) return list;
  next.splice(after ? at + 1 : at, 0, item);
  return next.every((t, i) => t === list[i]) ? list : next;
}

export function paneRect(id: string): DOMRect | null {
  const el = document.querySelector(`[data-pane-id="${id}"]`);
  return el ? el.getBoundingClientRect() : null;
}

export function basename(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

/** A path the way a shell prompt shows it: forward slashes, home folded to
 *  "~" (C:\Users\me\Desktop\app → ~/Desktop/app). Case-insensitive like
 *  Windows paths. */
export function tildePath(path: string, home: string): string {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = norm(path);
  const h = norm(home);
  if (h && (p.toLowerCase() === h.toLowerCase() || p.toLowerCase().startsWith(h.toLowerCase() + "/")))
    return "~" + p.slice(h.length);
  // A bare drive ("C:\" → "C:") keeps its slash.
  return /^[a-z]:$/i.test(p) ? p + "/" : p;
}

/** Shell OSC titles are often raw exe paths — reduce them to a short name. */
export function prettyTitle(raw: string): string {
  const t = raw.trim();
  if (t.includes("\\") || t.includes("/")) {
    return basename(t).replace(/\.exe$/i, "").toLowerCase();
  }
  return t.replace(/\.exe$/i, "");
}
