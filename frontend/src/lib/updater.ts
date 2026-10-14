// Self-update against GitHub Releases. The Go backend (updater.go) does the
// real work: CheckUpdate queries /releases/latest, DownloadUpdate streams the
// Ash.exe asset to disk (emitting "update:progress" events), ApplyUpdate
// swaps the binary in place and relaunches. This module wraps the invoke
// calls + event stream into a tiny reactive store the UI subscribes to.
import { invoke } from "../backend/core";
import { listen } from "../backend/event";

export type UpdateStage =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "restarting"
  | "error"
  | "up-to-date"
  | "demo"; // dev-only: fake release + looping progress, no real download/install

export interface UpdateState {
  stage: UpdateStage;
  /** Latest release found by CheckUpdate (null until a check succeeds). */
  release: UpdateReleaseInfo | null;
  /** 0-100 during downloading; 100 once downloaded. */
  percent: number;
  downloaded: number;
  total: number;
  error: string | null;
}

export interface UpdateReleaseInfo {
  hasUpdate: boolean;
  latest: string;
  current: string;
  notes: string;
  url: string;
  downloadUrl: string;
  downloadSize: number;
  assetName: string;
}

type Listener = (s: UpdateState) => void;

let state: UpdateState = {
  stage: "idle",
  release: null,
  percent: 0,
  downloaded: 0,
  total: 0,
  error: null,
};
const listeners = new Set<Listener>();
let progressUnlisten: (() => void) | null = null;
// A check has run at least once this session — drives whether the titlebar
// badge appears (we don't spam a button before the first check resolves).
let checkedThisSession = false;

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function getUpdateState(): UpdateState {
  return state;
}

export function hasChecked(): boolean {
  return checkedThisSession;
}

export function onUpdateState(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

/** Subscribe to the backend "update:progress" event stream (idempotent). */
async function ensureProgressListener() {
  if (progressUnlisten) return;
  progressUnlisten = await listen<{ percent: number; downloaded: number; total: number; stage: string }>(
    "update:progress",
    (e) => {
      const p = e.payload;
      if (p.stage === "downloading") {
        set({ stage: "downloading", percent: p.percent ?? 0, downloaded: p.downloaded ?? 0, total: p.total ?? 0 });
      } else if (p.stage === "downloaded") {
        set({ stage: "downloaded", percent: 100, downloaded: p.downloaded ?? 0, total: p.total ?? 0 });
      } else if (p.stage === "installing") {
        set({ stage: "installing", percent: 100 });
      } else if (p.stage === "restarting") {
        set({ stage: "restarting", percent: 100 });
      }
    },
  );
}

/** Query GitHub for the latest release. Safe to call repeatedly. */
export async function checkForUpdate(): Promise<UpdateState> {
  set({ stage: "checking", error: null });
  try {
    const r = (await invoke<UpdateReleaseInfo>("check_update"));
    checkedThisSession = true;
    if (r.hasUpdate) {
      set({ stage: "available", release: r, error: null });
    } else {
      set({ stage: "up-to-date", release: r, error: null });
    }
    return state;
  } catch (err) {
    set({ stage: "error", error: String(err) });
    return state;
  }
}

/** Download → apply → restart. The modal drives this; progress arrives via
 *  the "update:progress" event stream. */
export async function runUpdate(): Promise<void> {
  await ensureProgressListener();
  try {
    set({ stage: "downloading", percent: 0, error: null });
    const path = await invoke<string>("download_update");
    // ApplyUpdate swaps the binary and relaunches; it emits "installing" then
    // "restarting" before os.Exit. We may not get to update state ourselves.
    set({ stage: "installing", percent: 100 });
    await invoke<void>("apply_update", { path });
  } catch (err) {
    set({ stage: "error", error: String(err) });
  }
}

// ── Demo mode (dev only) ────────────────────────────────────────────────
// A fake release + a progress bar that loops 0→100 forever, so the update
// modal can be eyeballed/iterated without a real GitHub release or an actual
// binary swap. Never calls invoke(); the modal stays open and closeable.
// Gated to dev builds by the caller (App.tsx keybind) — not wired in release.
let demoTimer: ReturnType<typeof setInterval> | null = null;

const DEMO_RELEASE: UpdateReleaseInfo = {
  hasUpdate: true,
  latest: "1.2.0",
  current: "1.0.0",
  notes:
    "## 1.2.0\n\n" +
    "- New terminal opens in the user home, not the install dir\n" +
    "- Ctrl+V / Ctrl+Shift+V now paste (Wispr Flow too)\n" +
    "- Self-update via binary swap (no installer)\n" +
    "- Frameless titlebar, ConPTY panes, agent engine\n\n" +
    "This is a DEMO release body — not a real update.",
  url: "https://github.com/sqweeet/ash/releases/tag/v1.2.0",
  downloadUrl: "",
  downloadSize: 22_700_000,
  assetName: "Ash.exe",
};

export function startDemo(): void {
  if (demoTimer) return; // already running
  let pct = 0;
  set({
    stage: "demo",
    release: DEMO_RELEASE,
    percent: 0,
    downloaded: 0,
    total: DEMO_RELEASE.downloadSize,
    error: null,
  });
  demoTimer = setInterval(() => {
    pct = (pct + 2) % 101; // 0..100, loops forever
    const downloaded = Math.round((pct / 100) * DEMO_RELEASE.downloadSize);
    set({ stage: "demo", percent: pct, downloaded, total: DEMO_RELEASE.downloadSize });
  }, 120);
}

export function stopDemo(): void {
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
  set({ stage: "idle", release: null, percent: 0, downloaded: 0, total: 0, error: null });
}

/** Auto-check on startup, then on a slow interval — the titlebar badge only
 *  shows if an update is actually available. Network failures are swallowed
 *  so an offline/airplane session never surfaces a broken update state. */
const AUTO_CHECK_INTERVAL_MS = 45 * 60 * 1000; // every ~45 min after the first
let autoCheckTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoCheck(): void {
  // Delay the first check so it doesn't compete with startup IO (PTY spawn,
  // settings load). Then keep re-checking so a user who leaves Ash open for
  // hours still sees a new release badge without restarting.
  setTimeout(() => {
    checkForUpdate().catch(() => {});
  }, 4000);
  if (autoCheckTimer) clearInterval(autoCheckTimer);
  autoCheckTimer = setInterval(() => {
    checkForUpdate().catch(() => {});
  }, AUTO_CHECK_INTERVAL_MS);
}

/** Stop the periodic auto-check (used on teardown / demo handoff). */
export function stopAutoCheck(): void {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }
}
