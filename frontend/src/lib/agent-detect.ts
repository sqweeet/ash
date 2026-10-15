// Detect which CLI coding agent (Claude Code, Antigravity, OpenCode, …) is
// running inside each terminal. The Go side walks the ConPTY's process tree
// to its deepest descendant (PtyForegroundProcess) — the foreground program —
// and we match its image name against the native binaries each agent ships as:
//   claude.exe (Anthropic), agy.exe (Google Antigravity), opencode.exe (sst),
//   muse-bin-<version>.exe (Meta's Muse Code).
// node.exe children are MCP servers / npx shims, never the agent leaf, so the
// tree walk correctly skips them. A bare shell prompt matches nothing.
//
// Polling every ~2s is robust against process spawns that don't change the
// title (agy has no stable title pattern; title can be disabled on all three).
// The title-change hook is an ADDITIONAL early trigger, not the sole signal.
import { invoke } from "../backend/core";
import { sessionIds, getSession } from "./term";
import { setAgentStatus } from "./agent-status";

export interface AgentMatch {
  /** Stable id from AGENT_PROCESSES (claude / antigravity / opencode). */
  id: string;
  /** The agent process's working folder; "" when it couldn't be read. */
  cwd: string;
  /** The linked git worktree cwd is in; null in a main checkout / no repo. */
  worktree: AgentWorktree | null;
}

export interface AgentWorktree {
  /** Admin name (.git/worktrees/<name>). */
  name: string;
  /** Checked-out branch; "" when detached. */
  branch: string;
  /** The main checkout the worktree was created from. */
  repo: string;
}

const sameWorktree = (a: AgentWorktree | null, b: AgentWorktree | null) =>
  a === b || (!!a && !!b && a.name === b.name && a.branch === b.branch && a.repo === b.repo);

interface AgentProcess {
  bin: string;
  /** Other image names the same agent ships as. */
  alt?: RegExp;
  id: string;
  /** Human label shown as the tab title base when the agent is detected. */
  label: string;
}

const AGENT_PROCESSES: AgentProcess[] = [
  { bin: "claude.exe", id: "claude", label: "Claude Code" },
  { bin: "agy.exe", id: "antigravity", label: "Antigravity" },
  { bin: "opencode.exe", id: "opencode", label: "OpenCode" },
  { bin: "pi.exe", id: "pi", label: "Pi" },
  { bin: "omp.exe", id: "omp", label: "omp" },
  // Windows installs a muse.cmd launcher that runs the versioned native
  // binary (muse-bin-1.4.8-R6256.1.exe) through PowerShell.
  { bin: "muse.exe", alt: /^muse-bin-[\w.-]+\.exe$/, id: "muse", label: "Muse Code" },
  // npm's node shim launches the native binary: vendor/<triple>/codex/codex.exe,
  // or codex-x86_64-pc-windows-msvc.exe in older releases.
  { bin: "codex.exe", alt: /^codex-[\w-]+\.exe$/, id: "codex", label: "Codex" },
];

const AGENT_BY_ID = new Map(AGENT_PROCESSES.map((p) => [p.id, p]));

const matches = new Map<string, AgentMatch>();
// Run state each terminal last reported out of band (OSC 7501 / 9;4) — kept
// before its agent is detected too, so a run that starts right at launch
// (its report beating the process poll) still shows.
const reported = new Map<string, AgentRunStatus>();
// Terminals whose agent has announced its run state itself — a title marker
// or status report since it was detected. From then on its output activity is
// ignored; until then it decides (reportAgentActivity), so an agent with its
// title turned off still shows its runs.
const announced = new Set<string>();
// Codex and Muse mark a run only by a leading spinner frame, so a frameless
// title is no marker: it means idle once they've shown frames, and nothing
// before — the frames may be turned off, and a retitle mid-run must not end it.
const FRAME_ONLY = new Set(["codex", "muse"]);
const listeners = new Set<() => void>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let scanning = false;

function notify() {
  listeners.forEach((fn) => fn());
}

function matchName(name: string): AgentProcess | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  return AGENT_PROCESSES.find((p) => p.bin === lower || p.alt?.test(lower)) ?? null;
}

/** Ask the backend for the foreground process of one terminal and update the
 *  store if the match changed. Safe to call repeatedly. */
async function detectOne(id: string): Promise<void> {
  let name = "";
  let cwd = "";
  let worktree: AgentWorktree | null = null;
  try {
    const res = await invoke<{
      name: string;
      pid: number;
      cwd?: string;
      worktree?: AgentWorktree | null;
    }>("pty_foreground_process", { id });
    name = res?.name ?? "";
    cwd = res?.cwd ?? "";
    worktree = res?.worktree ?? null;
  } catch {
    // PTY gone or binding unavailable — clear any stale match.
    clearAgent(id);
    return;
  }
  const hit = matchName(name);
  const prev = matches.get(id);
  if (!hit && !prev) return; // still no agent
  if (!hit) {
    clearAgent(id);
    return;
  }
  // Same agent but a one-off failed cwd read: keep the folder it had.
  if (!cwd && prev?.id === hit.id) {
    cwd = prev.cwd;
    worktree = prev.worktree;
  }
  if (prev?.id === hit.id && prev.cwd === cwd && sameWorktree(prev.worktree, worktree)) return; // unchanged
  if (prev?.id !== hit.id) announced.delete(id);
  matches.set(id, { id: hit.id, cwd, worktree });
  syncAgentStatus(id, getSession(id)?.lastTitle ?? "");
  const st = reported.get(id);
  if (st) announce(id, st);
  notify();
}

/** Poll every live terminal. Called on an interval and on demand (e.g. right
 *  after a title change, which often coincides with an agent launching). */
async function pollAll(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const ids = sessionIds();
    await Promise.all(ids.map(detectOne));
    // Drop matches for sessions that no longer exist (closed / disposed).
    for (const id of [...matches.keys()]) {
      if (!sessionIds().includes(id) && matches.delete(id)) notify();
    }
  } finally {
    scanning = false;
  }
}

/** Start the periodic detection poll. Called once when sessions are configured. */
export function startAgentDetection(): void {
  if (pollTimer) return;
  pollTimer = setInterval(pollAll, 2000);
  // First sweep shortly after startup so an agent launched at shell-open is
  // badged without waiting the full interval.
  setTimeout(pollAll, 1500);
}

export function stopAgentDetection(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Early trigger: re-check a terminal right after its title changes (a CLI
 *  agent setting its OSC title is a strong hint it just became foreground). */
export function triggerDetect(id: string): void {
  detectOne(id).catch(() => {});
}

/** Clear a terminal's match immediately (used on PTY exit / dispose). */
export function clearAgent(id: string): void {
  reported.delete(id);
  announced.delete(id);
  setAgentStatus(id, null);
  if (matches.delete(id)) notify();
}

/** Mirror a detected CLI agent's working/done state (parsed from its OSC
 *  title) into the shared status store the sidebar spinner reads. A title with
 *  no status marker leaves the last known state alone. */
export function syncAgentStatus(id: string, rawTitle: string): void {
  const ag = matches.get(id);
  if (!ag) return;
  const st = parseAgentStatus(ag.id, rawTitle);
  if (!st || (st === "done" && FRAME_ONLY.has(ag.id) && !announced.has(id))) return;
  announce(id, st);
}

function announce(id: string, status: AgentRunStatus): void {
  announced.add(id);
  setAgentStatus(id, status);
}

/** Mirror a run state the terminal reported out of band (OSC 7501 program
 *  status / OSC 9;4 progress, sniffed in term.ts) — the explicit signal, so it
 *  goes straight to the store whenever an agent is detected there. */
export function reportAgentStatus(id: string, status: AgentRunStatus): void {
  reported.set(id, status);
  if (matches.has(id)) announce(id, status);
}

/** Mirror the output-activity guess (output-activity.ts) for a detected agent
 *  that hasn't announced its state itself — OpenCode and Antigravity never
 *  do, others only with their title turned off. */
export function reportAgentActivity(id: string, status: AgentRunStatus): void {
  if (matches.has(id) && !announced.has(id)) setAgentStatus(id, status);
}

export function getAgentForTerm(id: string): AgentMatch | null {
  return matches.get(id) ?? null;
}

export function onAgentDetectChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The agent's plain display name ("Claude Code", "Antigravity", "OpenCode"). */
export function agentDisplayName(id: string): string {
  return AGENT_BY_ID.get(id)?.label ?? "";
}

// Claude Code's OSC title is "<glyph> <topic>": a half-circle spinner (◐/◑,
// U+25D0–U+25D3; braille U+2800–U+28FF in older releases) while it works, or
// the asterisk marker (U+2733) when idle. Older releases sent a
// "repo · topic · session-id" triple. We strip the glyph and extract the
// topic as the clean, short title the user sees instead of the raw messy OSC
// payload. Topic capped so the tab stays short.
const CLAUDE_SPINNER = /^[\u25d0-\u25d3\u2800-\u28ff]/;
const CLAUDE_GLYPHS = /^[\u25d0-\u25d3\u2800-\u28ff\u2733-\u2735\u2727]+\s*/;

function extractClaudeTopic(raw: string): string {
  // Drop leading spinner/marker glyphs + whitespace.
  let s = raw.replace(CLAUDE_GLYPHS, "").trim();
  if (!s) return "";
  // "repo · topic · session-id" → the topic is the middle segment. A lone
  // segment is either a topic or the literal "Claude Code" (startup).
  if (s.includes(" · ")) {
    const parts = s.split(" · ").map((p) => p.trim()).filter(Boolean);
    // First segment is often the repo name; the second is the topic.
    s = parts.length >= 2 ? parts[1] : parts[0];
  }
  if (!s || /^claude\s*code$/i.test(s)) return "";
  if (s.length > 32) s = s.slice(0, 31) + "…";
  return s;
}

// omp's OSC title is "π <state> <session label>" (see parseAgentStatus); the
// label is the topic.
function extractOmpTopic(raw: string): string {
  let s = OMP_TITLE.exec(raw.trim())?.[2]?.trim() ?? "";
  if (s.length > 32) s = s.slice(0, 31) + "…";
  return s;
}

// OpenCode's OSC title is "OpenCode" (home/new) or "OC | {title}" (session).
function extractOpenCodeTopic(raw: string): string {
  const s = raw.trim();
  const m = /^OC\s*\|\s*(.+)$/.exec(s);
  if (m && m[1].trim()) {
    let t = m[1].trim();
    if (t.length > 32) t = t.slice(0, 31) + "…";
    return t;
  }
  return "";
}

/** Split an agent's title into a display name + a description for the
 *  expanded multi-agent list. name is always the brand ("Claude Code");
 *  desc is the parsed topic (Claude/OpenCode) or the folder (Pi). */
export function agentTitleParts(
  agentId: string,
  rawTitle: string,
  folderName?: string,
): { name: string; desc: string } {
  const name = agentDisplayName(agentId);
  let desc = "";
  if (agentId === "pi") desc = folderName ?? "";
  else if (agentId === "claude") desc = extractClaudeTopic(rawTitle);
  else if (agentId === "opencode") desc = extractOpenCodeTopic(rawTitle);
  else if (agentId === "omp") desc = extractOmpTopic(rawTitle);
  return { name, desc };
}

/** Build a clean, short tab title for a detected agent from its raw OSC title:
 *  just the topic ("fix sidebar rows") — the sidebar icon already names the
 *  agent, so no brand prefix. Falls back to the agent's plain display name
 *  when no topic can be parsed (agy has no stable title format; Claude at
 *  startup; title disabled). Pi's "topic" is the folder it's working in when
 *  `folderName` is supplied — Pi's own OSC title is just the cwd path, so the
 *  workspace folder is the useful identity. */
export function agentTabTitle(
  agentId: string,
  rawTitle: string,
  folderName?: string,
): string {
  const base = agentDisplayName(agentId);
  if (!base) return rawTitle;
  let topic = "";
  if (agentId === "pi") topic = folderName ?? "";
  else if (agentId === "claude") topic = extractClaudeTopic(rawTitle);
  else if (agentId === "opencode") topic = extractOpenCodeTopic(rawTitle);
  else if (agentId === "omp") topic = extractOmpTopic(rawTitle);
  // antigravity: no stable title pattern — just the brand name.
  return topic || base;
}

/** Combined title for a split holding multiple detected agents — joins each
 *  agent's own title with " · " ("fix sidebar rows · ash-wails"). Falls back to
 *  a single agent's title when there's just one. `folderFor` lets the caller
 *  supply a per-agent working folder (used by Pi) without threading it through
 *  every entry. */
export function agentCombinedTitle(
  entries: { id: string; rawTitle: string }[],
  folderFor?: (id: string) => string | undefined,
): string {
  if (entries.length === 0) return "";
  if (entries.length === 1)
    return agentTabTitle(entries[0].id, entries[0].rawTitle, folderFor?.(entries[0].id));
  // For 2+ agents show each agent's own short title joined — Pi gets its
  // folder, the rest their topic (or brand). Joined identities read at a glance.
  return entries
    .map((e) => agentTabTitle(e.id, e.rawTitle, folderFor?.(e.id)))
    .filter(Boolean)
    .join(" · ");
}

// ── Agent working/done status ───────────────────────────────────────────
// Most CLIs surface their state in the OSC title; Pi (and any agent printing
// OSC 7501 / OSC 9;4) reports it out of band — see reportAgentStatus. Agents
// that announce nothing fall back to output activity (reportAgentActivity).
// We parse the title into a status so the sidebar can tell a working agent's
// tab from an idle one.
//   Claude Code: ◐/◑ half-circle spinner (braille in older releases) =
//     working, asterisk marker (U+2733) = turn ended.
//   Codex: the default title items are activity, thread and project — a
//     braille frame leads while a turn runs, nothing while idle, and
//     "[ ! ] Action Required" while it waits on an approval.
//   omp: "π <sep> <label>" — the separator is a spinner frame (braille,
//     ○◔◑◕●, -\|/, or a static ":" where frames can't animate) while
//     working, ">" on the user's turn and "!" when it needs attention.
//   Pi: its own title is "π - <folder>"; status extensions lead it with a
//     `◰◳◲◱`/braille spinner = working, `✓` or `●` = idle. Pi's OSC 7501
//     program status is the main signal (Ash sets PI_PROGRAM_STATUS=1).
//   Muse Code: its folder name, led by a braille frame while a turn runs.
//   OpenCode: "OpenCode" / "OC | <session>" carries no state (older
//     releases led it with a braille spinner, `▣` when idle).
//   Antigravity: no state in the title.
export type AgentRunStatus = "working" | "done";

const BRAILLE_SPINNER = /[\u2800-\u28ff]/;
// Only a LEADING frame (after an optional context-% prefix) counts — a space
// in this class once matched every Pi title and kept the tab "working".
const PI_SPINNER = /^(\[\d+%\]!?\s*)?[\u25f0-\u25f3\u2800-\u28ff]/;
// "π <separator> <label>" — the separator is one non-space character.
const OMP_TITLE = /^\u03c0 (\S)(?: (.*))?$/;

/** Parse an agent's run status from its raw OSC title. Returns null when no
 *  status can be inferred (unknown agent, title disabled, or idle without a
 *  distinct done-marker). Callers should treat null as "unchanged". */
export function parseAgentStatus(agentId: string, rawTitle: string): AgentRunStatus | null {
  const t = rawTitle ?? "";
  if (!t) return null;
  if (agentId === "claude") {
    // Working while a spinner frame leads; done when the asterisk marker leads.
    if (CLAUDE_SPINNER.test(t)) return "working";
    if (/^[\u2733-\u2735\u2727]/.test(t)) return "done";
    return null;
  }
  if (agentId === "opencode") {
    // Built-in status prefix: spinner (braille) = busy, ▣ = idle.
    if (BRAILLE_SPINNER.test(t.slice(0, 3))) return "working";
    if (/^[▣]/.test(t)) return "done";
    return null;
  }
  if (agentId === "pi") {
    // Pi with a status extension (pi-idle / pi-dynamic-title): spinner =
    // working, ✓ or ● (with optional context-% prefix) = done.
    if (PI_SPINNER.test(t)) return "working";
    if (/^(\[\d+%\]!?\s*)?[✓●]/.test(t)) return "done";
    return null;
  }
  if (agentId === "codex" || agentId === "muse") {
    // No frame is the idle state itself, so every title says something.
    return BRAILLE_SPINNER.test(t[0]) ? "working" : "done";
  }
  if (agentId === "omp") {
    const sep = OMP_TITLE.exec(t)?.[1];
    if (!sep) return null; // titles off ("π: label") or not omp's yet
    return sep === ">" || sep === "!" ? "done" : "working";
  }
  return null;
}
