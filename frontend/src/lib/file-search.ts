import { invoke } from "../backend/core";
import { runProcess } from "./agent-engine/tools/run-process";

// Backs the composer's "@file" mention menu: a flat, gitignore-respecting list
// of the project's files, fuzzy-filtered client-side as the user types. Kept
// out of the agent-engine tools since it's a UI affordance, not a model tool.

const MAX_FILES = 6000;
const LIST_TIMEOUT_MS = 8000;

// Paths use forward slashes everywhere (nicer to read/type as "@src/foo.ts");
// callers that touch disk convert back via mentionToDiskPath().
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

// One in-flight/cached listing per cwd — typing "@" shouldn't re-shell rg on
// every keystroke. Invalidated by clearFileListCache() (e.g. an explicit refresh).
const cache = new Map<string, Promise<string[]>>();

let rgAvailable: Promise<boolean> | null = null;
function hasRg(): Promise<boolean> {
  if (!rgAvailable)
    rgAvailable = invoke<string[]>("detect_bins", { names: ["rg"] })
      .then((f) => f.includes("rg"))
      .catch(() => false);
  return rgAvailable;
}

// rg misses / isn't installed → shallow fallback so "@" still lists something:
// the workspace root plus one level of subdirectories (files only).
async function shallowList(cwd: string): Promise<string[]> {
  interface DirItem { name: string; path: string; is_dir: boolean }
  const out: string[] = [];
  const rootLen = cwd.replace(/[\\/]+$/, "").length + 1;
  const rel = (abs: string) => normalize(abs.slice(rootLen));
  try {
    const top = await invoke<DirItem[]>("list_dir", { path: cwd });
    const subdirs = top.filter((i) => i.is_dir).slice(0, 40);
    for (const f of top) if (!f.is_dir) out.push(rel(f.path));
    const nested = await Promise.all(
      subdirs.map((d) =>
        invoke<DirItem[]>("list_dir", { path: d.path }).catch(() => [] as DirItem[]),
      ),
    );
    for (const items of nested)
      for (const f of items) if (!f.is_dir) out.push(rel(f.path));
  } catch {
    // ignore — return whatever we gathered
  }
  return out.slice(0, MAX_FILES);
}

async function loadFiles(cwd: string): Promise<string[]> {
  if (!cwd) return [];
  if (await hasRg()) {
    // Run FROM cwd (runProcess sets the child's working dir), so "--files"
    // with no path argument prints paths relative to it.
    const res = await runProcess("rg", ["--files"], cwd, { timeoutMs: LIST_TIMEOUT_MS });
    if (!res.timedOut && (res.code === 0 || res.code === 1)) {
      const files = res.stdout.split("\n").map(normalize).filter(Boolean);
      if (files.length) return files.slice(0, MAX_FILES);
    }
  }
  return shallowList(cwd);
}

export function listProjectFiles(cwd: string): Promise<string[]> {
  let p = cache.get(cwd);
  if (!p) {
    p = loadFiles(cwd);
    // Don't cache a rejection/empty forever — let the next "@" retry.
    p.catch(() => cache.delete(cwd));
    cache.set(cwd, p);
  }
  return p;
}

export function clearFileListCache(cwd?: string) {
  if (cwd) cache.delete(cwd);
  else cache.clear();
}

// Convert a forward-slash mention path back to something the OS/read_text
// accepts under this cwd (Windows wants backslashes for a clean join).
export function mentionToDiskPath(cwd: string, rel: string): string {
  const sep = cwd.includes("\\") ? "\\" : "/";
  const p = sep === "\\" ? rel.replace(/\//g, "\\") : rel;
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${p.replace(/^[\\/]+/, "")}`;
}

export interface FileMatch {
  /** full relative path (files) or "dir/sub/" for a folder */
  path: string;
  isDir: boolean;
  /** char indices in `path` that matched the query (for highlighting) */
  hits: number[];
}

// Fuzzy-match one string against a query (subsequence): returns the matched
// char indices (into `str`) and a relevance score, or null if `q` isn't a
// subsequence. Basename / word-start / contiguous hits score higher.
function scoreStr(str: string, q: string): { hits: number[]; s: number } | null {
  const ls = str.toLowerCase();
  const lq = q.toLowerCase();
  const slash = ls.lastIndexOf("/");
  const hits: number[] = [];
  let s = 0;
  let qi = 0;
  let prev = -2;
  for (let i = 0; i < ls.length && qi < lq.length; i++) {
    if (ls[i] !== lq[qi]) continue;
    hits.push(i);
    let bonus = 1;
    if (i > slash) bonus += 3; // in the filename, not the folder path
    if (i === prev + 1) bonus += 4; // contiguous run
    if (i === slash + 1 || i === 0) bonus += 6; // basename start
    else if (ls[i - 1] === "/" || ls[i - 1] === "-" || ls[i - 1] === "_" || ls[i - 1] === ".")
      bonus += 3; // word boundary
    s += bonus;
    prev = i;
    qi++;
  }
  if (qi < lq.length) return null; // not all of the query was consumed
  s -= Math.floor(str.length / 40); // shorter is a touch more relevant
  return { hits, s };
}

const DIR_BONUS = 8; // folders lead files of similar relevance (easier to drill)

// Directory-aware "@" browser: lists the immediate children (sub-folders +
// files) of the folder the query points into, fuzzy-filtered by the trailing
// leaf. At the ROOT, deep matches across the whole tree are folded in too, so
// "@button" still finds src/components/Button.tsx without drilling. A picked
// folder (path ends in "/") drills in; a picked file gets inserted.
export function browseFiles(files: string[], query: string, limit = 12): FileMatch[] {
  const slashAt = query.lastIndexOf("/");
  const dir = slashAt >= 0 ? query.slice(0, slashAt + 1) : "";
  const leaf = slashAt >= 0 ? query.slice(slashAt + 1) : query;
  const off = dir.length;

  // immediate children directly under `dir`
  const dirNames = new Set<string>();
  const fileFulls: string[] = [];
  for (const f of files) {
    if (dir && !f.startsWith(dir)) continue;
    const rest = f.slice(off);
    if (!rest) continue;
    const i = rest.indexOf("/");
    if (i >= 0) dirNames.add(rest.slice(0, i));
    else fileFulls.push(f);
  }

  interface Row extends FileMatch { s: number }
  const rows: Row[] = [];
  const strip = ({ path, isDir, hits }: Row): FileMatch => ({ path, isDir, hits });

  if (!leaf) {
    // nothing typed at this level → folders (alpha) then files (alpha)
    for (const name of [...dirNames].sort())
      rows.push({ path: dir + name + "/", isDir: true, hits: [], s: 0 });
    for (const full of fileFulls.sort())
      rows.push({ path: full, isDir: false, hits: [], s: 0 });
    return rows.slice(0, limit).map(strip);
  }

  const seen = new Set<string>();
  for (const name of dirNames) {
    const m = scoreStr(name, leaf);
    if (!m) continue;
    const path = dir + name + "/";
    seen.add(path);
    rows.push({ path, isDir: true, hits: m.hits.map((h) => h + off), s: m.s + DIR_BONUS });
  }
  for (const full of fileFulls) {
    const m = scoreStr(full.slice(off), leaf);
    if (!m) continue;
    seen.add(full);
    rows.push({ path: full, isDir: false, hits: m.hits.map((h) => h + off), s: m.s });
  }
  // at the root, also surface deep matches from anywhere in the tree
  if (!dir)
    for (const full of files) {
      if (seen.has(full)) continue;
      const m = scoreStr(full, leaf);
      if (m) rows.push({ path: full, isDir: false, hits: m.hits, s: m.s });
    }

  rows.sort(
    (a, b) =>
      b.s - a.s ||
      (a.isDir === b.isDir ? 0 : a.isDir ? -1 : 1) ||
      a.path.length - b.path.length,
  );
  return rows.slice(0, limit).map(strip);
}
