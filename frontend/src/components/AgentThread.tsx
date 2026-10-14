import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AGENTS } from "../lib/agents";
import { EngineSession } from "../lib/agent-engine/session";
import { providerInstance } from "../lib/agent-engine/config";
import { PermissionRequest } from "../lib/agent-engine/permissions";
import { EnginePermissionMode, getSettings, ReasoningEffort, updateSettings } from "../lib/settings";
import { setAgentStatus } from "../lib/agent-status";
import { getChat, saveChat } from "../lib/chat-store";
import { loadModelsDev, modelLogo } from "../lib/models-dev";
import { ContentBlock, Message } from "../lib/agent-engine/types";
import { notifyAgentEvent } from "../lib/notify";
import { discoverSkills, SkillMeta } from "../lib/agent-engine/skills";
import { FileMatch, browseFiles, listProjectFiles, mentionToDiskPath } from "../lib/file-search";
import { invoke } from "../backend/core";
import { getBgAgent, getBgAgents, markBgAgentReported, onBgAgentFinished, onBgAgentsChange } from "../lib/bg-agents";
import MeshAvatar from "./MeshAvatar";
import { SquircleBox, GridSpiral, ShieldIcon, FullAccessIcon, SandboxIcon, ModeCheck, BulbIcon, ContextGauge, ToolIcon } from "./agent/icons";
import { ensureSandbox } from "../lib/sandbox";
import SandboxMergeModal from "./SandboxMergeModal";

// One continuous conversation is a chronological list of items. Agent prose,
// tool calls ("Ran …"), plan updates and the "Worked for Xs" divider are
// appended in arrival order so it reads like a Codex thread.
// A user attachment: an image (thumbnail + vision block) or a text file
// (its content is inlined into the prompt).
interface Attachment {
  id: string;
  name: string;
  kind: "image" | "file";
  dataUrl?: string; // images
  text?: string; // text files
}

// Stable identity — a fresh array per render invalidated ReactMarkdown's memo.
const REMARK_PLUGINS = [remarkGfm];

// Memoized markdown block: the settled prefix of a streaming text item keeps a
// stable string reference across rAF flushes (it only grows when a new blank
// line arrives), so this parses ONCE instead of re-parsing the whole response
// every frame. Only the live tail paragraph (after the last "\n\n") re-parses.
const SettledMarkdown = memo(function SettledMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown>;
});

// A rotating, time-of-day-aware greeting for the empty-chat hero — picked once
// per chat so it varies (a fresh chat reads differently, late nights differ
// from mornings) instead of always being the same line.
function heroGreeting(name: string | null): string {
  const h = new Date().getHours();
  const proj = name ? ` in ${name}` : "";
  const pool = [
    `What are we building${proj}?`,
    `What should we build${proj}?`,
    "What's on your mind?",
    "Where do we start?",
    "What are we shipping?",
    "Let's make something good.",
    "Where were we?",
  ];
  if (h < 5 || h >= 23)
    pool.push("Still up? Let's build.", "Late one — what are we making?");
  else if (h < 12)
    pool.push("Good morning. What's first?", `Morning — what are we building${proj}?`);
  else if (h < 18) pool.push("What's next?", "Afternoon — let's build.");
  else
    pool.push("Good evening. What are we shipping?", `Evening — what are we building${proj}?`);
  return pool[Math.floor(Math.random() * pool.length)];
}

// Windowing: render only the most recent N transcript items (older load on
// demand), and cap what we persist so a huge chat's file + JSON.stringify stay
// bounded (engine history is separately bounded by compaction).
const VISIBLE_TAIL = 60;
const VISIBLE_STEP = 120;
const MAX_PERSIST_ITEMS = 1500;
// Reasoning can stream tens of KB in fast mode. Cap what we KEEP for a thought
// block (its tail is what matters), and while it's LIVE render only a small tail
// — laying out the whole growing text every animation frame is what lagged.
const THOUGHT_STORE_CAP = 24000;
const LIVE_THOUGHT_TAIL = 1500;

type Item =
  | { k: "user"; id: string; text: string; atts?: Attachment[] }
  | { k: "text"; id: string; text: string }
  | { k: "thought"; id: string; text: string; done?: boolean; open?: boolean }
  | { k: "tool"; id: string; toolId: string; title: string; status: string; kind?: string }
  | { k: "plan"; id: string; entries: PlanEntry[] }
  | { k: "worked"; id: string; seconds: number }
  | { k: "note"; id: string; text: string }
  | { k: "error"; id: string; text: string };

// A pending tool-permission request — rendered as a compact bar above the
// composer (not mixed into the scrollback), since there's only ever at most
// one in flight (the loop awaits one tool's approval before the next).
interface PendingPermission {
  reqId: string;
  summary: string;
}

interface PlanEntry {
  content: string;
  status: string;
  priority?: string;
}

interface AgentThreadProps {
  id: string;
  agentId: string;
  cwd: string;
  name: string;
  dimmed: boolean;
  onFocus: () => void;
  onClose: () => void;
  /** Called with the first prompt so the tab gets named after it. */
  onRename: (title: string) => void;
}

const workedLabel = (s: number) =>
  s >= 60 ? `Worked for ${Math.floor(s / 60)}m ${s % 60}s` : `Worked for ${s}s`;


// Reasoning-depth choices for the composer dropdown. "auto" = model's native
// default (nothing sent), "none" = thinking off; the rest map to the API's
// reasoning_effort. Ordered strongest→off, like a real menu.
const REASONING_LEVELS: { v: ReasoningEffort; label: string }[] = [
  { v: "auto", label: "Auto" },
  { v: "max", label: "Max" },
  { v: "high", label: "High" },
  { v: "medium", label: "Medium" },
  { v: "low", label: "Low" },
  { v: "none", label: "Off" },
];
const reasoningLabel = (v: ReasoningEffort): string =>
  REASONING_LEVELS.find((l) => l.v === v)?.label ?? "Auto";

// Read a dropped/picked/pasted File into an Attachment: images become a
// data URL (vision), everything else is read as text and inlined.
const IMG_RE = /^image\//;
async function readAttachment(file: File): Promise<Attachment | null> {
  const id = crypto.randomUUID();
  const name = file.name || (IMG_RE.test(file.type) ? "pasted-image.png" : "file");
  try {
    if (IMG_RE.test(file.type)) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      return { id, name, kind: "image", dataUrl };
    }
    // cap huge files so the prompt stays sane
    const text = (await file.text()).slice(0, 60_000);
    return { id, name, kind: "file", text };
  } catch {
    return null;
  }
}

// Leading "/skill-name" when it matches a known skill → [token, rest].
function splitSlashToken(text: string, skillNames: Set<string>): [string, string] | null {
  const m = text.match(/^\/(\S+)(\s[\s\S]*|)$/);
  if (m && skillNames.has(m[1].toLowerCase())) return [`/${m[1]}`, m[2]];
  return null;
}

// The "@file" token being typed at the caret, if any: the nearest "@" before
// the caret with no whitespace between it and the caret, and itself at a word
// boundary (start or after whitespace) so an email like a@b never triggers.
function findAtToken(text: string, caret: number): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      const before = i === 0 ? "" : text[i - 1];
      if (i === 0 || /\s/.test(before)) return { start: i, query: text.slice(i + 1, caret) };
      return null;
    }
    if (/\s/.test(ch)) return null; // whitespace before an "@" → not a mention
  }
  return null;
}

// Highlight "@path" file mentions inside a sent user message (path-ish tokens
// only, so a stray "@name" stays plain). Mirrors the "/skill" highlight.
const MENTION_RE = /(^|\s)(@[^\s]+)/g;
function renderWithMentions(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  MENTION_RE.lastIndex = 0;
  for (let m = MENTION_RE.exec(text); m; m = MENTION_RE.exec(text)) {
    const token = m[2];
    if (!/[./]/.test(token)) continue; // only file-looking mentions
    const start = m.index + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <span className="chat-mention" key={k++}>
        {token}
      </span>,
    );
    last = start + token.length;
  }
  if (out.length === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Render a file path with the fuzzy-matched characters bolded (runs grouped
// into as few spans as possible).
function highlightHits(path: string, hits: number[]): ReactNode {
  if (!hits.length) return path;
  const set = new Set(hits);
  const nodes: ReactNode[] = [];
  let buf = "";
  let bufHit = false;
  let k = 0;
  const flush = () => {
    if (!buf) return;
    nodes.push(bufHit ? <b key={k++}>{buf}</b> : <span key={k++}>{buf}</span>);
    buf = "";
  };
  for (let i = 0; i < path.length; i++) {
    const h = set.has(i);
    if (h !== bufHit) {
      flush();
      bufHit = h;
    }
    buf += path[i];
  }
  flush();
  return nodes;
}

// The folder level a query points into ("src/lib/foo" → "src/lib/", "foo" → "").
const dirPrefix = (q: string) => {
  const i = q.lastIndexOf("/");
  return i >= 0 ? q.slice(0, i + 1) : "";
};
// Cap for the @-menu viewport height (leaves room for the panel's own padding).
const AT_VIEWPORT_MAX = 276;

const AtFolderIcon = () => (
  <svg className="at-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);
const AtFileIcon = () => (
  <svg className="at-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M18 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2Z" />
  </svg>
);
const AtChevron = () => (
  <svg className="at-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// One memoized transcript row. Streaming replaces ONLY the tail item's object,
// so every other row (and its parsed markdown) skips re-render entirely —
// without this, each token re-rendered the whole visible transcript and long
// chats lagged hard while the model streamed text or thinking.
const ItemRow = memo(function ItemRow({
  item,
  skillNames,
  onToggleThought,
}: {
  item: Item;
  skillNames: Set<string>;
  onToggleThought: (id: string) => void;
}) {
  switch (item.k) {
    case "user": {
      const parts = splitSlashToken(item.text, skillNames);
      return (
        <div className="chat-user">
          {item.atts && item.atts.length > 0 && (
            <div className="chat-atts">
              {item.atts.map((a) =>
                a.kind === "image" ? (
                  <img key={a.id} className="chat-att-img" src={a.dataUrl} alt={a.name} />
                ) : (
                  <span key={a.id} className="chat-att-file">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                      <path d="M18 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2Z" />
                    </svg>
                    {a.name}
                  </span>
                ),
              )}
            </div>
          )}
          {item.text &&
            (parts ? (
              <span className="chat-user-text">
                <span className="chat-skill">{parts[0]}</span>
                {parts[1]}
              </span>
            ) : (
              <span className="chat-user-text">{renderWithMentions(item.text)}</span>
            ))}
        </div>
      );
    }
    case "text": {
      // Split at the last blank line: the settled prefix keeps a stable string
      // reference between frames (only grows on a new paragraph), so its
      // SettledMarkdown parses once. Only the live tail paragraph re-parses
      // per rAF — O(1) per frame instead of O(n²) over the whole response.
      const idx = item.text.lastIndexOf("\n\n");
      const settled = idx > 0 ? item.text.slice(0, idx) : "";
      const live = idx > 0 ? item.text.slice(idx + 2) : item.text;
      return (
        <div className="chat-text markdown">
          {settled && <SettledMarkdown text={settled} />}
          {live && <SettledMarkdown text={live} />}
        </div>
      );
    }
    case "thought":
      // One persistent node across live → done, so the state change
      // transitions smoothly instead of the block snapping/re-mounting.
      return (
        <div className={`chat-thought${item.done ? "" : " live"}${item.open ? " open" : ""}`}>
          <button
            className="thought-head"
            onClick={() => item.done && onToggleThought(item.id)}
          >
            <BulbIcon />
            <span className="thought-label">{item.done ? "Thought" : "Thinking…"}</span>
          </button>
          <div className="thought-body">
            {/* live: only the visible tail is rendered (the body is masked to
                ~96px anyway) so layout per frame is O(1), not O(total reasoning).
                Once done + expandable, the full stored text shows. */}
            <div>{item.done ? item.text : item.text.slice(-LIVE_THOUGHT_TAIL)}</div>
          </div>
        </div>
      );
    case "tool":
      return (
        <div className={`chat-tool s-${item.status}`}>
          <ToolIcon kind={item.kind} status={item.status} />
          <span className="chat-tool-title">{item.title}</span>
        </div>
      );
    case "plan":
      return (
        <div className="agent-plan">
          {item.entries.map((p, i) => (
            <div className={`agent-plan-row s-${p.status}`} key={i}>
              <span className="agent-plan-dot" />
              <span className="agent-plan-text">{p.content}</span>
            </div>
          ))}
        </div>
      );
    case "worked":
      return (
        <div className="chat-worked">
          <span>{workedLabel(item.seconds)}</span>
        </div>
      );
    case "note":
      return (
        <div className="chat-worked">
          <span>{item.text}</span>
        </div>
      );
    case "error":
      return <div className="agent-error">{item.text}</div>;
  }
});

export default function AgentThread({
  id,
  agentId: initialAgent,
  cwd,
  name,
  dimmed,
  onFocus,
  onRename,
}: AgentThreadProps) {
  // Read-only viewer for a background agent's chat: agentId "bg:<id>". The
  // transcript mirrors the bg-agents store; the composer becomes a "driven by
  // agent" panel and no engine session is ever created here. (typeof guard:
  // stray non-string agentIds must fall through to the normal chat path.)
  const bgId =
    typeof initialAgent === "string" && initialAgent.startsWith("bg:")
      ? initialAgent.slice(3)
      : null;

  // A previously saved chat with this id (tab restored after a restart)
  // seeds the transcript and, lazily, the engine's message history.
  const savedChat = useRef(bgId ? undefined : getChat(id)).current;
  const savedHistory = useRef<Message[] | null>(savedChat?.history ?? null);

  const [items, setItems] = useState<Item[]>(
    () => (savedChat?.items as Item[] | undefined) ?? [],
  );

  // Mirror the background agent's live transcript into this pane.
  useEffect(() => {
    if (!bgId) return;
    const sync = () => {
      const a = getBgAgent(bgId);
      // fresh array copy: the store mutates its array in place (O(1) per token)
      // and only item objects change identity — which is what the memoized
      // rows compare against.
      if (a) setItems(a.items.slice() as unknown as Item[]);
    };
    sync();
    return onBgAgentsChange(sync);
  }, [bgId]);
  // Only the tail of a long transcript is rendered — a huge chat would freeze
  // the pane if every item became a DOM node. "Show earlier" raises this.
  const [visibleCount, setVisibleCount] = useState(VISIBLE_TAIL);
  const [input, setInput] = useState("");
  // Picked once per mount so it stays stable while typing but differs per chat.
  const [hero] = useState(() => heroGreeting(name));
  const [busy, setBusy] = useState(false);
  // send-button "fly up" animation — a clone of the send icon lifts off
  // upward (compositor transform+opacity, zero reflow) on submit, then
  // unmounts on animationend. Lives OUTSIDE the busy ternary so it survives
  // the send→stop button swap.
  const [sendFly, setSendFly] = useState(false);
  // Corrections typed while the agent is working sit here as "waiting to send"
  // chips above the composer, then drop into the transcript once the engine
  // actually delivers them (onNotesFlushed) — not fired off immediately.
  const [pendingNotes, setPendingNotes] = useState<{ id: string; text: string }[]>([]);
  const pendingNotesRef = useRef(pendingNotes);
  pendingNotesRef.current = pendingNotes;
  // Ash is the sole agent — no picker. (`initialAgent` still drives the
  // background-agent viewer path via `bgId` above.)
  const agentId = "ash";
  // Active engine model — picked from the composer, persisted to settings and
  // applied to the live session so the next turn uses it.
  const [activeModelId, setActiveModelId] = useState(() => getSettings().engine.activeModelId);
  const [useFast, setUseFast] = useState(() => getSettings().engine.useFast);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  // Mounted through its close animation, same as the mode/think menus.
  const [modelPickerClosing, setModelPickerClosing] = useState(false);
  // Loaded once so the model picker can show models.dev provider logos.
  const [modelsReady, setModelsReady] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [permMode, setPermMode] = useState<EnginePermissionMode>(
    () => getSettings().engine.permissionMode,
  );
  // Safe mode: this chat's agent (and the agents it spawns) work in a sandbox
  // copy of the project; changes merge back only on approval. A third choice in
  // the same selector as Default permissions / Full access.
  const [safeMode, setSafeMode] = useState(() => getSettings().engine.safeMode);
  const [mergeOpen, setMergeOpen] = useState(false);
  // Shown once when the user flips ON safe mode, explaining the sandbox.
  const [safeInfoOpen, setSafeInfoOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  // Mounted through its close animation, same trick as the permission fringe.
  const [modeMenuClosing, setModeMenuClosing] = useState(false);
  // Model reasoning depth — persisted app-wide, applied live per session.
  const [reasoning, setReasoning] = useState<ReasoningEffort>(
    () => getSettings().engine.reasoningEffort,
  );
  const [thinkMenuOpen, setThinkMenuOpen] = useState(false);
  const [thinkMenuClosing, setThinkMenuClosing] = useState(false);
  const [contextUsage, setContextUsage] = useState(0);
  // Slash-command menu: skills + a couple of built-ins, filtered by the
  // "/word" being typed. Only for Ash's own engine.
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [slashSel, setSlashSel] = useState(0);
  const slashLoaded = useRef(false);
  // Keep the menu mounted through its close animation (input cleared / space).
  const [slashMounted, setSlashMounted] = useState(false);
  const [slashClosing, setSlashClosing] = useState(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const lastSlashCmds = useRef<{ name: string; desc: string }[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0); // enter/leave counter so child elements don't flicker it
  const fileInputRef = useRef<HTMLInputElement>(null);
  // "@file" mention menu — a project-file picker that inserts a relative path.
  const [atToken, setAtToken] = useState<{ start: number; query: string } | null>(null);
  const [atFiles, setAtFiles] = useState<string[]>([]);
  const atLoaded = useRef(false);
  const [atSel, setAtSel] = useState(0);
  const [atMounted, setAtMounted] = useState(false);
  const [atClosing, setAtClosing] = useState(false);
  const atMenuRef = useRef<HTMLDivElement>(null);
  const lastAtMatches = useRef<FileMatch[]>([]);
  // Caret to restore after we programmatically rewrite the input (on accept),
  // applied in a layout effect so it lands after React repaints the textarea.
  const pendingCaret = useRef<number | null>(null);
  // Folder-drill slide: when the level changes we render the OLD list as a
  // "leaving" layer sliding one way while the new list slides in the other, and
  // animate the viewport height between the two. Direction: push = go deeper
  // (old→left, new from right), pop = go up (old→right, new from left).
  const atCurrentRef = useRef<HTMLDivElement>(null);
  const atPrevDir = useRef("");
  const atPrevRows = useRef<FileMatch[]>([]);
  const atNonce = useRef(0);
  const [atHeight, setAtHeight] = useState<number | undefined>(undefined);
  const [atLeaving, setAtLeaving] = useState<
    { rows: FileMatch[]; dir: "push" | "pop"; nonce: number } | null
  >(null);
  const skillNames = useMemo(
    () => new Set(skills.map((s) => s.name.toLowerCase())),
    [skills],
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  // Seeded past the highest suffix of any RESTORED item id (saved ids were
  // `${id}:1..N`). Starting at 0 would mint `${id}:1` again → duplicate React
  // keys and wrong upsertTool matches against restored rows.
  const seq = useRef(-1);
  if (seq.current < 0) {
    let max = 0;
    for (const it of (savedChat?.items as { id?: string }[] | undefined) ?? []) {
      const m = /:(\d+)$/.exec(it.id ?? "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    seq.current = max;
  }
  const nextId = () => `${id}:${++seq.current}`;
  // Id of the live "compressing context" row (start → done).
  const compactToolId = useRef<string | null>(null);
  const turnStart = useRef(0);
  // Bumped when a turn starts AND when Stop is pressed. A settled prompt()
  // compares its captured generation against this: if it no longer matches, the
  // turn was superseded/stopped and endTurn/catch must NOT run a second time
  // (which used to push a contradictory "Worked for Xs" after "Stopped").
  const turnGen = useRef(0);
  // Ash's own engine: one session per thread, reused across follow-ups.
  const engineSession = useRef<EngineSession | null>(null);
  // Whether this session has been told (once) it's in a safe-mode sandbox.
  const safeAnnounced = useRef(false);

  // Auto-scroll only while the user is pinned to the bottom — force-scrolling
  // on every items change yanked the view away while they were reading up.
  const pinnedToBottom = useRef(true);
  const onBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (pinnedToBottom.current)
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [items]);

  // Moved into a workspace: re-point the live session's cwd (history intact)
  // and let the model know where it's working now.
  const prevCwd = useRef(cwd);
  useEffect(() => {
    if (prevCwd.current === cwd) return;
    prevCwd.current = cwd;
    if (engineSession.current) {
      engineSession.current.cwd = cwd;
      engineSession.current.queueNote(
        `[The user moved this chat into a different workspace — the working directory is now: ${cwd}]`,
      );
    }
  }, [cwd]);

  // Auto-grow the composer to fit its content (capped by max-height in CSS),
  // reset to auto first so it can also shrink when text is deleted/cleared.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  // Sidebar tab icon follows this pane: dots while working, check when done.
  const ranOnce = useRef(false);
  useEffect(() => {
    if (busy) ranOnce.current = true;
    setAgentStatus(id, busy ? "working" : ranOnce.current ? "done" : null);
  }, [busy, id]);
  useEffect(() => () => setAgentStatus(id, null), [id]);

  // Newest snapshot as a stable closure so beforeunload / unmount can flush it
  // synchronously — the debounced save alone is lost to a full page reload
  // (Vite HMR reload, app restart), which dropped the latest turns' context.
  const persistRef = useRef<() => void>(() => {});
  persistRef.current = () => {
    if (items.length === 0 || bgId) return; // bg viewers never persist a chat
    const firstUser = items.find((x) => x.k === "user");
    const title = firstUser
      ? firstUser.text.length > 34
        ? firstUser.text.slice(0, 34) + "…"
        : firstUser.text
      : name;
    // A compacted live history is authoritative even when it is shorter.
    const history = engineSession.current?.history ?? savedHistory.current ?? getChat(id)?.history ?? [];
    // cap the persisted transcript so a very long chat stays fast to serialize
    const savedItems = items.length > MAX_PERSIST_ITEMS ? items.slice(-MAX_PERSIST_ITEMS) : items;
    saveChat({ chatId: id, agentId, cwd, name, title, items: savedItems, history });
  };

  // Debounced periodic save during the session.
  useEffect(() => {
    if (items.length === 0) return;
    const t = setTimeout(() => persistRef.current(), 400);
    return () => clearTimeout(t);
  }, [items, agentId, cwd, id, name]);

  // Flush synchronously on page reload/close (Vite HMR reload, app restart) so
  // an interrupted session doesn't lose its most recent turns. Unmount flush is
  // handled in the dispose effect below (before the engine session is torn down).
  useEffect(() => {
    const flush = () => persistRef.current();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  useEffect(
    () => () => {
      // save the live history before tearing the session down
      persistRef.current();
      engineSession.current?.dispose();
      engineSession.current = null;
    },
    [],
  );

  // Wake this chat when a background agent it spawned finishes: mid-turn the
  // result arrives as a steering note on the next model call; when idle, it
  // starts a fresh turn — the "start agents and go to sleep" contract.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const wakeRef = useRef<
    (a: {
      id: string;
      name: string;
      task: string;
      status: string;
      result: string;
      startedAt?: number;
      finishedAt?: number;
    }) => void
  >(() => {});
  useEffect(() => {
    if (bgId) return;
    // Drain-on-mount: a child that finished while this owner chat was CLOSED
    // fired onBgAgentFinished once with no listener mounted, so its result was
    // never delivered (and is now held from eviction). Replay any finished-but-
    // unreported agents we own now that we're (re)mounted.
    getBgAgents()
      .filter(
        (a) =>
          a.ownerId === id &&
          !a.reported &&
          !a.managed &&
          (a.status === "done" || a.status === "failed"),
      )
      .forEach((a) => {
        markBgAgentReported(a.id);
        wakeRef.current(a);
      });
    return onBgAgentFinished((a) => {
      // managed agents belong to a run_workflow orchestrator, which collects
      // their results itself — don't also deliver them here.
      if (a.ownerId !== id || a.reported || a.managed) return;
      markBgAgentReported(a.id);
      wakeRef.current(a);
    });
  }, [id, bgId]);

  // --- transcript mutators (stable: only touch setItems + refs) -------------

  const appendText = (t: string) =>
    setItems((it) => {
      const last = it[it.length - 1];
      if (last?.k === "text") {
        const copy = it.slice();
        copy[copy.length - 1] = { ...last, text: last.text + t };
        return copy;
      }
      return [...it, { k: "text", id: nextId(), text: t }];
    });

  // Streaming reasoning: merge into the current open thought block. Cap the
  // stored text to its tail so a nonstop fast-mode stream can't grow it without
  // bound (and so the live slice below stays cheap).
  const appendThought = (t: string) =>
    setItems((it) => {
      const last = it[it.length - 1];
      if (last?.k === "thought" && !last.done) {
        const copy = it.slice();
        const merged = last.text + t;
        copy[copy.length - 1] = {
          ...last,
          text: merged.length > THOUGHT_STORE_CAP ? merged.slice(-THOUGHT_STORE_CAP) : merged,
        };
        return copy;
      }
      return [...it, { k: "thought", id: nextId(), text: t, done: false }];
    });

  // Real output started — collapse any open thought into its folded form.
  const sealThought = () =>
    setItems((it) => {
      if (!it.some((x) => x.k === "thought" && !x.done)) return it;
      return it.map((x) => (x.k === "thought" && !x.done ? { ...x, done: true } : x));
    });

  const upsertTool = (toolId: string, title: string, status: string, kind?: string) =>
    setItems((it) => {
      const i = it.findIndex((x) => x.k === "tool" && x.toolId === toolId);
      if (i >= 0) {
        const copy = it.slice();
        const cur = copy[i] as Extract<Item, { k: "tool" }>;
        copy[i] = { ...cur, title: title || cur.title, status, kind: kind ?? cur.kind };
        return copy;
      }
      return [...it, { k: "tool", id: nextId(), toolId, title, status, kind }];
    });

  // Coalesce streaming deltas into ONE state update per animation frame —
  // per-token setItems re-rendered the transcript hundreds of times a second,
  // which is what made long chats lag while the model streamed.
  const textBuf = useRef("");
  const thoughtBuf = useRef("");
  const streamRaf = useRef(0);
  const flushStream = () => {
    streamRaf.current = 0;
    if (thoughtBuf.current) {
      const t = thoughtBuf.current;
      thoughtBuf.current = "";
      appendThought(t);
    }
    if (textBuf.current) {
      const t = textBuf.current;
      textBuf.current = "";
      sealThought();
      appendText(t);
    }
  };
  const queueText = (t: string) => {
    textBuf.current += t;
    if (!streamRaf.current) streamRaf.current = requestAnimationFrame(flushStream);
  };
  const queueThought = (t: string) => {
    thoughtBuf.current += t;
    if (!streamRaf.current) streamRaf.current = requestAnimationFrame(flushStream);
  };
  useEffect(() => () => cancelAnimationFrame(streamRaf.current), []);

  // Expand/collapse a finished thought block (passed into memoized rows).
  const toggleThought = useCallback(
    (tid: string) =>
      setItems((it) =>
        it.map((x) => (x.k === "thought" && x.id === tid ? { ...x, open: !x.open } : x)),
      ),
    [],
  );

  const push = (item: Item) => setItems((it) => [...it, item]);

  const endTurn = async (gen: number) => {
    if (gen !== turnGen.current) return; // superseded by Stop or a newer turn
    flushStream(); // drain any buffered tail of the stream first
    const secs = Math.max(1, Math.round((Date.now() - turnStart.current) / 1000));
    push({ k: "worked", id: nextId(), seconds: secs });
    setBusy(false);
    // persist the final history immediately (file writes are async and can be
    // lost to a reload if we only relied on the debounce / beforeunload).
    persistRef.current();
    notifyAgentEvent("done", `${name} · Agent`, "Task finished");
  };

  // Ash's own agent-engine: lazily builds one session per thread (reused
  // across follow-ups, same rationale as ensureConn) and drives a turn.
  const runEngine = async (prompt: string, blocks: ContentBlock[] = []) => {
    const gen = ++turnGen.current;
    try {
      // Safe mode: resolve this turn's working dir FIRST — a per-chat sandbox
      // copy of the project (created lazily) so the real project stays untouched
      // until the user merges. Resolved before the session is built so its
      // system prompt points at the sandbox; the background agents this chat
      // spawns inherit this cwd, so they're sandboxed too. Off → the live dir.
      let workCwd = cwd;
      if (safeMode) {
        if (!cwd) throw new Error("Safe mode needs an opened workspace folder.");
        try {
          workCwd = (await ensureSandbox(id, cwd)).path;
        } catch (e) {
          throw new Error(
            `Safe mode couldn't create an isolated sandbox, so the agent was not started: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      if (!engineSession.current) {
        engineSession.current = new EngineSession(workCwd, {
          onText: queueText,
          onThought: queueThought,
          onToolCall: (toolId, title, status, kind) => {
            flushStream(); // keep ordering: buffered prose lands before the tool row
            sealThought();
            upsertTool(toolId, title, status, kind);
          },
          onPermissionRequest: (req: PermissionRequest) => {
            setPendingPermission({ reqId: req.id, summary: req.summary });
            notifyAgentEvent("confirm", `${name} · Agent`, `Needs approval: ${req.summary}`);
          },
          onCompacting: (status) => {
            flushStream();
            if (status === "start") {
              compactToolId.current = `compact:${nextId()}`;
              upsertTool(compactToolId.current, "Compressing context…", "in_progress", "compact");
            } else if (compactToolId.current) {
              upsertTool(compactToolId.current, "Context compressed", "completed", "compact");
              compactToolId.current = null;
            }
          },
          onContext: (u) => setContextUsage(u),
          onMergeReview: () => setMergeOpen(true),
          onNotesFlushed: () => {
            // Delivered — move the waiting chips into the transcript as user rows.
            const notes = pendingNotesRef.current;
            if (!notes.length) return;
            notes.forEach((n) => push({ k: "user", id: n.id, text: n.text }));
            setPendingNotes([]);
          },
          onError: (msg) => {
            flushStream();
            push({ k: "error", id: nextId(), text: msg });
          },
        }, id, undefined, safeMode ? { root: workCwd, interactive: true } : undefined);
        // Restored chat: hand the engine its previous conversation so
        // follow-ups keep full context across app restarts.
        if (savedHistory.current?.length) {
          engineSession.current.history = savedHistory.current;
          savedHistory.current = null;
          engineSession.current.reportContext();
        }
        safeAnnounced.current = false;
      }
      // A reused session follows the toggle (fresh ones were built with it).
      engineSession.current.cwd = workCwd;
      engineSession.current.safety = safeMode
        ? { root: workCwd, interactive: true }
        : undefined;
      // First turn inside the sandbox: tell the agent it's in safe mode and how
      // to hand the work back (it proposes the merge itself — there's no button).
      if (workCwd !== cwd && !safeAnnounced.current) {
        safeAnnounced.current = true;
        engineSession.current.queueNote(
          "You are working in SAFE MODE: this is an isolated sandbox COPY of the project. Stay inside its working directory: never use absolute paths or ../ to reach outside it. Dependencies are not linked from the real project; if a command needs them, install them only in this sandbox. Risky commands are independently reviewed and may require the user's approval. Do the whole task first. Call the propose_merge tool ONLY at the very end — once the ENTIRE task is genuinely finished and (where it applies) verified. Never propose the merge early, mid-task, or after just a partial change; it must be your last action. It shows the user everything you changed so they can merge into the real project (or discard). Don't mention a merge button; you propose the merge yourself.",
        );
      }
      await engineSession.current.prompt(prompt, blocks);
      await endTurn(gen);
    } catch (e) {
      if (gen !== turnGen.current) return; // stopped/superseded — swallow
      const msg = e instanceof Error ? e.message : String(e);
      push({ k: "error", id: nextId(), text: msg });
      setBusy(false);
    }
  };

  // Deliver a finished background agent's result (see the wake effect above).
  wakeRef.current = (a) => {
    // Work time shown right in the chat row (not the sidebar).
    const secs =
      a.startedAt && a.finishedAt ? Math.max(1, Math.round((a.finishedAt - a.startedAt) / 1000)) : 0;
    const took = secs ? ` · ${secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}` : "";
    upsertTool(`bga:${a.id}`, `${a.name} ${a.status === "failed" ? "failed" : "finished"}${took}`, "completed", "agent-done");
    const note = `[Background agent "${a.name}" ${a.status === "failed" ? "FAILED" : "finished"}]\nTask: ${a.task}\nResult:\n${a.result || "(no final text)"}`;
    if (busyRef.current && engineSession.current) {
      engineSession.current.queueNote(note);
      return;
    }
    setBusy(true);
    // Sync so a same-tick second wake (e.g. draining several finished agents on
    // mount) queues its note onto the turn runEngine starts below, instead of
    // launching a second concurrent turn on the same session.
    busyRef.current = true;
    turnStart.current = Date.now();
    runEngine(note);
  };

  const respondPermission = (approved: boolean) => {
    if (!pendingPermission) return;
    setPendingPermission(null);
    engineSession.current?.resolvePermission(pendingPermission.reqId, approved);
  };

  const closeModeMenu = () => {
    if (modeMenuClosing) return;
    setModeMenuClosing(true);
    window.setTimeout(() => {
      setModeMenuOpen(false);
      setModeMenuClosing(false);
    }, 110);
  };

  // The composer's mode selector is a single 3-way: Default permissions
  // (confirm, real project), Full access (full-auto, real project), and Safe
  // mode (full-auto inside a project sandbox). Persisted app-wide AND applied to
  // the live session so a mid-conversation switch takes effect on the next turn.
  // (The sandbox cwd itself is (re)resolved per prompt in runEngine.)
  const applyAgentMode = (mode: "confirm" | "full-auto" | "safe") => {
    const wasSafe = safeMode;
    const safe = mode === "safe";
    const perm: EnginePermissionMode = mode === "confirm" ? "confirm" : "full-auto";
    setSafeMode(safe);
    setPermMode(perm);
    updateSettings({
      engine: { ...getSettings().engine, permissionMode: perm, safeMode: safe },
    });
    engineSession.current?.permissions.setMode(perm);
    // Turning safe mode ON: explain it once, and mark the swap in the transcript.
    if (safe && !wasSafe) {
      setSafeInfoOpen(true);
      if (items.length) push({ k: "note", id: nextId(), text: "Swapped to safe mode" });
    }
  };

  // Reasoning depth: persisted app-wide AND applied to the live session, so
  // changing it takes effect on the very next model call.
  const switchReasoning = (v: ReasoningEffort) => {
    setReasoning(v);
    updateSettings({ engine: { ...getSettings().engine, reasoningEffort: v } });
    if (engineSession.current) engineSession.current.reasoningEffort = v;
  };
  const closeThinkMenu = () => {
    if (thinkMenuClosing) return;
    setThinkMenuClosing(true);
    window.setTimeout(() => {
      setThinkMenuOpen(false);
      setThinkMenuClosing(false);
    }, 110);
  };

  // Switch the active engine model (and normal/fast variant): persist AND
  // update the live session's resolved config so the very next turn uses the
  // new model / window / vision.
  // Models live under providers now; the picker groups by provider and a pick
  // can cross providers, so applyModel takes the provider id too and rebuilds
  // the live session's adapter when the endpoint changes.
  const eng = getSettings().engine;
  const activeProv =
    eng.providers.find((p) => p.id === eng.activeProviderId) ?? eng.providers[0];
  const engineModels = activeProv?.models ?? [];
  const activeModel = engineModels.find((m) => m.id === activeModelId) ?? engineModels[0];
  // Stored logo, or one live-resolved from the loaded models.dev catalog.
  const logoOf = (m?: { modelId: string; logo?: string }): string | undefined =>
    m ? (modelsReady ? modelLogo(m) : m.logo) : undefined;
  useEffect(() => {
    loadModelsDev()
      .then(() => setModelsReady(true))
      .catch(() => {});
  }, []);
  const applyModel = (providerId: string, id: string, fast: boolean) => {
    setActiveModelId(id);
    setUseFast(fast);
    const next = {
      ...getSettings().engine,
      activeProviderId: providerId,
      activeModelId: id,
      useFast: fast,
    };
    updateSettings({ engine: next });
    const prov = next.providers.find((p) => p.id === providerId);
    const m = prov?.models.find((x) => x.id === id);
    const sess = engineSession.current;
    if (prov && m && sess) {
      // Provider may differ from the one the live session was built with —
      // rebuild the adapter so the very next turn hits the right endpoint.
      sess.config.provider = providerInstance(prov);
      sess.config.model = fast && m.fastId ? m.fastId : m.modelId;
      sess.config.safetyModel = fast ? m.modelId : (m.fastId ?? m.modelId);
      sess.config.contextWindow = m.contextWindow;
      sess.config.supportsImages = m.supportsImages;
      sess.reportContext();
    }
  };
  const closeModelPicker = () => {
    if (modelPickerClosing) return;
    setModelPickerClosing(true);
    window.setTimeout(() => {
      setModelPickerOpen(false);
      setModelPickerClosing(false);
    }, 110);
  };
  const pickModel = (providerId: string, id: string) => {
    closeModelPicker();
    applyModel(providerId, id, useFast);
  };
  // One-click fast toggle (footer button) — no submenu digging.
  const toggleFast = () =>
    applyModel(activeProv?.id ?? eng.activeProviderId, activeModelId, !useFast);

  // ── Slash commands ─────────────────────────────────────
  const isEngine = !!AGENTS.find((a) => a.id === agentId)?.engine;
  // Load skills once, lazily, when the user first reaches for "/".
  const loadSkills = () => {
    if (slashLoaded.current) return;
    slashLoaded.current = true;
    discoverSkills(cwd).then(setSkills).catch(() => {});
  };
  type SlashCmd = { name: string; desc: string; run: () => void };
  const builtinCmds: SlashCmd[] = [
    {
      name: "clear",
      desc: "Start a fresh chat (clears this conversation)",
      run: () => {
        engineSession.current?.dispose();
        engineSession.current = null;
        setItems([]);
        setContextUsage(0);
        setInput("");
      },
    },
    {
      name: "compact",
      desc: "Compress the conversation context now",
      run: () => {
        setInput("");
        const note = (text: string) =>
          push({ k: "tool", id: nextId(), toolId: nextId(), title: text, status: "completed", kind: "compact" });
        const s = engineSession.current;
        if (!s || s.history.length < 2) {
          note("Nothing to compress yet");
          return;
        }
        s.compactNow()
          .then((did) => {
            if (!did) note("Already compact");
          })
          .catch((e) => push({ k: "error", id: nextId(), text: e instanceof Error ? e.message : String(e) }));
      },
    },
  ];
  // The "/word" currently being typed (menu shows while there's no space yet).
  const slashQuery =
    isEngine && /^\/\S*$/.test(input) ? input.slice(1).toLowerCase() : null;
  const slashCmds: SlashCmd[] =
    slashQuery === null
      ? []
      : [
          ...builtinCmds,
          ...skills.map((s) => ({
            name: s.name,
            desc: s.description,
            run: () => setInput(`/${s.name} `),
          })),
        ].filter((c) => c.name.toLowerCase().includes(slashQuery));
  const slashOpen = slashCmds.length > 0;

  const runSlash = (c: { name: string }) => {
    const b = builtinCmds.find((x) => x.name === c.name);
    if (b) b.run();
    else setInput(`/${c.name} `);
  };

  // Remember the last visible command list so it survives the exit animation.
  if (slashOpen) lastSlashCmds.current = slashCmds;
  const shownSlash = slashOpen ? slashCmds : lastSlashCmds.current;

  // Mount + delayed-unmount so the menu can animate on both open and close.
  useEffect(() => {
    if (slashOpen) {
      setSlashMounted(true);
      setSlashClosing(false);
    } else if (slashMounted) {
      setSlashClosing(true);
      const t = window.setTimeout(() => setSlashMounted(false), 140);
      return () => window.clearTimeout(t);
    }
  }, [slashOpen, slashMounted]);

  // Keep the highlighted command scrolled into view on arrow navigation.
  useEffect(() => {
    slashMenuRef.current
      ?.querySelector(".slash-item.sel")
      ?.scrollIntoView({ block: "nearest" });
  }, [slashSel, slashMounted]);

  // ── @file mentions ─────────────────────────────────────
  const loadAtFiles = () => {
    if (atLoaded.current) return;
    atLoaded.current = true;
    listProjectFiles(cwd).then(setAtFiles).catch(() => {});
  };
  // Moved to a new workspace → the file list belongs to the old cwd; drop it.
  useEffect(() => {
    atLoaded.current = false;
    setAtFiles([]);
    setAtToken(null);
  }, [cwd]);

  // Recompute the active "@token" from the textarea value + caret. The slash
  // menu owns a leading "/command", so stand down while the input starts with "/".
  const recomputeAt = (value: string, caret: number) => {
    if (!isEngine || value.startsWith("/")) {
      setAtToken((prev) => (prev ? null : prev));
      return;
    }
    const tok = findAtToken(value, caret);
    if (tok) loadAtFiles();
    setAtToken((prev) =>
      tok === null
        ? prev && null
        : prev && prev.start === tok.start && prev.query === tok.query
          ? prev
          : tok,
    );
  };
  const syncAtFromDom = () => {
    const ta = taRef.current;
    if (ta) recomputeAt(ta.value, ta.selectionStart ?? ta.value.length);
  };

  const atMatches = useMemo(
    () => (atToken ? browseFiles(atFiles, atToken.query) : []),
    [atToken, atFiles],
  );
  const atOpen = atToken !== null && atMatches.length > 0;
  useEffect(() => setAtSel(0), [atToken?.query]);
  if (atOpen) lastAtMatches.current = atMatches;
  const shownAt = atOpen ? atMatches : lastAtMatches.current;

  // Detect a folder-level change during render (so the leaving rows, the new
  // layer's key, and the slide direction are all decided in the same pass).
  // Setting state here is the supported "adjust state on change" pattern — the
  // ref guard makes it fire at most once per level change.
  const atDir = atToken ? dirPrefix(atToken.query) : "";
  if (atToken && atMounted && atDir !== atPrevDir.current) {
    const dir: "push" | "pop" =
      atDir.length > atPrevDir.current.length && atDir.startsWith(atPrevDir.current)
        ? "push"
        : "pop";
    atPrevDir.current = atDir;
    atNonce.current += 1;
    setAtLeaving({ rows: atPrevRows.current, dir, nonce: atNonce.current });
  }
  atPrevRows.current = shownAt;

  // Mount + delayed unmount so the menu animates open AND closed (same as slash).
  useEffect(() => {
    if (atOpen) {
      setAtMounted(true);
      setAtClosing(false);
    } else if (atMounted) {
      setAtClosing(true);
      const t = window.setTimeout(() => setAtMounted(false), 140);
      return () => window.clearTimeout(t);
    }
  }, [atOpen, atMounted]);
  useEffect(() => {
    atMenuRef.current?.querySelector(".at-item.sel")?.scrollIntoView({ block: "nearest" });
  }, [atSel, atMounted]);

  // Keep the viewport height tracking the current list (measured), so it eases
  // between levels / filter results via the CSS height transition.
  useLayoutEffect(() => {
    if (!atMounted) return;
    const el = atCurrentRef.current;
    if (!el) return;
    const h = Math.min(el.scrollHeight, AT_VIEWPORT_MAX);
    setAtHeight((prev) => (prev === h ? prev : h));
  }, [atMatches, atMounted, atLeaving]);
  // Reset the measured height when the menu closes so the next open re-measures.
  useEffect(() => {
    if (!atMounted) setAtHeight(undefined);
  }, [atMounted]);
  // Retire the leaving layer once its slide has played.
  useEffect(() => {
    if (!atLeaving) return;
    const t = window.setTimeout(() => setAtLeaving(null), 220);
    return () => window.clearTimeout(t);
  }, [atLeaving]);
  // When the menu is dismissed, forget the level so reopening doesn't slide.
  useEffect(() => {
    if (atToken) return;
    atPrevDir.current = "";
    atPrevRows.current = [];
    setAtLeaving(null);
  }, [atToken]);

  // Replace the "@query" at the caret with the pick. A folder drills in (no
  // trailing space, menu stays open listing its contents); a file inserts the
  // path + a trailing space and closes the menu.
  const acceptAt = (m: FileMatch) => {
    if (!atToken) return;
    const before = input.slice(0, atToken.start);
    const after = input.slice(atToken.start + 1 + atToken.query.length);
    const insert = m.isDir ? `@${m.path}` : `@${m.path} `;
    setInput(before + insert + after);
    pendingCaret.current = (before + insert).length;
    if (m.isDir) {
      setAtToken({ start: atToken.start, query: m.path });
      setAtSel(0);
    } else {
      setAtToken(null);
    }
  };
  // One @-menu row. `live` rows (the current layer) are selectable/clickable;
  // rows in the leaving layer are inert (mid-slide, about to be dropped).
  const atRow = (f: FileMatch, i: number, live: boolean) => (
    <button
      key={f.path}
      type="button"
      className={`slash-item at-item${f.isDir ? " dir" : ""}${live && i === atSel ? " sel" : ""}`}
      onMouseMove={live ? () => setAtSel(i) : undefined}
      onMouseDown={(e) => {
        e.preventDefault();
        if (live) acceptAt(f);
      }}
    >
      {f.isDir ? <AtFolderIcon /> : <AtFileIcon />}
      <span className="at-path">{highlightHits(f.path, f.hits)}</span>
      {f.isDir && <AtChevron />}
    </button>
  );

  useLayoutEffect(() => {
    if (pendingCaret.current == null) return;
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(pendingCaret.current, pendingCaret.current);
    }
    pendingCaret.current = null;
  });

  // Read "@path" mentions that resolve to real project files and append their
  // contents so the model gets them in context (like a dragged-in attachment).
  const inlineMentions = async (text: string): Promise<string> => {
    const known = new Set(atFiles);
    const seen = new Set<string>();
    const paths: string[] = [];
    MENTION_RE.lastIndex = 0;
    for (let m = MENTION_RE.exec(text); m; m = MENTION_RE.exec(text)) {
      const p = m[2].slice(1).replace(/[),.:;]+$/, "");
      // pull files the picker knows are real, or at least a path-looking token —
      // never chase a stray "@handle"
      if (!p || seen.has(p) || (!known.has(p) && !/[./]/.test(p))) continue;
      seen.add(p);
      paths.push(p);
    }
    if (!paths.length) return "";
    const CAP = 60_000;
    const parts: string[] = [];
    for (const p of paths.slice(0, 10)) {
      try {
        const content = await invoke<string | null>("read_text", {
          path: mentionToDiskPath(cwd, p),
        });
        if (content != null)
          parts.push(`\n\n--- Referenced file: ${p} ---\n${content.slice(0, CAP)}`);
      } catch {
        // not a readable file — leave the literal @mention for the model
      }
    }
    return parts.join("");
  };

  // ── Attachments ────────────────────────────────────────
  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const read = (await Promise.all(list.map(readAttachment))).filter(Boolean) as Attachment[];
    if (read.length) setAttachments((a) => [...a, ...read]);
  };
  const removeAttachment = (attId: string) =>
    setAttachments((a) => a.filter((x) => x.id !== attId));

  const submit = () => {
    if (bgId) return; // read-only viewer
    const raw = input.trim();
    const agent = AGENTS.find((a) => a.id === agentId);
    // Mid-task steering: while the engine is working, Enter queues the note —
    // it's delivered to the model right after the current tool/request instead
    // of stopping the session.
    if (busy) {
      if (raw && agent?.engine && engineSession.current) {
        engineSession.current.queueNote(raw);
        // Show it as a "waiting to send" chip above the composer; it lands in
        // the transcript when the engine delivers it (onNotesFlushed).
        setPendingNotes((p) => [...p, { id: nextId(), text: raw }]);
        setInput("");
      }
      return;
    }
    if (!raw && attachments.length === 0) return;
    if (!agent?.engine) return;

    // A bare "/clear" (or other built-in) runs its action instead of sending.
    if (agent.engine && raw.startsWith("/") && attachments.length === 0) {
      const word = raw.slice(1).split(/\s+/)[0].toLowerCase();
      const builtin = builtinCmds.find((b) => b.name === word);
      if (builtin) {
        builtin.run();
        return;
      }
    }

    // "/skill-name rest…" → tell the agent to use that skill on the rest.
    let prompt = raw;
    if (agent.engine && raw.startsWith("/")) {
      const [head, ...restParts] = raw.slice(1).split(/\s+/);
      const skill = skills.find((s) => s.name.toLowerCase() === head.toLowerCase());
      if (skill) {
        const rest = restParts.join(" ").trim();
        prompt = `Use the "${skill.name}" skill${rest ? ` for: ${rest}` : "."}`;
      }
    }

    // Attachments → text files inline into the prompt, images become blocks.
    const atts = attachments;
    const fileText = atts
      .filter((a) => a.kind === "file" && a.text)
      .map((a) => `\n\n--- Attached file: ${a.name} ---\n${a.text}`)
      .join("");
    if (fileText) prompt = prompt + fileText;
    const imageBlocks: ContentBlock[] = atts
      .filter((a) => a.kind === "image" && a.dataUrl)
      .map((a) => ({ type: "image", dataUrl: a.dataUrl! }));

    // First message names the tab, like a chat title.
    if (!items.some((x) => x.k === "user"))
      onRename((raw || atts[0]?.name || "chat").slice(0, 34));
    setInput("");
    setAttachments([]);
    setBusy(true);
    setSendFly(true);
    turnStart.current = Date.now();
    push({ k: "user", id: nextId(), text: raw, atts: atts.length ? atts : undefined });
    // Pull in any "@file" mentions' contents, then run — the transcript still
    // shows the raw text with the @path, the model gets the file inlined.
    const base = prompt;
    inlineMentions(raw)
      .then((extra) => runEngine(base + extra, imageBlocks))
      .catch(() => runEngine(base, imageBlocks));
  };

  const stop = () => {
    // Invalidate the in-flight turn's generation: when its prompt() finally
    // settles, endTurn/catch see the mismatch and don't run a second turn-end.
    turnGen.current++;
    engineSession.current?.cancel();
    // cancel() already denied any pending permission — retire its fringe too
    setPendingPermission(null);
    if (busy) push({ k: "note", id: nextId(), text: "Stopped" });
    setBusy(false);
  };

  const agent = AGENTS.find((a) => a.id === agentId);

  // Background-agent viewer: the composer is replaced by a "driven by the
  // agent" panel — its colored dot-matrix loader + name, nothing typeable.
  const bgAgent = bgId ? getBgAgent(bgId) : null;
  const composer = (followup: boolean) =>
    bgId ? (
      <div className="bgc-note">
        <MeshAvatar
          seed={bgId ?? ""}
          size={14}
          animating={bgAgent?.status === "working"}
          muted={bgAgent?.status === "waiting"}
        />
        <span>
          <b style={{ color: bgAgent?.color }}>{bgAgent?.name ?? "Agent"}</b>
          {bgAgent?.status === "working"
            ? " · driven by the agent — read-only"
            : bgAgent?.status === "done"
              ? " · finished"
              : bgAgent?.status === "failed"
                ? " · failed"
                : " · stopped"}
        </span>
      </div>
    ) : (
    <SquircleBox
      className={`agent-composer${agent?.engine ? " has-footbar" : ""}${dragOver ? " drop-over" : ""}`}
      radius={44}
      smoothing={1}
    >
      {pendingPermission && (
        <div className="agent-permcap">
          <span className="agent-permcap-text">{pendingPermission.summary}</span>
          <span className="agent-permcap-actions">
            <button className="allow" onClick={() => respondPermission(true)}>
              Allow
            </button>
            <button className="deny" onClick={() => respondPermission(false)}>
              Deny
            </button>
          </span>
        </div>
      )}
      {agent?.engine && (
        <>
          <div className="agent-permfoot">
            <div className="mode-drop-wrap">
              <button
                className={`mode-drop${permMode === "full-auto" && !safeMode ? " warn" : ""}${safeMode ? " safe" : ""}${modeMenuOpen && !modeMenuClosing ? " open" : ""}`}
                onClick={() => (modeMenuOpen ? closeModeMenu() : setModeMenuOpen(true))}
              >
                {safeMode ? <SandboxIcon /> : permMode === "full-auto" ? <FullAccessIcon /> : <ShieldIcon />}
                <span>{safeMode ? "Safe mode" : permMode === "full-auto" ? "Full access" : "Default permissions"}</span>
                <svg className="agent-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {modeMenuOpen && (
                <>
                  <div className="menu-backdrop" onMouseDown={closeModeMenu} />
                  <div className={`mode-menu${modeMenuClosing ? " closing" : ""}`}>
                    <button
                      className={!safeMode && permMode === "confirm" ? "sel" : ""}
                      onClick={() => {
                        applyAgentMode("confirm");
                        closeModeMenu();
                      }}
                    >
                      <ShieldIcon />
                      <span className="mode-opt-name">Default permissions</span>
                      {!safeMode && permMode === "confirm" && <ModeCheck />}
                    </button>
                    <button
                      className={!safeMode && permMode === "full-auto" ? "sel" : ""}
                      onClick={() => {
                        applyAgentMode("full-auto");
                        closeModeMenu();
                      }}
                    >
                      <FullAccessIcon />
                      <span className="mode-opt-name">Full access</span>
                      {!safeMode && permMode === "full-auto" && <ModeCheck />}
                    </button>
                    <button
                      className={safeMode ? "sel" : ""}
                      onClick={() => {
                        applyAgentMode("safe");
                        closeModeMenu();
                      }}
                    >
                      <SandboxIcon />
                      <span className="mode-opt-name">Safe mode</span>
                      {safeMode && <ModeCheck />}
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="mode-drop-wrap">
              <button
                className={`think-drop${reasoning !== "none" ? " on" : ""}${thinkMenuOpen && !thinkMenuClosing ? " open" : ""}`}
                onClick={() => (thinkMenuOpen ? closeThinkMenu() : setThinkMenuOpen(true))}
              >
                <BulbIcon />
                <span>
                  {reasoning === "auto"
                    ? "Thinking"
                    : reasoning === "none"
                      ? "No thinking"
                      : `Thinking · ${reasoningLabel(reasoning)}`}
                </span>
                <svg className="agent-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {thinkMenuOpen && (
                <>
                  <div className="menu-backdrop" onMouseDown={closeThinkMenu} />
                  <div className={`mode-menu${thinkMenuClosing ? " closing" : ""}`}>
                    {REASONING_LEVELS.map((lvl) => (
                      <button
                        key={lvl.v}
                        className={reasoning === lvl.v ? "sel" : ""}
                        onClick={() => {
                          switchReasoning(lvl.v);
                          closeThinkMenu();
                        }}
                      >
                        <span className="mode-opt-name">{lvl.label}</span>
                        {reasoning === lvl.v && <ModeCheck />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {activeModel?.fastId && (
              <button
                className={`fast-toggle${useFast ? " on" : ""}`}
                onClick={toggleFast}
                title={useFast ? "Fast variant on — click for the default model" : "Click to use the fast variant"}
              >
                <span className="fast-ico">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M10.9998 8.76844L4.90312 4.30838C3.60064 3.41122 2 4.57895 2 6.42632L2 17.5737C2 19.4211 3.60065 20.5888 4.90313 19.6916L10.9998 15.2316M10.9998 7.12303L10.9998 16.877C10.9998 18.4934 12.467 19.5152 13.661 18.7302L21.0784 13.8532C22.3069 13.0455 22.3069 10.9545 21.0784 10.1468L13.661 5.26983C12.467 4.48482 10.9998 5.50658 10.9998 7.12303Z" />
                  </svg>
                  <svg className="fast-fill" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2 17.5737L2 6.42632C2 4.57895 3.60064 3.41122 4.90312 4.30838L10.9998 8.76844L10.9998 7.12303C10.9998 5.50658 12.467 4.48482 13.661 5.26983L21.0784 10.1468C22.3069 10.9545 22.3069 13.0455 21.0784 13.8532L13.661 18.7302C12.467 19.5152 10.9998 18.4934 10.9998 16.877V15.2316L4.90313 19.6916C3.60065 20.5888 2 19.4211 2 17.5737Z" />
                  </svg>
                </span>
                <span>Fast</span>
              </button>
            )}
          </div>
        </>
      )}
      {slashMounted && (
        <div
          ref={slashMenuRef}
          className={`slash-menu${slashClosing ? " closing" : ""}`}
        >
          {shownSlash.map((c, i) => (
            <button
              key={c.name}
              className={`slash-item${i === slashSel ? " sel" : ""}`}
              onMouseMove={() => setSlashSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                runSlash(c);
              }}
            >
              <span className="slash-name">/{c.name}</span>
              <span className="slash-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      {atMounted && (
        <div ref={atMenuRef} className={`slash-menu at-menu${atClosing ? " closing" : ""}`}>
          <div className="at-viewport" style={atHeight != null ? { height: atHeight } : undefined}>
            {atLeaving && (
              <div key={`lv-${atLeaving.nonce}`} className={`at-layer leaving ${atLeaving.dir}`}>
                {atLeaving.rows.map((f, i) => atRow(f, i, false))}
              </div>
            )}
            <div
              key={atNonce.current}
              ref={atCurrentRef}
              className={`at-layer current${atLeaving ? ` ${atLeaving.dir}-in` : ""}`}
            >
              {shownAt.map((f, i) => atRow(f, i, true))}
            </div>
          </div>
        </div>
      )}
      <div
        className="agent-composer-body"
        onDragEnter={(e) => {
          if (isEngine && e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            dragDepth.current++;
            setDragOver(true);
          }
        }}
        onDragOver={(e) => {
          if (isEngine && e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          if (dragDepth.current > 0) dragDepth.current--;
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={(e) => {
          dragDepth.current = 0;
          setDragOver(false);
          if (isEngine && e.dataTransfer.files.length) {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }
        }}
      >
        {attachments.length > 0 && (
          <div className="attach-strip">
            {attachments.map((a) => (
              <div className={`attach-chip${a.kind === "image" ? " img" : ""}`} key={a.id}>
                {a.kind === "image" ? (
                  <img src={a.dataUrl} alt={a.name} />
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                      <path d="M18 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2Z" />
                    </svg>
                    <span className="attach-name">{a.name}</span>
                  </>
                )}
                <button
                  className="attach-x"
                  onClick={() => removeAttachment(a.id)}
                  title="Remove"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        {pendingNotes.length > 0 && (
          <div className="pending-notes">
            {pendingNotes.map((n) => (
              <div className="pending-note" key={n.id}>
                {n.text}
              </div>
            ))}
          </div>
        )}
        <div className="agent-textarea-wrap">
          <textarea
            ref={taRef}
            className="agent-textarea"
            value={input}
            placeholder={
              busy
                ? "Working… type a correction, Enter sends it without stopping"
                : followup
                  ? "Ask for follow-up changes…"
                  : "Ask anything…"
            }
            rows={1}
            onPaste={(e) => {
              if (isEngine && e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value.startsWith("/")) loadSkills();
              setSlashSel(0);
              recomputeAt(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onClick={syncAtFromDom}
            onKeyUp={syncAtFromDom}
          onKeyDown={(e) => {
            if (slashOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashSel((s) => Math.min(slashCmds.length - 1, s + 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashSel((s) => Math.max(0, s - 1));
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                runSlash(slashCmds[Math.min(slashSel, slashCmds.length - 1)]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setInput("");
                return;
              }
            }
            if (atOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAtSel((s) => Math.min(atMatches.length - 1, s + 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setAtSel((s) => Math.max(0, s - 1));
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                acceptAt(atMatches[Math.min(atSel, atMatches.length - 1)]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setAtToken(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          />
        </div>
        <div className="composer-row">
          {isEngine && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                className="composer-attach"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                title="Attach image or file"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </>
          )}
          {agent?.engine && engineModels.length > 0 && (
            <div className="agent-drop-wrap">
              <button
                className={`agent-drop model-pick${modelPickerOpen && !modelPickerClosing ? " open" : ""}`}
                onClick={() => (modelPickerOpen ? closeModelPicker() : setModelPickerOpen(true))}
                disabled={busy}
              >
                {logoOf(activeModel) && (
                  <img
                    className="model-pick-logo"
                    src={logoOf(activeModel)}
                    alt=""
                    onError={(e) => (e.currentTarget.style.display = "none")}
                  />
                )}
                <span className="agent-drop-name">{activeModel?.name ?? "Model"}</span>
                <svg className="agent-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {modelPickerOpen && (
                <>
                  <div className="menu-backdrop" onMouseDown={closeModelPicker} />
                  <div className={`agent-menu${modelPickerClosing ? " closing" : ""}`}>
                    {eng.providers
                      .filter((p) => p.models.length > 0)
                      .flatMap((p) =>
                        p.models.map((m) => {
                          const sel = m.id === activeModelId && p.id === eng.activeProviderId;
                          return (
                            <button
                              key={`${p.id}/${m.id}`}
                              className={sel ? "sel" : ""}
                              onClick={() => pickModel(p.id, m.id)}
                            >
                              {logoOf(m) && (
                                <img
                                  className="model-pick-logo"
                                  src={logoOf(m)}
                                  alt=""
                                  onError={(e) => (e.currentTarget.style.display = "none")}
                                />
                              )}
                              <span className="agent-opt-name">{m.name}</span>
                              {sel && (
                                <svg className="agent-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </button>
                          );
                        }),
                      )}
                  </div>
                </>
              )}
            </div>
          )}
          <span className="composer-spacer" />
          {agent?.engine && contextUsage > 0 && <ContextGauge usage={contextUsage} />}
          {busy ? (
            <button className="composer-send is-stop" onClick={stop} title="Stop">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ display: "block" }}>
                <path d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z" />
              </svg>
            </button>
          ) : (
            <button
              className="composer-send"
              disabled={!input.trim() && attachments.length === 0}
              onClick={submit}
              title="Run (Enter)"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
                <g transform="rotate(-90 12 12) translate(0.8 0)" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.51002 4.23001L18.07 8.51001C21.91 10.43 21.91 13.57 18.07 15.49L9.51002 19.77C3.75002 22.65 1.40002 20.29 4.28002 14.54L5.15002 12.81C5.37002 12.37 5.37002 11.64 5.15002 11.2L4.28002 9.46001C1.40002 3.71001 3.76002 1.35001 9.51002 4.23001Z" />
                  <path d="M5.44 12H10.84" />
                </g>
              </svg>
            </button>
          )}
          {sendFly && (
            <div className="send-fly-clip">
              <svg
                className="send-fly"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                onAnimationEnd={() => setSendFly(false)}
              >
                <g transform="rotate(-90 12 12) translate(0.8 0)" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.51002 4.23001L18.07 8.51001C21.91 10.43 21.91 13.57 18.07 15.49L9.51002 19.77C3.75002 22.65 1.40002 20.29 4.28002 14.54L5.15002 12.81C5.37002 12.37 5.37002 11.64 5.15002 11.2L4.28002 9.46001C1.40002 3.71001 3.76002 1.35001 9.51002 4.23001Z" />
                  <path d="M5.44 12H10.84" />
                </g>
              </svg>
            </div>
          )}
        </div>
      </div>
    </SquircleBox>
  );

  return (
    <div
      className={`pane agent-pane${dimmed ? " dim" : ""}`}
      data-pane-id={id}
      onMouseDownCapture={onFocus}
    >
      {items.length === 0 ? (
        <div className="agent-hero">
          <div className="agent-hero-title">{hero}</div>
          {composer(false)}
        </div>
      ) : (
        <>
          <div className="agent-body chat" ref={bodyRef} onScroll={onBodyScroll}>
            <div className="chat-col">
              {items.length > visibleCount && (
                <button
                  className="chat-load-earlier"
                  onClick={() => setVisibleCount((c) => c + VISIBLE_STEP)}
                >
                  Show earlier messages ({items.length - visibleCount})
                </button>
              )}
              {(items.length > visibleCount ? items.slice(-visibleCount) : items).map((it) => (
                <ItemRow key={it.id} item={it} skillNames={skillNames} onToggleThought={toggleThought} />
              ))}
              {(bgId ? bgAgent?.status === "working" : busy) && (
                <div className="chat-working">
                  {bgAgent ? (
                    <MeshAvatar seed={bgAgent.id} size={22} animating />
                  ) : (
                    <GridSpiral />
                  )}
                  <div className="chat-shimmer">Working…</div>
                </div>
              )}
            </div>
          </div>
          {composer(true)}
        </>
      )}
      {mergeOpen && (
        <SandboxMergeModal
          ownerId={id}
          projectName={name || cwd}
          onMerged={(count) =>
            push({
              k: "note",
              id: nextId(),
              text: `Merged ${count} file${count === 1 ? "" : "s"} into your project`,
            })
          }
          onClose={() => setMergeOpen(false)}
        />
      )}
      {safeInfoOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSafeInfoOpen(false)}>
          <div className="confirm-modal sandbox-modal safe-setup" onMouseDown={(e) => e.stopPropagation()}>
            <div className="safe-setup-head">
              <span className="safe-setup-title">Setting up safe mode</span>
            </div>
            <p>
              Ash will work in a sandbox copy of your project under
              ~/.ash/sandboxes. File access outside that copy is blocked, and
              risky commands require a separate safety review before they run.
              When the agent finishes, review and merge only the changes you want
              to keep — or discard the copy.
            </p>
            <div className="confirm-actions">
              <button className="primary" onClick={() => setSafeInfoOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
