import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "./backend/core";
import { getCurrentWindow } from "./backend/window";
import { open as openDialog } from "./backend/dialog";
import { homeDir } from "./backend/path";

import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import Welcome from "./components/Welcome";
import PaneLayout from "./components/PaneLayout";
import CommandPalette from "./components/CommandPalette";
import Explorer from "./components/Explorer";
import SettingsModal from "./components/SettingsModal";
import UtilityModal from "./components/UtilityModal";
import SshModal from "./components/SshModal";
import RunModal from "./components/RunModal";
import UpdateModal from "./components/UpdateModal";
import { onUpdateState, startAutoCheck, startDemo, stopDemo } from "./lib/updater";
import { AGENTS, AgentDef } from "./lib/agents";
import { RunConfig, loadRuns, runCwd, saveRuns } from "./lib/runs";
import { initPtyEvents, ptyKill } from "./lib/pty";
import { openUrl } from "./backend/opener";
import {
  adjustFontSize,
  configureSessions,
  disposeSession,
  disposeAllSessions,
  isLocalUrl,
  isSessionUsed,
  setSpawnOptions,
} from "./lib/term";
import { startAgentDetection, stopAgentDetection, triggerDetect, clearAgent, syncAgentStatus, getAgentForTerm, onAgentDetectChange, agentTabTitle, agentCombinedTitle } from "./lib/agent-detect";
import { getSettings, onSettingsChange, updateSettings } from "./lib/settings";
import {
  Leaf,
  PaneNode,
  SplitDir,
  firstLeaf,
  insertSibling,
  leafIds,
  leaves,
  removeLeaf,
  setLeafUrl,
  setSplitRatio,
  splitLeaf,
  termLeaf,
  webLeaf,
  fileLeaf,
} from "./lib/layout";
import {
  loadJson,
  saveJson,
  loadWorkspaces,
  saveWorkspaces,
  loadUtilities,
  saveUtilities,
  loadSshCustom,
  SSH_KEY,
  PINNED_KEY,
} from "./lib/persistence";
import type { WorkspaceState } from "./lib/persistence";
import { makeTab, moveTabNextTo, paneRect, basename, prettyTitle } from "./lib/tab-utils";
import { getSession } from "./lib/term";

initPtyEvents();

export interface Tab {
  id: string;
  title: string;
  titlePinned: boolean;
  root: PaneNode;
  activePane: string;
  workspaceId: string | null;
}

export interface Workspace {
  id: string;
  path: string;
  name: string;
}

export interface Utility {
  id: string;
  name: string;
  command: string;
  cwd?: string;
}

export interface SshHost {
  id: string;
  name: string;
  args: string[];
  password?: string;
  builtin: boolean;
}

export interface PinnedItem {
  type: "workspace" | "command" | "ssh" | "tab";
  id: string;
}

const DEFAULT_WEB_URL = "http://localhost:3000";

export default function App() {
  // Every launch starts fresh at the Welcome screen.
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  // Mount-through-close for the confirm dialog: flipping the state to false
  // unmounts instantly, so we set a `closing` flag, let the exit animation
  // play, then drop the dialog after it finishes.
  const [confirmAllClosing, setConfirmAllClosing] = useState(false);
  const confirmAllModalRef = useRef<HTMLDivElement>(null);
  // Exit animation runs via the Web Animations API on the live modal element —
  // swapping a CSS class to change animation-name on an element that already
  // played its entrance reliably *does not* restart the animation in
  // WebView2/Chromium, so the dialog just vanished with no exit. WAAPI plays
  // a fresh keyframe effect on the same node every time.
  const animateOut = (el: HTMLElement | null, done: () => void) => {
    if (!el) {
      done();
      return;
    }
    const anim = el.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.88)" },
      ],
      { duration: 220, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
    );
    anim.onfinish = () => done();
  };
  const closeConfirmAll = useCallback(() => {
    setConfirmAllClosing(true);
    animateOut(confirmAllModalRef.current, () => {
      setConfirmCloseAll(false);
      setConfirmAllClosing(false);
    });
  }, []);
  const [collapsed, setCollapsedRaw] = useState(false);
  // Wrap the toggle so the ~220ms sidebar open/close animation marks the body
  // as "resizing" — that lets terminal panes skip their per-frame fit() (which
  // recomputes the xterm grid + repaints the renderer and tanks FPS) and do a
  // single trailing fit at the end instead. Separate from "dragging" because
  // that one also kills the rail/content transitions (so the open wouldn't
  // animate at all).
  const sidebarAnim = useRef(0);
  const setCollapsed = (next: boolean | ((c: boolean) => boolean)) => {
    setCollapsedRaw(next);
    document.body.classList.add("resizing");
    window.clearTimeout(sidebarAnim.current);
    sidebarAnim.current = window.setTimeout(
      () => document.body.classList.remove("resizing"),
      260,
    );
  };
  const [workspaces, setWorkspaces] = useState<WorkspaceState>(loadWorkspaces);
  const [utilities, setUtilities] = useState<Utility[]>(loadUtilities);
  const [utilEditing, setUtilEditing] = useState<Utility | "new" | null>(null);
  const [sshCustom, setSshCustom] = useState<SshHost[]>(loadSshCustom);
  const [sshConfigHosts, setSshConfigHosts] = useState<string[]>([]);
  const [sshAdding, setSshAdding] = useState(false);
  const [detectedAgents, setDetectedAgents] = useState<string[]>([]);
  const [runs, setRuns] = useState<RunConfig[]>([]);
  const [runOpen, setRunOpen] = useState(false);
  const [pinned, setPinned] = useState<PinnedItem[]>(() =>
    // Tab ids don't survive a restart, so drop any stale pinned tabs.
    loadJson<PinnedItem[]>(PINNED_KEY, []).filter((p) => p.type !== "tab"),
  );
  const [sections, setSections] = useState(() => getSettings().sections);
  const [branch, setBranch] = useState<string | null>(null);
  const [explorerOpen, setExplorerOpenRaw] = useState(false);
  // Same `resizing`-class debounce as the sidebar toggle: the explorer animates
  // its width over ~160ms, and without this the terminal host beside it reflows
  // every frame → ResizeObserver → per-frame fit() (xterm grid + repaint) =
  // jank. The mount/unmount effect below uses the raw setter directly.
  const explorerAnim = useRef(0);
  const setExplorerOpen = (next: boolean | ((o: boolean) => boolean)) => {
    setExplorerOpenRaw(next);
    document.body.classList.add("resizing");
    window.clearTimeout(explorerAnim.current);
    explorerAnim.current = window.setTimeout(
      () => document.body.classList.remove("resizing"),
      200,
    );
  };
  const [exMounted, setExMounted] = useState(false);
  const [exOpen, setExOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  // Dev channel flag — gates the Ctrl+Shift+U demo keybind so the fake update
  // modal never ships in a release build. Resolved once from AppInfo().channel.
  const [isDevChannel, setIsDevChannel] = useState(true); // safe default = dev
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [explorerSide, setExplorerSide] = useState(
    () => getSettings().explorerSide,
  );
  const [sidebarWidth, setSidebarWidth] = useState(
    () => getSettings().sidebarWidth,
  );
  const [explorerWidth, setExplorerWidth] = useState(
    () => getSettings().explorerWidth,
  );

  const activeWorkspace =
    workspaces.list.find((w) => w.id === workspaces.activeId) ?? null;

  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const activeWorkspaceRef = useRef(activeWorkspace);
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const sidebarWidthRef = useRef(sidebarWidth);
  const explorerWidthRef = useRef(explorerWidth);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  activeWorkspaceRef.current = activeWorkspace;
  sidebarWidthRef.current = sidebarWidth;
  explorerWidthRef.current = explorerWidth;

  useEffect(
    () =>
      onSettingsChange((s) => {
        setExplorerSide(s.explorerSide);
        setSections(s.sections);
      }),
    [],
  );

  // Keep the explorer mounted through its close animation (width → 0).
  useEffect(() => {
    if (explorerOpen) {
      setExMounted(true);
      const r = requestAnimationFrame(() =>
        requestAnimationFrame(() => setExOpen(true)),
      );
      return () => cancelAnimationFrame(r);
    }
    setExOpen(false);
    const t = setTimeout(() => setExMounted(false), 170);
    return () => clearTimeout(t);
  }, [explorerOpen]);

  const beginEdgeResize = useCallback(
    (target: "sidebar" | "explorer") => (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW =
        target === "sidebar"
          ? sidebarWidthRef.current
          : explorerWidthRef.current;
      const sign =
        target === "explorer" && getSettings().explorerSide === "right"
          ? -1
          : 1;
      document.body.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      // rAF-throttled: raw mousemove fires far above 60/s and each setState
      // re-renders the whole App — coalesce to one update per frame.
      let raf = 0;
      let lastX = startX;
      const clamped = () => {
        const raw = startW + sign * (lastX - startX);
        return target === "sidebar"
          ? Math.min(400, Math.max(170, raw))
          : Math.min(480, Math.max(170, raw));
      };
      const apply = () => {
        raf = 0;
        if (target === "sidebar") setSidebarWidth(clamped());
        else setExplorerWidth(clamped());
      };
      const move = (ev: MouseEvent) => {
        lastX = ev.clientX;
        if (!raf) raf = requestAnimationFrame(apply);
      };
      const stop = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", stop);
        if (raf) cancelAnimationFrame(raf);
        apply();
        document.body.classList.remove("dragging");
        document.body.style.cursor = "";
        if (target === "sidebar") updateSettings({ sidebarWidth: clamped() });
        else updateSettings({ explorerWidth: clamped() });
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", stop);
    },
    [],
  );

  // Git branch of the active workspace, refreshed every few seconds.
  useEffect(() => {
    if (!activeWorkspace) {
      setBranch(null);
      return;
    }
    let alive = true;
    const load = () =>
      invoke<string | null>("git_branch", { path: activeWorkspace.path })
        // identity guard: an unchanged branch string must not re-render App
        .then((b) => alive && setBranch((prev) => (prev === b ? prev : b)))
        .catch(() => alive && setBranch((prev) => (prev === null ? prev : null)));
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeWorkspace?.path]);

  const addWorkspace = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      title: "Add workspace folder",
    });
    if (typeof selected !== "string") return;
    setWorkspaces((prev) => {
      const existing = prev.list.find((w) => w.path === selected);
      const next = existing
        ? { ...prev, activeId: existing.id }
        : {
            list: [
              ...prev.list,
              { id: crypto.randomUUID(), path: selected, name: basename(selected) },
            ],
            activeId: null as string | null,
          };
      if (!existing) next.activeId = next.list[next.list.length - 1].id;
      saveWorkspaces(next);
      return next;
    });
  }, []);

  const selectWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => {
      const next = { ...prev, activeId: id };
      saveWorkspaces(next);
      return next;
    });
  }, []);

  const removeWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => {
      const list = prev.list.filter((w) => w.id !== id);
      const next = {
        list,
        activeId:
          prev.activeId === id ? (list[0]?.id ?? null) : prev.activeId,
      };
      saveWorkspaces(next);
      return next;
    });
    // Its terminals keep running, just ungrouped.
    setTabs((ts) =>
      ts.map((t) => (t.workspaceId === id ? { ...t, workspaceId: null } : t)),
    );
  }, []);

  const saveUtility = useCallback(
    (data: { name: string; command: string; cwd?: string }, existing?: Utility) => {
      setUtilities((prev) => {
        const next = existing
          ? prev.map((u) => (u.id === existing.id ? { ...u, ...data } : u))
          : [...prev, { id: crypto.randomUUID(), ...data }];
        saveUtilities(next);
        return next;
      });
      setUtilEditing(null);
    },
    [],
  );

  const removeUtility = useCallback((id: string) => {
    setUtilities((prev) => {
      const next = prev.filter((u) => u.id !== id);
      saveUtilities(next);
      return next;
    });
  }, []);

  useEffect(() => {
    invoke<string[]>("ssh_hosts").then(setSshConfigHosts).catch(() => {});
    invoke<string[]>("detect_bins", { names: AGENTS.map((a) => a.bin) })
      .then(setDetectedAgents)
      .catch(() => {});
  }, []);

  // The active workspace follows the selected terminal — only terminals are
  // "selected"; clicking a folder just expands/collapses it. Depends on `tabs`
  // too: dragging the ACTIVE tab into a workspace changes its workspaceId
  // without changing activeTabId, and the title bar / explorer must follow.
  useEffect(() => {
    const wsId = tabs.find((t) => t.id === activeTabId)?.workspaceId;
    if (!wsId) return;
    setWorkspaces((prev) => {
      if (prev.activeId === wsId) return prev;
      const next = { ...prev, activeId: wsId };
      saveWorkspaces(next);
      return next;
    });
  }, [activeTabId, tabs]);

  // Load per-project runs from .ash/run.json when the workspace changes.
  useEffect(() => {
    if (activeWorkspace) loadRuns(activeWorkspace.path).then(setRuns);
    else setRuns([]);
  }, [activeWorkspace?.path]);

  // Clear-on-exit: when the OS window close is requested and the user chose
  // to clear terminals, tear the live sessions down before destroying the
  // window. Uses destroy() (not close()) so cleanup can't get stuck in a
  // re-trigger loop. Best-effort — a hard kill (taskkill / power loss) can't
  // be intercepted.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onCloseRequested((e) => {
        if (getSettings().clearOnExit !== "terminals") return; // default close
        e.preventDefault();
        try {
          disposeAllSessions();
        } catch {
          // best-effort cleanup — never block the close on a failure
        } finally {
          // destroy() tears the window down without re-firing onCloseRequested —
          // close() would loop back into this handler and could stall.
          win.destroy();
        }
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const persistRuns = useCallback(
    (next: RunConfig[]) => {
      setRuns(next);
      if (activeWorkspaceRef.current)
        saveRuns(activeWorkspaceRef.current.path, next).catch(() => {});
    },
    [],
  );

  const execRun = useCallback(
    (run: RunConfig) => {
      const ws = activeWorkspaceRef.current;
      if (run.type === "url") {
        const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        if (tab) openWebPane(tab.id, tab.activePane, run.url ?? "");
        setRunOpen(false);
        return;
      }
      if (!ws) return;
      const t = makeTab(run.name, true, ws.id);
      setSpawnOptions(firstLeaf(t.root), {
        cwd: runCwd(ws.path, run),
        command: run.command,
      });
      setTabs((ts) => [...ts, t]);
      setActiveTabId(t.id);
      setRunOpen(false);
    },
    [],
  );

  const agents = AGENTS.filter((a) => detectedAgents.includes(a.bin));

  const runAgent = useCallback((agent: AgentDef, command?: string): string => {
    const ws = activeWorkspaceRef.current;
    const tab = makeTab(agent.name, true, ws?.id ?? null);
    setSpawnOptions(firstLeaf(tab.root), {
      cwd: ws?.path ?? null,
      command: command ?? agent.launch,
    });
    setTabs((t) => [...t, tab]);
    setActiveTabId(tab.id);
    return tab.id;
  }, []);

  // ── Pinned ────────────────────────────────────────────
  const pinItem = useCallback((item: PinnedItem) => {
    setPinned((prev) => {
      if (prev.some((p) => p.type === item.type && p.id === item.id))
        return prev;
      const next = [...prev, item];
      saveJson(PINNED_KEY, next);
      return next;
    });
  }, []);

  const unpinItem = useCallback((item: PinnedItem) => {
    setPinned((prev) => {
      const next = prev.filter(
        (p) => !(p.type === item.type && p.id === item.id),
      );
      saveJson(PINNED_KEY, next);
      return next;
    });
  }, []);

  const movePinned = useCallback((from: number, to: number) => {
    setPinned((prev) => {
      if (from === to || from < 0 || to < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(Math.min(to, next.length), 0, item);
      saveJson(PINNED_KEY, next);
      return next;
    });
  }, []);

  const sshHosts: SshHost[] = [
    ...sshConfigHosts.map((h) => ({
      id: `cfg:${h}`,
      name: h,
      args: ["-o", "StrictHostKeyChecking=accept-new", h],
      builtin: true,
    })),
    ...sshCustom,
  ];

  const runSsh = useCallback((host: SshHost) => {
    const tab = makeTab(host.name, true, null);
    // ssh is spawned directly as the PTY process → clean remote terminal.
    setSpawnOptions(firstLeaf(tab.root), {
      program: "ssh",
      args: host.args,
      password: host.password,
    });
    setTabs((t) => [...t, tab]);
    setActiveTabId(tab.id);
  }, []);

  const addSshHost = useCallback(
    (data: {
      name: string;
      user: string;
      host: string;
      port: string;
      password: string;
    }) => {
      const target = data.user ? `${data.user}@${data.host}` : data.host;
      // accept-new skips the interactive fingerprint "yes/no" prompt.
      const args = ["-o", "StrictHostKeyChecking=accept-new", target];
      if (data.port) args.push("-p", data.port);
      setSshCustom((prev) => {
        const next = [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: data.name || data.host,
            args,
            password: data.password || undefined,
            builtin: false,
          },
        ];
        try {
          localStorage.setItem(SSH_KEY, JSON.stringify(next));
        } catch {
          // best-effort persistence
        }
        return next;
      });
      setSshAdding(false);
    },
    [],
  );

  const removeSshHost = useCallback((id: string) => {
    setSshCustom((prev) => {
      const next = prev.filter((h) => h.id !== id);
      try {
        localStorage.setItem(SSH_KEY, JSON.stringify(next));
      } catch {
        // best-effort persistence
      }
      return next;
    });
  }, []);

  const runUtility = useCallback((util: Utility) => {
    const ws = activeWorkspaceRef.current;
    const tab = makeTab(util.name, true, util.cwd ? null : (ws?.id ?? null));
    setSpawnOptions(firstLeaf(tab.root), {
      cwd: util.cwd || ws?.path || null,
      command: util.command,
    });
    setTabs((t) => [...t, tab]);
    setActiveTabId(tab.id);
  }, []);

  // "New tab" always opens outside any workspace — drag it onto a workspace
  // in the sidebar to move it in, or use that workspace's own "+" instead.
  // cwd = home so the shell starts in the user profile, not the app install dir.
  const addTab = useCallback(async () => {
    const tab = makeTab("shell", false, null);
    const home = await homeDir().catch(() => "");
    setSpawnOptions(firstLeaf(tab.root), { cwd: home || null });
    setTabs((t) => [...t, tab]);
    setActiveTabId(tab.id);
  }, []);

  const moveTabToWorkspace = useCallback((tabId: string, wsId: string | null) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab || tab.workspaceId === wsId) return;
    const ws = wsId ? workspacesRef.current.list.find((w) => w.id === wsId) : null;

    const ls = leaves(tab.root);

    // A pristine single terminal (nothing typed or run since it spawned) is
    // respawned fresh IN the folder, so its shell actually starts there. A
    // used one just moves as-is — same live terminal, only regrouped (it will
    // start in the folder on the next app launch).
    const pristine =
      ws &&
      ls.length === 1 &&
      ls[0].kind === "term" &&
      !isSessionUsed(ls[0].id);
    if (pristine) {
      const oldId = ls[0].id;
      ptyKill(oldId);
      disposeSession(oldId);
      const freshId = crypto.randomUUID();
      setSpawnOptions(freshId, { cwd: ws.path });
      setTabs((ts) =>
        ts.map((t) =>
          t.id === tabId
            ? {
                ...t,
                root: termLeaf(freshId),
                activePane: freshId,
                workspaceId: wsId,
                ...(t.titlePinned ? {} : { title: ws.name }),
              }
            : t,
        ),
      );
      return;
    }

    setTabs((ts) =>
      ts.map((t) =>
        t.id === tabId && t.workspaceId !== wsId ? { ...t, workspaceId: wsId } : t,
      ),
    );
  }, []);

  // Sidebar drag-to-reorder: the tab lands right before/after another tab's
  // row. A row in another workspace's list (or the loose list) moves it there
  // too, the same as dropping it on that workspace.
  const reorderTab = useCallback(
    (tabId: string, targetId: string, after: boolean) => {
      const target = tabsRef.current.find((t) => t.id === targetId);
      if (!target) return;
      moveTabToWorkspace(tabId, target.workspaceId);
      setTabs((ts) => moveTabNextTo(ts, tabId, targetId, after));
    },
    [moveTabToWorkspace],
  );

  // Welcome screen's "Open folder" — adds the workspace and drops straight
  // into a terminal there, instead of the two-step add-then-"+" flow.
  const startInFolder = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      title: "Open folder",
    });
    if (typeof selected !== "string") return;
    const existing = workspacesRef.current.list.find((w) => w.path === selected);
    const ws = existing ?? {
      id: crypto.randomUUID(),
      path: selected,
      name: basename(selected),
    };
    setWorkspaces((prev) => {
      const next = existing
        ? { ...prev, activeId: ws.id }
        : { list: [...prev.list, ws], activeId: ws.id };
      saveWorkspaces(next);
      return next;
    });
    const tab = makeTab("shell", false, ws.id);
    setSpawnOptions(firstLeaf(tab.root), { cwd: ws.path });
    setTabs((t) => [...t, tab]);
    setActiveTabId(tab.id);
  }, []);

  // Open a file in a syntax-highlighted viewer tab (reuse if already open).
  const openFile = useCallback((path: string) => {
    const existing = tabsRef.current.find((t) => {
      const ls = leaves(t.root);
      return ls.length === 1 && ls[0].kind === "file" && ls[0].path === path;
    });
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const leafId = crypto.randomUUID();
    const tab: Tab = {
      id: crypto.randomUUID(),
      title: basename(path),
      titlePinned: true,
      root: fileLeaf(leafId, path),
      activePane: leafId,
      workspaceId: activeWorkspaceRef.current?.id ?? null,
    };
    setTabs((t) => [...t, tab]);
    setActiveTabId(tab.id);
  }, []);

  const addTabInWorkspace = useCallback(
    (wsId: string) => {
      const ws = workspaces.list.find((w) => w.id === wsId);
      if (!ws) return;
      const tab = makeTab("shell", false, ws.id);
      setSpawnOptions(firstLeaf(tab.root), { cwd: ws.path });
      setTabs((t) => [...t, tab]);
      setActiveTabId(tab.id);
      selectWorkspace(ws.id);
    },
    [workspaces.list, selectWorkspace],
  );

  const closePane = useCallback((paneId: string, kill: boolean) => {
    if (kill) ptyKill(paneId);
    disposeSession(paneId);
    const tab = tabsRef.current.find((t) => leafIds(t.root).includes(paneId));
    if (!tab) return;
    const newRoot = removeLeaf(tab.root, paneId);
    if (newRoot) {
      setTabs((ts) =>
        ts.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                root: newRoot,
                activePane: leafIds(newRoot).includes(t.activePane)
                  ? t.activePane
                  : firstLeaf(newRoot),
              }
            : t,
        ),
      );
      return;
    }
    // Last pane of the tab — close the tab itself.
    const remaining = tabsRef.current.filter((t) => t.id !== tab.id);
    if (remaining.length === 0) {
      getCurrentWindow().close();
      return;
    }
    if (activeTabIdRef.current === tab.id) {
      const idx = tabsRef.current.findIndex((t) => t.id === tab.id);
      setActiveTabId(remaining[Math.min(idx, remaining.length - 1)].id);
    }
    setTabs(remaining);
  }, []);

  // Stable "close with kill" for PaneLayout (memo needs one identity).
  const closePaneKill = useCallback((paneId: string) => closePane(paneId, true), [closePane]);

  // Drag a sidebar tab onto another tab's pane → merge them into one split.
  // The dragged tab's whole subtree (often a single terminal) becomes a sibling
  // of the drop target pane; the source tab is removed. Neither terminal
  // resets: its PTY+xterm session survives the move (ensureSession re-parents
  // the existing container + refits), so work in progress keeps going at the
  // new size. `placeBefore` = new pane sits on the left/top of the split.
  const splitMergeTab = useCallback(
    (
      srcTabId: string,
      targetPaneId: string,
      dir: SplitDir,
      placeBefore: boolean,
    ) => {
      const src = tabsRef.current.find((t) => t.id === srcTabId);
      const dst = tabsRef.current.find((t) => leafIds(t.root).includes(targetPaneId));
      if (!src || !dst) return;
      // Dropped a tab onto its OWN pane (the common case — the grabbed tab is
      // the active one, so its pane is the only visible drop target). Open a
      // fresh terminal beside it instead of merging: same result as the
      // keyboard split, aimed where the user dropped.
      if (src.id === dst.id) {
        const freshId = crypto.randomUUID();
        const newRoot = insertSibling(
          dst.root,
          targetPaneId,
          dir,
          termLeaf(freshId),
          placeBefore,
        );
        setTabs((ts) =>
          ts.map((t) =>
            t.id === dst.id
              ? { ...t, root: newRoot, activePane: freshId }
              : t,
          ),
        );
        return;
      }
      const newRoot = insertSibling(dst.root, targetPaneId, dir, src.root, placeBefore);
      const focusId = firstLeaf(src.root);
      setTabs((ts) => {
        const merged = ts.map((t) =>
          t.id === dst.id
            ? {
                ...t,
                root: newRoot,
                activePane: focusId,
              }
            : t,
        );
        return merged.filter((t) => t.id !== srcTabId);
      });
      // The tab now holds both sides' agents: retitle it ("Claude Code · Pi")
      // right away instead of waiting for an OSC title an idle agent may never
      // send — until then it kept the drop target's name under the moved
      // agent's icon.
      retitleTabByAgents({ ...dst, root: newRoot, activePane: focusId });
      // If the dragged tab was active, follow the work into its new home.
      if (activeTabIdRef.current === srcTabId) setActiveTabId(dst.id);
    },
    [],
  );

  const closeTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    leafIds(tab.root).forEach((id) => {
      ptyKill(id);
      disposeSession(id);
    });
    const remaining = tabsRef.current.filter((t) => t.id !== tabId);
    if (remaining.length === 0) {
      getCurrentWindow().close();
      return;
    }
    if (activeTabIdRef.current === tabId) {
      const idx = tabsRef.current.findIndex((t) => t.id === tabId);
      setActiveTabId(remaining[Math.min(idx, remaining.length - 1)].id);
    }
    setTabs(remaining);
  }, []);

  // Close ALL tabs. Unlike closing the last tab by hand, this lands on the
  // Welcome screen instead of quitting.
  const closeAllTabs = useCallback(() => {
    for (const tab of tabsRef.current) {
      leafIds(tab.root).forEach((pid) => {
        ptyKill(pid);
        disposeSession(pid);
      });
    }
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const splitWith = useCallback(
    (tabId: string, targetPane: string, dir: SplitDir, node: Leaf) => {
      setTabs((ts) =>
        ts.map((t) =>
          t.id === tabId
            ? {
                ...t,
                root: splitLeaf(t.root, targetPane, dir, node),
                activePane: node.id,
              }
            : t,
        ),
      );
    },
    [],
  );

  const splitActive = useCallback(
    (dir: SplitDir) => {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
      if (!tab) return;
      splitWith(tab.id, tab.activePane, dir, termLeaf(crypto.randomUUID()));
    },
    [splitWith],
  );

  const focusPane = useCallback((tabId: string, paneId: string) => {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === tabId && t.activePane !== paneId
          ? { ...t, activePane: paneId }
          : t,
      ),
    );
  }, []);

  /** Open a URL in the tab's browser pane, reusing an existing one. */
  const openWebPane = useCallback(
    (tabId: string, fromPane: string, url: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;
      const existing = leaves(tab.root).find((l) => l.kind === "web");
      if (existing) {
        setTabs((ts) =>
          ts.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  root: setLeafUrl(t.root, existing.id, url),
                  activePane: existing.id,
                }
              : t,
          ),
        );
      } else {
        splitWith(tabId, fromPane, "row", webLeaf(crypto.randomUUID(), url));
      }
    },
    [splitWith],
  );

  const navigatePane = useCallback(
    (dx: number, dy: number) => {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
      if (!tab) return;
      const ids = leafIds(tab.root);
      if (ids.length < 2) return;
      const cur = paneRect(tab.activePane);
      if (!cur) return;
      const cx = cur.left + cur.width / 2;
      const cy = cur.top + cur.height / 2;
      let best: string | null = null;
      let bestScore = Infinity;
      for (const id of ids) {
        if (id === tab.activePane) continue;
        const r = paneRect(id);
        if (!r) continue;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const forward = (x - cx) * dx + (y - cy) * dy;
        if (forward <= 1) continue;
        const sideways = Math.abs((x - cx) * dy) + Math.abs((y - cy) * dx);
        const score = forward + sideways * 2;
        if (score < bestScore) {
          bestScore = score;
          best = id;
        }
      }
      if (best) focusPane(tab.id, best);
    },
    [focusPane],
  );

  const setRatio = useCallback(
    (tabId: string, splitId: string, ratio: number) => {
      setTabs((ts) =>
        ts.map((t) =>
          t.id === tabId
            ? { ...t, root: setSplitRatio(t.root, splitId, ratio) }
            : t,
        ),
      );
    },
    [],
  );

  const changePaneUrl = useCallback(
    (tabId: string, paneId: string, url: string) => {
      setTabs((ts) =>
        ts.map((t) =>
          t.id === tabId ? { ...t, root: setLeafUrl(t.root, paneId, url) } : t,
        ),
      );
    },
    [],
  );

  const setTitle = useCallback((tabId: string, title: string) => {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === tabId && t.title !== title ? { ...t, title } : t,
      ),
    );
  }, []);

  const renameTab = useCallback((tabId: string, title: string) => {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === tabId
          ? title
            ? { ...t, title, titlePinned: true }
            : { ...t, titlePinned: false }
          : t,
      ),
    );
  }, []);

  const cycleTab = useCallback((dir: 1 | -1) => {
    const list = tabsRef.current;
    if (list.length < 2) return;
    const idx = list.findIndex((t) => t.id === activeTabIdRef.current);
    setActiveTabId(list[(idx + dir + list.length) % list.length].id);
  }, []);

  // Self-update: subscribe to the updater store (drives the titlebar badge)
  // and auto-check GitHub Releases once on startup (quietly, after a delay).
  // Also resolve the build channel once so the dev-only demo keybind is gated
  // out of release builds.
  useEffect(() => {
    const off = onUpdateState((s) => setUpdateAvailable(s.stage === "available"));
    startAutoCheck();
    // CLI-agent detection polls each terminal's foreground process so the
    // sidebar can badge a tab running claude/agy/opencode with its brand icon.
    startAgentDetection();
    invoke<Record<string, string>>("app_info")
      .then((info) => setIsDevChannel((info?.channel ?? "dev") !== "release"))
      .catch(() => setIsDevChannel(true));
    return () => {
      off();
      stopAgentDetection();
    };
  }, []);

  // Dev-only: Ctrl+Shift+U opens the update modal as a looping DEMO (fake
  // release + progress, no real download/install) so the modal can be
  // eyeballed and iterated. Never active in a release build.
  useEffect(() => {
    if (!isDevChannel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        startDemo();
        setUpdateOpen(true);
      }
    };
    // capture: true — fire BEFORE xterm's terminal keydown can stopPropagation
    // (same reason the modal Escape handler uses capture), so the demo keybind
    // works even while a terminal pane is focused.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isDevChannel]);

  // Retitle a tab based on the CLI agents detected across its terminal leaves.
  // One agent → its topic parsed from the OSC title (the sidebar icon names
  // the agent), or the agent's name until it has one. Two+ → each agent's
  // title joined with " · ". No agent → falls back to the active pane's pretty
  // shell title so a bare terminal keeps its shell name. Pinned titles are
  // never touched.
  const retitleTabByAgents = useCallback((tab: Tab) => {
    if (tab.titlePinned) return;
    const termLeaves = leaves(tab.root).filter((l) => l.kind === "term");
    // Resolve the working folder name for this tab — Pi's title is it
    // ("ash-wails") since Pi's own OSC title is just the cwd path. The
    // workspace folder is the cleanest identity; fall back to the pane's cwd.
    const ws = tab.workspaceId
      ? workspacesRef.current.list.find((w) => w.id === tab.workspaceId)
      : undefined;
    const folderName = ws?.name ?? (ws?.path ? basename(ws.path) : undefined);
    const entries = termLeaves
      .map((l) => {
        const ag = getAgentForTerm(l.id);
        if (!ag) return null;
        const raw = getSession(l.id)?.lastTitle ?? "";
        return { id: ag.id, rawTitle: raw };
      })
      .filter((x): x is { id: string; rawTitle: string } => x !== null);
    if (entries.length > 0) {
      const label = agentCombinedTitle(entries, () => folderName);
      if (label) setTitle(tab.id, label);
      return;
    }
    // No detected agent: use the active pane's last OSC title if it had one,
    // otherwise leave the existing title (a pristine shell keeps its shell name).
    const raw = getSession(tab.activePane)?.lastTitle ?? "";
    if (raw) {
      const label = prettyTitle(raw);
      if (label) setTitle(tab.id, label);
    }
  }, [setTitle]);

  // Session events (shell ready, OSC title, PTY exit, link clicks) → state.
  useEffect(() => {
    configureSessions({
      onShell: (paneId, shell) => {
        const tab = tabsRef.current.find((t) =>
          leafIds(t.root).includes(paneId),
        );
        if (tab && !tab.titlePinned) setTitle(tab.id, shell);
      },
      onTitle: (paneId, title) => {
        // An OSC title change is a strong early hint a CLI agent just became
        // foreground — re-check its process before the next poll interval.
        triggerDetect(paneId);
        syncAgentStatus(paneId, title);
        const tab = tabsRef.current.find((t) =>
          leafIds(t.root).includes(paneId),
        );
        if (!tab || tab.titlePinned || tab.activePane !== paneId) return;
        retitleTabByAgents(tab);
      },
      onExit: (paneId) => {
        clearAgent(paneId);
        closePane(paneId, false);
      },
      onOpenLocalUrl: (paneId, url) => {
        const tab = tabsRef.current.find((t) =>
          leafIds(t.root).includes(paneId),
        );
        if (tab) openWebPane(tab.id, paneId, url);
      },
      getCwd: () => activeWorkspaceRef.current?.path ?? null,
      // Pi's fullscreen renderer requests SGR mouse input before entering raw
      // mode. Older ConPTY drops that setup. Do not guess for unknown TUIs:
      // sending mouse bytes to a keyboard-only app can corrupt its input.
      usesSgrMouseInAltScreen: (id) => getAgentForTerm(id)?.id === "pi",
    });
  }, [closePane, setTitle, openWebPane]);

  // When agent detection resolves (a CLI agent appears or disappears in a
  // terminal), retitle the owning tab to the clean brand title — the process
  // walk often fires before/after an OSC title, so this catches the moment the
  // match lands even when the title hasn't changed.
  useEffect(() => {
    return onAgentDetectChange(() => {
      for (const tab of tabsRef.current) {
        if (tab.titlePinned) continue;
        retitleTabByAgents(tab);
      }
    });
  }, [setTitle]);

  // Links anywhere in the UI: localhost opens the
  // in-app browser pane next to the pane it was clicked in; everything else
  // goes to the system browser. Capture-phase so the webview never navigates.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      if (isLocalUrl(href)) {
        const paneId = (a.closest("[data-pane-id]") as HTMLElement | null)?.dataset.paneId;
        const tab = paneId
          ? tabsRef.current.find((t) => leafIds(t.root).includes(paneId))
          : tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        if (tab) {
          openWebPane(tab.id, paneId ?? tab.activePane, href);
          return;
        }
      }
      openUrl(href).catch(() => {});
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [openWebPane]);

  // Kill the default WebView right-click menu (Reload / Back / Inspect …);
  // our own context menus and the terminal handler still run.
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyT") {
        e.preventDefault();
        addTab();
      } else if (e.ctrlKey && e.shiftKey && e.code === "KeyW") {
        e.preventDefault();
        const tab = tabsRef.current.find(
          (t) => t.id === activeTabIdRef.current,
        );
        if (tab) closePane(tab.activePane, true);
      } else if (e.ctrlKey && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        splitActive("row");
      } else if (e.ctrlKey && e.shiftKey && e.code === "KeyE") {
        e.preventDefault();
        splitActive("col");
      } else if (e.ctrlKey && e.shiftKey && e.code === "KeyL") {
        e.preventDefault();
        const tab = tabsRef.current.find(
          (t) => t.id === activeTabIdRef.current,
        );
        if (tab) openWebPane(tab.id, tab.activePane, DEFAULT_WEB_URL);
      } else if (e.ctrlKey && e.shiftKey && e.code === "KeyO") {
        e.preventDefault();
        setExplorerOpen((o) => !o);
      } else if (e.ctrlKey && e.shiftKey && e.code === "KeyB") {
        e.preventDefault();
        setCollapsed((c) => !c);
      } else if (e.ctrlKey && e.code === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
      } else if (e.altKey && e.code === "ArrowLeft") {
        e.preventDefault();
        navigatePane(-1, 0);
      } else if (e.altKey && e.code === "ArrowRight") {
        e.preventDefault();
        navigatePane(1, 0);
      } else if (e.altKey && e.code === "ArrowUp") {
        e.preventDefault();
        navigatePane(0, -1);
      } else if (e.altKey && e.code === "ArrowDown") {
        e.preventDefault();
        navigatePane(0, 1);
      } else if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        adjustFontSize(1);
      } else if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        adjustFontSize(-1);
      } else if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        adjustFontSize(0);
      } else if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((o) => !o);
      } else if (
        e.ctrlKey &&
        ((!e.shiftKey && e.code === "KeyK") || (e.shiftKey && e.code === "KeyP"))
      ) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.ctrlKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        const t = tabsRef.current[Number(e.code.slice(5)) - 1];
        if (t) setActiveTabId(t.id);
      }
      // Any branch that handled the shortcut called preventDefault(). We're in
      // the CAPTURE phase on window, so stopping propagation now prevents the
      // event from descending to xterm's textarea listener — otherwise the
      // shortcut ALSO reached the shell (Ctrl+K = readline kill-line, Ctrl+1..9
      // typed digits) because xterm ignores defaultPrevented.
      if (e.defaultPrevented) e.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [addTab, closePane, splitActive, cycleTab, navigatePane, openWebPane]);

  const explorer = exMounted ? (
    <Explorer
      root={activeWorkspace?.path ?? null}
      rootName={activeWorkspace?.name ?? null}
      width={exOpen ? explorerWidth : 0}
      side={explorerSide}
      onOpenFile={openFile}
    />
  ) : null;
  const explorerEdge = exMounted ? (
    <div className="edge gap" onMouseDown={beginEdgeResize("explorer")} />
  ) : null;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  // The titlebar's folder + branch follow the ACTIVE TAB's own workspace, not
  // the globally-active one. A workspace-less tab (e.g. a fresh home shell)
  // shows no folder instead of a stale name left over from another tab — the
  // activeWorkspace sync bails when a tab has no workspace, so it can go stale.
  const activeTabWs = activeTab?.workspaceId
    ? workspaces.list.find((w) => w.id === activeTab.workspaceId) ?? null
    : null;

  return (
    <div className="app">
      {/* Simulated macOS traffic lights — only visible in the dev Mac-preview
          (Ctrl+Shift+M). On a real Mac the OS draws these natively instead. */}
      <div className="mac-lights" aria-hidden>
        <span className="mac-light red" />
        <span className="mac-light yellow" />
        <span className="mac-light green" />
      </div>
      <button
        className={`app-toggle${collapsed ? " closed" : ""}`}
        title="Toggle sidebar (Ctrl+Shift+B)"
        onClick={() => setCollapsed((c) => !c)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="16" rx="5" />
          <rect
            className="tgl-fill"
            x="6"
            y="8"
            width="4.5"
            height="8"
            rx="2"
            fill="currentColor"
            stroke="none"
          />
          <rect className="tgl-outline" x="6" y="8" width="4.5" height="8" rx="2" />
        </svg>
      </button>
      <div
        className={`rail${collapsed ? " collapsed" : ""}`}
        style={{ width: collapsed ? 0 : sidebarWidth }}
      >
        <div className="rail-top" data-window-drag>
          <div className="rail-brand" data-window-drag />
          {/* Same Y as the sidebar toggle (rail-top strip); X = end of sidebar. */}
          {updateAvailable && (
            <button
              type="button"
              className="update-badge"
              title="A new version of Ash is available"
              onClick={() => setUpdateOpen(true)}
            >
              Update
            </button>
          )}
        </div>
        <Sidebar
          tabs={tabs}
          activeId={activeTabId}
          workspaces={workspaces.list}
          activeWorkspaceId={workspaces.activeId}
          branch={branch}
          utilities={utilities}
          onAddWorkspace={addWorkspace}
          onSelectWorkspace={selectWorkspace}
          onRemoveWorkspace={removeWorkspace}
          onNewTabInWorkspace={addTabInWorkspace}
          onMoveTabToWorkspace={moveTabToWorkspace}
          onReorderTab={reorderTab}
          onSplitMergeTab={splitMergeTab}
          onRunUtility={runUtility}
          onAddUtility={() => setUtilEditing("new")}
          onEditUtility={(u) => setUtilEditing(u)}
          onRemoveUtility={removeUtility}
          sshHosts={sshHosts}
          onRunSsh={runSsh}
          onAddSsh={() => setSshAdding(true)}
          onRemoveSsh={removeSshHost}
          agents={agents}
          onRunAgent={runAgent}
          sections={sections}
          pinned={pinned}
          onPin={pinItem}
          onUnpin={unpinItem}
          onMovePinned={movePinned}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onNew={addTab}
          onRename={renameTab}
          onOpenSearch={() => setPaletteOpen(true)}
          onCloseAll={() => setConfirmCloseAll(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>
      {!collapsed && (
        <div className="edge" onMouseDown={beginEdgeResize("sidebar")} />
      )}
      <div className="main">
        <TitleBar
          title={activeTab ? activeTab.title : "Welcome"}
          workspaceName={activeTabWs?.name ?? null}
          branch={activeTabWs ? branch : null}
          sidebarOpen={!collapsed}
        />
        <div className="main-body">
          {explorerSide === "left" && explorer}
          {explorerSide === "left" && explorerEdge}
          <main className={`content${collapsed ? " inset-left" : ""}`}>
            {tabs.length === 0 ? (
              <Welcome
                workspaces={workspaces.list}
                onNewTerminal={addTab}
                onOpenFolder={startInFolder}
                onOpenWorkspace={addTabInWorkspace}
                onConnectSsh={() => setSshAdding(true)}
              />
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`tab-view${tab.id === activeTabId ? "" : " hidden"}`}
                >
                  <PaneLayout
                    node={tab.root}
                    tabId={tab.id}
                    tabActive={tab.id === activeTabId}
                    activePane={tab.activePane}
                    multi={leafIds(tab.root).length > 1}
                    onFocus={focusPane}
                    onRatio={setRatio}
                    onUrlChange={changePaneUrl}
                    onClosePane={closePaneKill}
                  />
                </div>
              ))
            )}
          </main>
          {explorerSide === "right" && explorerEdge}
          {explorerSide === "right" && explorer}
        </div>
      </div>
      {paletteOpen && (
        <CommandPalette
          tabs={tabs}
          workspaces={workspaces.list}
          onSelectTab={setActiveTabId}
          onNewTab={addTab}
          onOpenFolder={addWorkspace}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {updateOpen && (
        <UpdateModal
          onClose={() => {
            stopDemo(); // tear down any demo loop before closing
            setUpdateOpen(false);
          }}
        />
      )}
      {confirmCloseAll && (
        <div className={`modal-backdrop${confirmAllClosing ? " closing" : ""}`} onMouseDown={() => closeConfirmAll()}>
          <div className={`confirm-modal${confirmAllClosing ? " closing" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
            <h3>Close everything?</h3>
            <p>
              All tabs will be closed and their terminals ended. This can’t be
              undone.
            </p>
            <div className="confirm-actions">
              <button className="cancel" onClick={() => closeConfirmAll()}>
                Cancel
              </button>
              <button
                className="danger"
                onClick={() => {
                  closeAllTabs();
                  closeConfirmAll();
                }}
              >
                Close all
              </button>
            </div>
          </div>
        </div>
      )}
      {utilEditing !== null && (
        <UtilityModal
          initial={utilEditing === "new" ? null : utilEditing}
          onSave={(data) =>
            saveUtility(data, utilEditing === "new" ? undefined : utilEditing)
          }
          onClose={() => setUtilEditing(null)}
        />
      )}
      {sshAdding && (
        <SshModal onSave={addSshHost} onClose={() => setSshAdding(false)} />
      )}
      {runOpen && (
        <RunModal
          projectName={activeWorkspace?.name ?? null}
          runs={runs}
          onRun={execRun}
          onSave={persistRuns}
          onClose={() => setRunOpen(false)}
        />
      )}
    </div>
  );
}
