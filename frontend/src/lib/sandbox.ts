import { invoke } from "../backend/core";

// Safe-mode sandboxes: one filtered project copy per owner chat, shared by the
// writing background agents it spawns. The real project is untouched until the
// user reviews the changes and merges. Lives outside React (like term.ts /
// bg-agents.ts); the owner chat subscribes to render its merge banner.

export interface SandboxInfo {
  /** Absolute path of the sandbox copy the agents work in. */
  path: string;
  /** The live project the sandbox was copied from (merge target). */
  project: string;
  /** Files copied at creation (for a friendly "spun up N files" note). */
  files: number;
}

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
}

const byOwner = new Map<string, SandboxInfo>();
// In-flight creations so a fan-out of editors sharing one owner doesn't race
// into several copies — concurrent callers await the same promise.
const creating = new Map<string, Promise<SandboxInfo>>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function onSandboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function sandboxFor(ownerId: string): SandboxInfo | undefined {
  return byOwner.get(ownerId);
}

/** Get (or lazily create) the owner's sandbox and return its working dir. */
export async function ensureSandbox(ownerId: string, project: string): Promise<SandboxInfo> {
  const existing = byOwner.get(ownerId);
  if (existing) return existing;
  const inFlight = creating.get(ownerId);
  if (inFlight) return inFlight;

  const p = invoke<{ path: string; files: number }>("sandbox_copy", { source: project })
    .then((r) => {
      const info: SandboxInfo = { path: r.path, project, files: r.files };
      byOwner.set(ownerId, info);
      creating.delete(ownerId);
      notify();
      return info;
    })
    .catch((e) => {
      creating.delete(ownerId);
      throw e;
    });
  creating.set(ownerId, p);
  return p;
}

/** Changed files in the owner's sandbox vs. the live project. */
export async function sandboxChanges(ownerId: string): Promise<FileChange[]> {
  const info = byOwner.get(ownerId);
  if (!info) return [];
  return invoke<FileChange[]>("sandbox_changes", {
    sandbox: info.path,
    project: info.project,
  });
}

/** Apply the given relative paths from the sandbox onto the live project. */
export async function mergeSandbox(ownerId: string, files: string[]): Promise<number> {
  const info = byOwner.get(ownerId);
  if (!info || !files.length) return 0;
  return invoke<number>("sandbox_merge", {
    sandbox: info.path,
    project: info.project,
    files,
  });
}

/** Delete the owner's sandbox and forget it (after merge or discard). */
export async function discardSandbox(ownerId: string): Promise<void> {
  const info = byOwner.get(ownerId);
  if (!info) return;
  byOwner.delete(ownerId);
  notify();
  await invoke("sandbox_remove", { sandbox: info.path }).catch(() => {});
}
