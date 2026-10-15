import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "../backend/core";
import { homeDir } from "../backend/path";

import { PinnedItem, SshHost, Tab, Utility, Workspace } from "../App";
import { leaves } from "../lib/layout";
import { AgentDef } from "../lib/agents";
import { SectionToggles } from "../lib/settings";
import { tildePath } from "../lib/tab-utils";
import { getAgentStatus, onAgentStatusChange } from "../lib/agent-status";
import { AgentMatch, getAgentForTerm, onAgentDetectChange } from "../lib/agent-detect";
import {
  getBackgroundTerms,
  isBackgroundTerm,
  onBackgroundTermsChange,
} from "../lib/background-terms";
import { BgAgent, getBgAgents, onBgAgentsChange, stopOrRemoveBgAgent } from "../lib/bg-agents";
import MeshAvatar from "./MeshAvatar";
import MarqueeText from "./MarqueeText";

interface SidebarProps {
  tabs: Tab[];
  activeId: string | null;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  branch: string | null;
  utilities: Utility[];
  onAddWorkspace: () => void;
  onSelectWorkspace: (id: string) => void;
  onRemoveWorkspace: (id: string) => void;
  onNewTabInWorkspace: (id: string) => void;
  onMoveTabToWorkspace: (tabId: string, wsId: string) => void;
  onReorderTab: (tabId: string, targetId: string, after: boolean) => void;
  onSplitMergeTab: (
    srcTabId: string,
    targetPaneId: string,
    dir: "row" | "col",
    placeBefore: boolean,
  ) => void;
  onOpenBackgroundTerm: (id: string, title: string) => void;
  onKillBackgroundTerm: (id: string) => void;
  onOpenBgAgent: (id: string, name: string) => void;
  onRunUtility: (u: Utility) => void;
  onAddUtility: () => void;
  onEditUtility: (u: Utility) => void;
  onRemoveUtility: (id: string) => void;
  sshHosts: SshHost[];
  onRunSsh: (h: SshHost) => void;
  onAddSsh: () => void;
  onRemoveSsh: (id: string) => void;
  agents: AgentDef[];
  onRunAgent: (a: AgentDef, command?: string) => void;
  sections: SectionToggles;
  pinned: PinnedItem[];
  onPin: (item: PinnedItem) => void;
  onUnpin: (item: PinnedItem) => void;
  onMovePinned: (from: number, to: number) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onOpenSearch: () => void;
  onCloseAll: () => void;
  onOpenAgent: () => void;
  onRename: (id: string, title: string) => void;
  onOpenSettings: () => void;
}

import {
  FolderIcon, FolderOpenIcon, BranchIcon, ServerIcon, TerminalIcon, FileTabIcon,
  WebTabIcon, PinIcon, AgentTabIcon, NewAgentIcon, AgentWorkingIcon,
  AgentDoneIcon, SessionTermIcon, BotIcon, CommandIcon, PlusIcon,
  AgentDoneChatIcon, BroomIcon, CloseSquareIcon, GearIcon, NewTabIcon,
  SearchIcon, ClaudeLogoIcon, CodexLogoIcon, PiLogoIcon, OpenCodeLogoIcon,
  RenameIcon,
} from "./sidebar/icons";

// Detected CLI agent id → its mark. Agents without one (Antigravity) keep
// the terminal icon.
const CLI_AGENT_ICONS: Record<string, () => React.JSX.Element> = {
  claude: ClaudeLogoIcon,
  codex: CodexLogoIcon,
  pi: PiLogoIcon,
  opencode: OpenCodeLogoIcon,
};

// The CLI agent a tab is running: the active pane's when it has one, else the
// first terminal pane that does.
function tabCliAgent(tab: Tab): AgentMatch | null {
  const terms = leaves(tab.root).filter((l) => l.kind === "term");
  const active = terms.find((l) => l.id === tab.activePane);
  for (const l of active ? [active, ...terms] : terms) {
    const m = getAgentForTerm(l.id);
    if (m) return m;
  }
  return null;
}

// A CLI agent in one of the tab's terminals is mid-turn (parsed from its OSC
// title spinner) — the tab's title shines while it is.
function tabCliWorking(tab: Tab): boolean {
  return leaves(tab.root).some((l) => l.kind === "term" && getAgentStatus(l.id) === "working");
}

// Pick the tab-row icon by what the tab holds. A chat pane is the star of a
// tab — when one is present (even in a "chat left, terminal right" split) show
// its icon, with live working/done state, instead of the terminal fallback.
function tabIcon(tab: Tab) {
  const ls = leaves(tab.root);
  const agents = ls.filter((l) => l.kind === "agent");
  if (agents.length) {
    const statuses = agents.map((l) => getAgentStatus(l.id));
    if (statuses.includes("working")) return <AgentWorkingIcon />;
    if (statuses.includes("done")) return <AgentDoneIcon />;
    return <AgentTabIcon />;
  }
  // A terminal running a detected CLI agent shows that agent's mark.
  const cli = tabCliAgent(tab);
  const Logo = cli ? CLI_AGENT_ICONS[cli.id] : undefined;
  if (Logo) return <Logo />;
  // No chat, no detected agent: a single-leaf tab shows its own kind.
  if (ls.length === 1) {
    if (ls[0].kind === "file") return <FileTabIcon />;
    if (ls[0].kind === "web") return <WebTabIcon />;
  }
  return <TerminalIcon />;
}

export default function Sidebar({
  tabs,
  activeId,
  workspaces,
  activeWorkspaceId,
  branch,
  utilities,
  onAddWorkspace,
  onSelectWorkspace,
  onRemoveWorkspace,
  onNewTabInWorkspace,
  onMoveTabToWorkspace,
  onReorderTab,
  onSplitMergeTab,
  onOpenBackgroundTerm,
  onKillBackgroundTerm,
  onOpenBgAgent,
  onRunUtility,
  onAddUtility,
  onEditUtility,
  onRemoveUtility,
  sshHosts,
  onRunSsh,
  onAddSsh,
  onRemoveSsh,
  agents,
  onRunAgent,
  sections,
  pinned,
  onPin,
  onUnpin,
  onMovePinned,
  onSelect,
  onClose,
  onNew,
  onOpenSearch,
  onCloseAll,
  onOpenAgent,
  onRename,
  onOpenSettings,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Re-render tab icons when an agent pane starts/finishes working.
  const [, bumpAgentStatus] = useState(0);
  useEffect(() => onAgentStatusChange(() => bumpAgentStatus((x) => x + 1)), []);
  // Re-render tab icons when a CLI agent is detected/lost in a terminal so
  // the brand logo appears without switching tabs.
  const [, bumpAgentDetect] = useState(0);
  useEffect(() => onAgentDetectChange(() => bumpAgentDetect((x) => x + 1)), []);
  // Agent-spawned background terminal sessions (collapsible group below).
  const [, bumpSessions] = useState(0);
  useEffect(() => onBackgroundTermsChange(() => bumpSessions((x) => x + 1)), []);
  // Background agents (delegated subtasks) — rows with colored dot loaders.
  const [, bumpBgAgents] = useState(0);
  useEffect(() => onBgAgentsChange(() => bumpBgAgents((x) => x + 1)), []);
  const bgAgents = getBgAgents();
  // Per-agent "hide its terminals" toggle (default: shown).
  const [hiddenBgSessions, setHiddenBgSessions] = useState<Set<string>>(new Set());
  const toggleBgSessions = (id: string) =>
    setHiddenBgSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const sessions = getBackgroundTerms();
  // Sessions whose owning agent chat is gone fall back to a global group.
  const liveAgentPanes = new Set(
    tabs.flatMap((t) => leaves(t.root).filter((l) => l.kind === "agent").map((l) => l.id)),
  );
  // terminals owned by a live bg agent render under that agent's row instead
  const liveBgIds = new Set(bgAgents.map((a) => a.id));
  const orphanSessions = sessions.filter(
    (s) => !s.ownerId || (!liveAgentPanes.has(s.ownerId) && !liveBgIds.has(s.ownerId)),
  );
  const orphanAgents = bgAgents.filter(
    (a) => !a.ownerId || !liveAgentPanes.has(a.ownerId),
  );
  const [utilMenu, setUtilMenu] = useState<{
    x: number;
    y: number;
    util: Utility;
  } | null>(null);
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tab: Tab } | null>(null);
  // Home folder, for showing an agent's working folder as "~/…".
  const [home, setHome] = useState("");
  useEffect(() => {
    homeDir().then(setHome).catch(() => {});
  }, []);
  const [agentMenu, setAgentMenu] = useState<{
    x: number;
    y: number;
    agent: AgentDef;
  } | null>(null);
  const [dragPin, setDragPin] = useState(false);
  const [tabDrag, setTabDrag] = useState<{
    id: string;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const [dropWs, setDropWs] = useState<string | null>(null);
  // Tab row a dragged tab would merge into on release.
  const [dropTab, setDropTab] = useState<string | null>(null);
  // Reorder slot a dragged tab would land in: right before/after this row.
  const [dropSlot, setDropSlot] = useState<{ id: string; after: boolean } | null>(null);
  // Drop target for drag-a-tab-onto-a-pane (split merge). dir + placeBefore
  // describe which side the new pane lands on; the matching pane element gets
  // a `split-drop-*` class to preview where the split will open.
  const [dropPane, setDropPane] = useState<
    { id: string; dir: "row" | "col"; placeBefore: boolean } | null
  >(null);
  const [diff, setDiff] = useState<{ added: number; removed: number } | null>(
    null,
  );

  // Edge fades: the header/footer gradients appear by alpha ONLY when the list
  // can scroll that way — top melt shows once you've scrolled down (rows slide
  // under the header), bottom melt shows while there's content below the fold.
  // Without this the fades sit permanently even over a short, non-scrolling
  // list and read as decoration, not a scroll affordance.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canUp, setCanUp] = useState(false);
  const [canDown, setCanDown] = useState(false);
  const updateScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanUp(el.scrollTop > 0);
    setCanDown(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScroll();
    el.addEventListener("scroll", updateScroll, { passive: true });
    // ResizeObserver covers window/pane resizes; MutationObserver covers rows
    // being added/removed (scrollHeight changes without el itself resizing).
    const ro = new ResizeObserver(updateScroll);
    ro.observe(el);
    const mo = new MutationObserver(updateScroll);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", updateScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // Uncommitted +/- line stats for the active workspace's repo.
  useEffect(() => {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    if (!ws) {
      setDiff(null);
      return;
    }
    let alive = true;
    const load = () => {
      invoke<{ added: number; removed: number }>("git_diff_stat", {
        path: ws.path,
      })
        .then((d) =>
          alive &&
          setDiff((prev) => {
            const next = d.added || d.removed ? d : null;
            // git_diff_stat returns a fresh object every poll; skip the
            // re-render when the +/- counts are unchanged (the common case —
            // a 5s timer would otherwise force a full Sidebar re-render forever)
            if (prev && next && prev.added === next.added && prev.removed === next.removed) return prev;
            if (!prev && !next) return prev;
            return next;
          }),
        )
        .catch(() => alive && setDiff(null));
    };
    load();
    // The counts change on commit/stage/edit WITHOUT the branch string changing,
    // so poll (mirrors App's 5s branch poll) rather than only refetching on a
    // branch/workspace identity change — otherwise the +/- stayed stale.
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, branch]);

  const resolvePin = (p: PinnedItem) => {
    if (p.type === "workspace") {
      const ws = workspaces.find((w) => w.id === p.id);
      return ws
        ? {
            name: ws.name,
            icon: <FolderIcon />,
            onClick: () => onSelectWorkspace(ws.id),
          }
        : null;
    }
    if (p.type === "command") {
      const u = utilities.find((x) => x.id === p.id);
      return u
        ? { name: u.name, icon: <CommandIcon />, onClick: () => onRunUtility(u) }
        : null;
    }
    if (p.type === "tab") {
      const t = tabs.find((x) => x.id === p.id);
      return t
        ? {
            name: t.title,
            icon: <PinIcon />,
            onClick: () => onSelect(t.id),
          }
        : null;
    }
    const h = sshHosts.find((x) => x.id === p.id);
    return h
      ? { name: h.name, icon: <ServerIcon />, onClick: () => onRunSsh(h) }
      : null;
  };

  const pinDragProps = (item: PinnedItem) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("application/x-ash-pin", JSON.stringify(item));
      setDragPin(true);
    },
    onDragEnd: () => setDragPin(false),
  });
  const [collapsedWs, setCollapsedWs] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("ash.wsCollapsed") ?? "[]"));
    } catch {
      return new Set();
    }
  });

  const toggleWs = (id: string) => {
    setCollapsedWs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("ash.wsCollapsed", JSON.stringify([...next]));
      } catch {
        // best-effort persistence
      }
      return next;
    });
  };

  const startRename = (tab: Tab) => {
    setEditingId(tab.id);
    setDraft(tab.title);
  };

  // An unchanged name isn't saved — saving pins the title, which would stop
  // an agent tab's live auto-title. An empty name returns it to auto.
  const commit = (tab: Tab) => {
    const next = draft.trim();
    if (next !== tab.title) onRename(tab.id, next);
    setEditingId(null);
  };

  // Apply/clear the split-drop highlight on the pane under the cursor. Done
  // in an effect (not inline in the drag handler) so React owns the class and
  // we never leave a stale `split-drop-*` on an element after the drag ends.
  useEffect(() => {
    if (!dropPane) return;
    const el = document.querySelector<HTMLElement>(
      `[data-pane-id="${dropPane.id}"]`,
    );
    if (el) {
      const side =
        dropPane.dir === "row"
          ? dropPane.placeBefore
            ? "left"
            : "right"
          : dropPane.placeBefore
            ? "top"
            : "bottom";
      el.classList.add(`split-drop-${side}`);
      return () => el.classList.remove(`split-drop-${side}`);
    }
  }, [dropPane]);

  // FLIP for drag-reorder: right before the move every tab block (its row plus
  // the sub-rows under it) remembers where it sat; after the re-render each one
  // glides from there into its new place instead of jumping.
  const flipFrom = useRef<Map<string, number> | null>(null);
  const tabBlocks = () =>
    [...(scrollRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])].map(
      (row) => [row.dataset.tabId!, row.parentElement!] as const,
    );
  useLayoutEffect(() => {
    const from = flipFrom.current;
    if (!from) return;
    flipFrom.current = null;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [id, block] of tabBlocks()) {
      const top = from.get(id);
      if (top === undefined) continue;
      const dy = top - block.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      block.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
        duration: 240,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
    }
  }, [tabs]);

  // Pointer-based drag (HTML5 DnD is unreliable in the WebView) — drag a tab
  // onto the Pinned zone to pin it, onto a workspace row to move it there, onto
  // another tab's row edge to reorder, or onto another tab's pane or row middle
  // to merge the two into a split (neither terminal resets; the PTY session
  // survives the re-parent).
  const startTabDrag = (e: React.MouseEvent, tab: Tab) => {
    if (e.button !== 0 || editingId === tab.id) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    // Another tab's sidebar row under the pointer. Its top and bottom edge
    // bands reorder (the dragged tab lands before/after it); the middle merges
    // the two — the row is the only way to reach a tab that isn't on screen,
    // since the dragged tab is usually the active one and its own pane is the
    // only pane visible. An edge right beside the dragged row would move
    // nothing, so it's a dead zone.
    const rowDropAt = (el: Element | null, y: number) => {
      const row = el?.closest<HTMLElement>("[data-tab-id]");
      const id = row?.dataset.tabId;
      if (!row || !id || id === tab.id) return null;
      const r = row.getBoundingClientRect();
      const rel = (y - r.top) / r.height;
      if (rel > 0.3 && rel < 0.7) return { id, merge: true, after: false };
      const after = rel >= 0.7;
      const block = row.parentElement;
      const beside = after ? block?.nextElementSibling : block?.previousElementSibling;
      if (beside?.firstElementChild?.getAttribute("data-tab-id") === tab.id) return null;
      return { id, merge: false, after };
    };
    // rAF-throttled — raw mousemove fires setTabDrag + elementFromPoint 100+/s
    // and (Sidebar not yet memoized) each triggers a full list re-render. Same
    // pattern as PaneLayout's divider drag.
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    const apply = () => {
      raf = 0;
      setTabDrag({ id: tab.id, title: tab.title, x: lastX, y: lastY });
      const el = document.elementFromPoint(lastX, lastY);
      const wsRow = el?.closest<HTMLElement>("[data-ws-id]");
      setDropWs(wsRow?.dataset.wsId ?? null);
      const hit = rowDropAt(el, lastY);
      setDropTab(hit?.merge ? hit.id : null);
      setDropSlot(hit && !hit.merge ? { id: hit.id, after: hit.after } : null);
      // Pane drop → split merge. Detect which half of the pane the cursor is in
      // so the new terminal opens on the side the user pointed at.
      const pane = el?.closest<HTMLElement>("[data-pane-id]");
      if (pane) {
        const rect = pane.getBoundingClientRect();
        const relX = (lastX - rect.left) / rect.width - 0.5;
        const relY = (lastY - rect.top) / rect.height - 0.5;
        if (Math.abs(relX) > Math.abs(relY)) {
          setDropPane({ id: pane.dataset.paneId!, dir: "row", placeBefore: relX < 0 });
        } else {
          setDropPane({ id: pane.dataset.paneId!, dir: "col", placeBefore: relY < 0 });
        }
      } else {
        setDropPane(null);
      }
    };
    const move = (ev: MouseEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5)
          return;
        started = true;
        setDragPin(true);
      }
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (raf) cancelAnimationFrame(raf);
      if (started) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        // Pane drop wins over workspace/pin — splitting is the more specific
        // target (a pane is never inside a workspace row).
        const pane = el?.closest<HTMLElement>("[data-pane-id]");
        if (pane && pane.dataset.paneId) {
          const rect = pane.getBoundingClientRect();
          const relX = (ev.clientX - rect.left) / rect.width - 0.5;
          const relY = (ev.clientY - rect.top) / rect.height - 0.5;
          const dir: "row" | "col" = Math.abs(relX) > Math.abs(relY) ? "row" : "col";
          const placeBefore = dir === "row" ? relX < 0 : relY < 0;
          onSplitMergeTab(tab.id, pane.dataset.paneId, dir, placeBefore);
        } else {
          const hit = rowDropAt(el, ev.clientY);
          const target = hit?.merge ? tabs.find((t) => t.id === hit.id) : undefined;
          const wsId = el?.closest<HTMLElement>("[data-ws-id]")?.dataset.wsId;
          if (hit && !hit.merge) {
            flipFrom.current = new Map(
              tabBlocks().map(([id, block]) => [id, block.getBoundingClientRect().top]),
            );
            onReorderTab(tab.id, hit.id, hit.after);
            // a drop that changed nothing never re-renders the list — don't
            // let its snapshot animate some later, unrelated tabs change
            requestAnimationFrame(() => (flipFrom.current = null));
          } else if (target) {
            // Row drop: the dragged tab opens to the right of the target's
            // focused pane, and the merged tab comes on screen.
            onSplitMergeTab(tab.id, target.activePane, "row", false);
            onSelect(target.id);
          } else if (wsId) {
            onMoveTabToWorkspace(tab.id, wsId);
            setCollapsedWs((prev) => {
              if (!prev.has(wsId)) return prev;
              const next = new Set(prev);
              next.delete(wsId);
              try {
                localStorage.setItem("ash.wsCollapsed", JSON.stringify([...next]));
              } catch {
                // best-effort persistence
              }
              return next;
            });
          } else if (el?.closest(".pin-zone")) {
            onPin({ type: "tab", id: tab.id });
          }
        }
      }
      setTabDrag(null);
      setDropWs(null);
      setDropTab(null);
      setDropSlot(null);
      setDropPane(null);
      setDragPin(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const renderSessionRow = (s: { id: string; title: string }, extra = "") => {
    const viewerTab = tabs.find((t) => leaves(t.root).some((l) => l.id === s.id));
    const active = !!viewerTab && viewerTab.id === activeId;
    return (
      <div
        key={s.id}
        className={`tab nested${extra}${active ? " active" : ""}`}
        onClick={() => onOpenBackgroundTerm(s.id, s.title)}
      >
        <span className="tab-icon">
          <SessionTermIcon />
        </span>
        <MarqueeText className="tab-title" text={s.title} />
        <button
          className="tab-close"
          onClick={(e) => {
            e.stopPropagation();
            onKillBackgroundTerm(s.id);
          }}
        >
          <CloseSquareIcon />
        </button>
      </div>
    );
  };

  // Background-agent row: colored dot-matrix loader + simple name; the ×
  // stops a running agent (first click) or removes a finished one.
  const renderBgAgentRow = (a: BgAgent, extra = "", grouped = false) => {
    // terminals THIS agent spawned nest under its row (not in Sessions)
    const owned = sessions.filter((s) => s.ownerId === a.id);
    const hidden = hiddenBgSessions.has(a.id);
    return (
      <div key={a.id}>
        <div
          className={`tab nested${extra}${a.status === "waiting" ? " bga-waiting" : ""}`}
          onClick={() => onOpenBgAgent(a.id, a.name)}
        >
          <span className="tab-icon">
            {/* a unique mesh-gradient blob per agent; it drifts while working
                and desaturates while a reservation waits its turn */}
            <MeshAvatar
              seed={a.id}
              size={16}
              animating={a.status === "working"}
              muted={a.status === "waiting"}
            />
          </span>
          <MarqueeText className="tab-title" text={a.name} />
          {/* the category header already names the role when grouped */}
          {!grouped && a.role.id !== "general" && (
            <span className="bga-role">{a.role.label}</span>
          )}
          {a.status === "waiting" && <span className="bga-state">waiting</span>}
          {a.status === "done" && (
            <span className="bga-done" style={{ color: a.color }}>
              <AgentDoneChatIcon />
            </span>
          )}
          {(a.status === "failed" || a.status === "stopped") && (
            <span className="bga-state">{a.status}</span>
          )}
          {owned.length > 0 && (
            <button
              className={`bga-chev${hidden ? " closed" : ""}`}
              title={hidden ? "Show terminals" : "Hide terminals"}
              onClick={(e) => {
                e.stopPropagation();
                toggleBgSessions(a.id);
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              stopOrRemoveBgAgent(a.id);
            }}
          >
            <CloseSquareIcon />
          </button>
        </div>
        {!hidden && owned.map((s) => renderSessionRow(s, `${extra} session-sub`))}
      </div>
    );
  };

  // A chat's background agents render as a tree: plain delegated (general)
  // agents stay flat, while role agents are grouped under a category header
  // ("Reviewers", "Editors", …) so a workflow's team reads at a glance.
  const renderOwnedAgents = (owned: BgAgent[], sub: string) => {
    const order: string[] = [];
    const byRole = new Map<string, BgAgent[]>();
    for (const a of owned) {
      const key = a.role.id === "general" ? "general" : a.role.id;
      if (!byRole.has(key)) {
        byRole.set(key, []);
        order.push(key);
      }
      byRole.get(key)!.push(a);
    }
    return order.map((key) => {
      const group = byRole.get(key)!;
      // General agents, and any role with only ONE agent, render flat (with their
      // small role chip) — a category header only earns its place for 2+ of a role.
      if (key === "general" || group.length < 2)
        return <div key={`grp-${key}`}>{group.map((a) => renderBgAgentRow(a, sub))}</div>;
      return (
        <div key={`grp-${key}`}>
          <div className={`bga-cat${sub}`}>
            <span className="bga-cat-name">{group[0].role.label}s</span>
          </div>
          {group.map((a) => renderBgAgentRow(a, sub, true))}
        </div>
      );
    });
  };

  const renderTab = (tab: Tab, nested: boolean) => {
    // An agent chat acts as a folder for the sessions it spawned.
    const ls = leaves(tab.root);
    const leafCount = ls.length;
    // A terminal running a CLI agent gets a second line: the folder the agent
    // works in, so two agent tabs tell apart without opening them. In a linked
    // worktree it's the main checkout plus a worktree badge — the worktree's
    // own path (…/.claude/worktrees/x) is long and says less.
    const cli = tabCliAgent(tab);
    const cliCwd = cli?.cwd ?? "";
    const wt = cliCwd ? cli?.worktree : null;
    const subtitle = cliCwd ? tildePath(wt ? wt.repo : cliCwd, home) : "";
    const ownedSessions =
      ls.length === 1 && ls[0].kind === "agent"
        ? sessions.filter((s) => s.ownerId === ls[0].id)
        : [];
    const ownedAgents =
      ls.length === 1 && ls[0].kind === "agent"
        ? bgAgents.filter((a) => a.ownerId === ls[0].id)
        : [];
    return (
      <div
        key={tab.id}
        className={`tab-item${dropSlot?.id === tab.id ? (dropSlot.after ? " drop-after" : " drop-before") : ""}${tabDrag?.id === tab.id ? " dragging" : ""}`}
      >
        <div
          className={`tab${tab.id === activeId ? " active" : ""}${nested ? " nested" : ""}${subtitle ? " two-line" : ""}${dropTab === tab.id ? " drop-target" : ""}${cli && tabCliWorking(tab) ? " working" : ""}`}
          data-tab-id={tab.id}
          title={cliCwd || undefined}
          onClick={() => onSelect(tab.id)}
          onDoubleClick={() => startRename(tab)}
          onContextMenu={(e) => {
            e.preventDefault();
            setTabMenu({ x: e.clientX, y: e.clientY, tab });
          }}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(tab.id);
          }}
          onMouseDown={(e) => startTabDrag(e, tab)}
        >
          <span className="tab-icon">{tabIcon(tab)}</span>
          <span className="tab-lines">
            {editingId === tab.id ? (
              <input
                className="tab-rename"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => commit(tab)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commit(tab);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <MarqueeText className="tab-title" text={tab.title} />
            )}
            {subtitle && (
              <span className="tab-sub">
                <span className="tab-path">
                  <bdi>{subtitle}</bdi>
                </span>
                {wt && (
                  <span
                    className="tab-wt"
                    title={`Worktree ${wt.name}${wt.branch ? ` · ${wt.branch}` : ""}`}
                  >
                    <BranchIcon />
                    <span className="tab-wt-name">{wt.branch || wt.name}</span>
                  </span>
                )}
              </span>
            )}
          </span>
          {leafCount > 1 && (
            <span className="tab-pane-count" title={`${leafCount} panes`}>{leafCount}</span>
          )}
          <button
            className="tab-close"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            <CloseSquareIcon />
          </button>
        </div>
        {/* terminals the chat launched sit ABOVE its sub-agents */}
        {ownedSessions.map((s) => renderSessionRow(s, nested ? " session-sub" : ""))}
        {renderOwnedAgents(ownedAgents, nested ? " session-sub" : "")}
      </div>
    );
  };

  // Pinned tabs live only in the Pinned section, not in their normal spot.
  const pinnedTabIds = new Set(
    pinned.filter((p) => p.type === "tab").map((p) => p.id),
  );

  const [workspacesOpen, setWorkspacesOpen] = useState(() => {
    try {
      return localStorage.getItem("ash.workspacesOpen") !== "0";
    } catch {
      return true;
    }
  });
  const toggleWorkspacesOpen = () => {
    setWorkspacesOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("ash.workspacesOpen", next ? "1" : "0");
      } catch {
        // best-effort persistence
      }
      return next;
    });
  };

  const looseTabs = tabs.filter(
    (t) =>
      !pinnedTabIds.has(t.id) &&
      // background-session viewers live ONLY in the Sessions group
      !leaves(t.root).some((l) => isBackgroundTerm(l.id)) &&
      // bg-agent chat viewers live ONLY as their agent's row
      !leaves(t.root).some((l) => l.kind === "agent" && l.agentId.startsWith("bg:")) &&
      (!t.workspaceId || !workspaces.some((w) => w.id === t.workspaceId)),
  );

  return (
    <aside className="sidebar">
      <div className="side-top">
        <button
          className="side-action"
          onClick={onOpenAgent}
          title="New agent thread"
        >
          <span className="tab-icon">
            <NewAgentIcon />
          </span>
          <span>New agent</span>
        </button>

        <button
          className="side-action side-search"
          onClick={onOpenSearch}
          title="Search (Ctrl+K)"
        >
          <span className="tab-icon">
            <SearchIcon />
          </span>
          <span>Search</span>
        </button>

        <button className="side-action" onClick={onNew} title="Ctrl+Shift+T">
          <span className="tab-icon">
            <NewTabIcon />
          </span>
          <span>New terminal</span>
        </button>

        <div className={`pinned-wrap${pinned.length > 0 || dragPin ? " open" : ""}`}>
          <div className="pinned-wrap-inner">
            <div className="side-header pinned-header">
              <span className="pinned-title">Pinned</span>
            </div>
            <div
              className={`pin-zone${dragPin ? " droppable" : ""}`}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-ash-pin"))
                  e.preventDefault();
              }}
              onDrop={(e) => {
                const raw = e.dataTransfer.getData("application/x-ash-pin");
                if (raw) {
                  try {
                    onPin(JSON.parse(raw));
                  } catch {
                    // malformed drag payload — ignore
                  }
                }
                setDragPin(false);
              }}
            >
              {pinned.map((p, i) => {
                const r = resolvePin(p);
                if (!r) return null;
                const activePin = p.type === "tab" && p.id === activeId;
                return (
                  <div
                    key={`${p.type}:${p.id}`}
                    className={`side-row util${activePin ? " active" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-ash-reorder",
                        String(i),
                      );
                    }}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes(
                          "application/x-ash-reorder",
                        )
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                    onDrop={(e) => {
                      const from = e.dataTransfer.getData(
                        "application/x-ash-reorder",
                      );
                      if (from !== "") {
                        e.stopPropagation();
                        onMovePinned(Number(from), i);
                      }
                    }}
                    onClick={r.onClick}
                  >
                    <span className="tab-icon">{r.icon}</span>
                    <span className="side-name">{r.name}</span>
                    <span className="row-actions">
                      <button
                        className="row-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUnpin(p);
                        }}
                      >
                        <CloseSquareIcon />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div
        className={`side-scroll${canUp ? " can-up" : ""}${canDown ? " can-down" : ""}`}
        ref={scrollRef}
      >
        <div className="side-header workspaces-header">
          <span className="workspaces-head-left">
            <span className="workspaces-title">Workspaces</span>
            <button
              className={`side-add workspaces-collapse${workspacesOpen ? "" : " closed"}`}
              title={workspacesOpen ? "Hide workspaces" : "Show workspaces"}
              onClick={toggleWorkspacesOpen}
              disabled={workspaces.length === 0}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </span>
          <span className="side-header-actions">
            <button
              className="side-add workspaces-action"
              title="Close all terminals & chats"
              onClick={onCloseAll}
            >
              <BroomIcon />
            </button>
            <button
              className="side-add workspaces-action"
              title="Add workspace"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setWsMenu({ x: r.right - 150, y: r.bottom + 4 });
              }}
            >
              <PlusIcon />
            </button>
          </span>
        </div>


        {wsMenu && (
          <>
            <div className="menu-backdrop" onMouseDown={() => setWsMenu(null)} />
            <div
              className="ctx-menu"
              style={{ left: Math.max(8, wsMenu.x), top: wsMenu.y }}
            >
              <button
                onClick={() => {
                  setWsMenu(null);
                  onAddWorkspace();
                }}
              >
                <FolderIcon />
                Open folder
              </button>
              <button
                onClick={() => {
                  setWsMenu(null);
                  onAddSsh();
                }}
              >
                <ServerIcon />
                SSH connection
              </button>
            </div>
          </>
        )}

        <div className={`workspaces-list${workspacesOpen ? "" : " closed"}`}>
          <div className="workspaces-list-inner">
            {workspaces.map((ws) => {
              const wsTabs = tabs.filter(
                (t) => t.workspaceId === ws.id && !pinnedTabIds.has(t.id),
              );
              const shownTabs = wsTabs;
              // An empty workspace (no terminals) can't be opened; keep it closed.
              const isEmpty = wsTabs.length === 0;
              const closed = collapsedWs.has(ws.id) || isEmpty;
              return (
                <div key={ws.id} className="ws-group">
              <div
                className={`side-row ws-row${ws.id === activeWorkspaceId ? " current" : ""}${isEmpty ? " empty" : ""}${dropWs === ws.id ? " drop-target" : ""}`}
                title={ws.path}
                data-ws-id={ws.id}
                onClick={() => {
                  if (!isEmpty) toggleWs(ws.id);
                }}
                {...pinDragProps({ type: "workspace", id: ws.id })}
              >
                <span
                  className={`tab-icon ws-folder ${closed ? "is-closed" : "is-open"}`}
                >
                  <FolderIcon />
                  <FolderOpenIcon />
                </span>
                <span className="side-name">{ws.name}</span>
                {closed && wsTabs.length > 0 && (
                  <span className="ws-count">{wsTabs.length}</span>
                )}
                {ws.id === activeWorkspaceId && (branch || diff) && (
                  <span className="ws-branch">
                    {branch && (
                      <>
                        <BranchIcon />
                        {branch}
                      </>
                    )}
                    {diff && (
                      <span className="ws-diff">
                        <span className="add">+{diff.added}</span>
                        <span className="del">−{diff.removed}</span>
                      </span>
                    )}
                  </span>
                )}
                <span className="row-actions">
                  <button
                    className="row-btn"
                    title="New terminal here"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewTabInWorkspace(ws.id);
                    }}
                  >
                    <PlusIcon />
                  </button>
                  <button
                    className="row-btn"
                    title="Remove workspace (terminals stay)"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveWorkspace(ws.id);
                    }}
                  >
                    <CloseSquareIcon />
                  </button>
                </span>
              </div>
              <div className={`ws-tabs${closed ? " closed" : ""}`}>
                <div className="ws-tabs-inner">
                  {shownTabs.map((t) => renderTab(t, true))}
                </div>
              </div>
                </div>
              );
            })}
          </div>
        </div>

        {orphanSessions.length > 0 && (
          <div className="ws-group">
            <div
              className="side-row ws-row"
              onClick={() => setSessionsOpen((o) => !o)}
            >
              <span
                className={`tab-icon ws-folder ${sessionsOpen ? "is-open" : "is-closed"}`}
              >
                <FolderIcon />
                <FolderOpenIcon />
              </span>
              <span className="side-name">Sessions</span>
              {!sessionsOpen && (
                <span className="ws-count">{orphanSessions.length}</span>
              )}
            </div>
            <div className={`ws-tabs${sessionsOpen ? "" : " closed"}`}>
              <div className="ws-tabs-inner">
                {orphanSessions.map((s) => renderSessionRow(s))}
              </div>
            </div>
          </div>
        )}

        {orphanAgents.length > 0 && (
          <div className="ws-group">
            <div className="side-row ws-row">
              <span className="tab-icon ws-folder is-open">
                <FolderIcon />
                <FolderOpenIcon />
              </span>
              <span className="side-name">Agents</span>
            </div>
            <div className="ws-tabs">
              <div className="ws-tabs-inner">
                {orphanAgents.map((a) => renderBgAgentRow(a))}
              </div>
            </div>
          </div>
        )}

        {sections.commands && (
          <>
            <div className="side-header">
              <span>Commands</span>
              <button
                className="side-add"
                title="Add command"
                onClick={onAddUtility}
              >
                <PlusIcon />
              </button>
            </div>

            {utilities.map((u) => (
              <div
                key={u.id}
                className="side-row util"
                title={u.command}
                onClick={() => onRunUtility(u)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setUtilMenu({ x: e.clientX, y: e.clientY, util: u });
                }}
                {...pinDragProps({ type: "command", id: u.id })}
              >
                <span className="tab-icon quick-icon">
                  <CommandIcon />
                </span>
                <span className="side-name">{u.name}</span>
              </div>
            ))}
          </>
        )}

        {sections.agents && agents.length > 0 && (
          <>
            <div className="side-header">
              <span>Agents</span>
            </div>
            {agents.map((a) => (
              <div
                key={a.id}
                className="side-row util"
                onClick={() => onRunAgent(a)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setAgentMenu({ x: e.clientX, y: e.clientY, agent: a });
                }}
              >
                <span className="tab-icon">
                  <BotIcon />
                </span>
                <span className="side-name">{a.name}</span>
              </div>
            ))}
          </>
        )}

        {agentMenu && (
          <>
            <div
              className="menu-backdrop"
              onMouseDown={() => setAgentMenu(null)}
            />
            <div
              className="ctx-menu"
              style={{ left: agentMenu.x, top: agentMenu.y }}
            >
              <button
                onClick={() => {
                  onRunAgent(agentMenu.agent);
                  setAgentMenu(null);
                }}
              >
                New session
              </button>
              {agentMenu.agent.extra?.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => {
                    onRunAgent(agentMenu.agent, ex.command);
                    setAgentMenu(null);
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </>
        )}

        {sections.ssh && (
          <>
            <div className="side-header">
              <span>SSH</span>
              <button
                className="side-add"
                title="Add SSH host"
                onClick={onAddSsh}
              >
                <PlusIcon />
              </button>
            </div>

            {sshHosts.map((h) => (
              <div
                key={h.id}
                className="side-row util"
                title={`ssh ${h.args.join(" ")}`}
                onClick={() => onRunSsh(h)}
                {...pinDragProps({ type: "ssh", id: h.id })}
              >
                <span className="tab-icon">
                  <ServerIcon />
                </span>
                <span className="side-name">{h.name}</span>
                {!h.builtin && (
                  <span className="row-actions">
                    <button
                      className="row-btn"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSsh(h.id);
                      }}
                    >
                      <CloseSquareIcon />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </>
        )}

        {utilMenu && (
          <>
            <div className="menu-backdrop" onMouseDown={() => setUtilMenu(null)} />
            <div className="ctx-menu" style={{ left: utilMenu.x, top: utilMenu.y }}>
              <button
                onClick={() => {
                  onEditUtility(utilMenu.util);
                  setUtilMenu(null);
                }}
              >
                Edit
              </button>
              <div className="ctx-sep" />
              <button
                className="danger"
                onClick={() => {
                  onRemoveUtility(utilMenu.util.id);
                  setUtilMenu(null);
                }}
              >
                Delete
              </button>
            </div>
          </>
        )}

        {tabMenu && (
          <>
            <div className="menu-backdrop" onMouseDown={() => setTabMenu(null)} />
            <div
              className="ctx-menu"
              // keep the menu on screen when opened near the bottom edge
              style={{ left: tabMenu.x, top: Math.min(tabMenu.y, window.innerHeight - 112) }}
            >
              <button
                onClick={() => {
                  startRename(tabMenu.tab);
                  setTabMenu(null);
                }}
              >
                <RenameIcon />
                Rename
              </button>
              <button
                onClick={() => {
                  onPin({ type: "tab", id: tabMenu.tab.id });
                  setTabMenu(null);
                }}
              >
                <PinIcon />
                Pin
              </button>
              <div className="ctx-sep" />
              <button
                onClick={() => {
                  onClose(tabMenu.tab.id);
                  setTabMenu(null);
                }}
              >
                <CloseSquareIcon />
                Close
              </button>
            </div>
          </>
        )}

        {looseTabs.length > 0 && (
          <>
            {/* no "Terminals" header — loose tabs are just separated by a gap */}
            <div className="loose-gap" />
            {looseTabs.map((t) => renderTab(t, false))}
          </>
        )}
      </div>
      <div className="side-footer">
        <button
          className="side-action"
          title="Settings (Ctrl+,)"
          onClick={onOpenSettings}
        >
          <span className="tab-icon">
            <GearIcon />
          </span>
          <span>Settings</span>
        </button>
      </div>
      {tabDrag && (
        <div
          className="tab-drag-ghost"
          style={{ left: tabDrag.x + 12, top: tabDrag.y + 10 }}
        >
          <span className="tab-icon">
            {(() => {
              const t = tabs.find((x) => x.id === tabDrag.id);
              return t ? tabIcon(t) : <TerminalIcon />;
            })()}
          </span>
          <span>{tabDrag.title}</span>
        </div>
      )}
    </aside>
  );
}
