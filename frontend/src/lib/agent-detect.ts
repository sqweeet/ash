// Detect which CLI coding agent (Claude Code, Antigravity, OpenCode) is
// running inside each terminal. The Go side walks the ConPTY's process tree
// to its deepest descendant (PtyForegroundProcess) — the foreground program —
// and we match its image name against the native binaries each agent ships as:
//   claude.exe (Anthropic), agy.exe (Google Antigravity), opencode.exe (sst).
// node.exe children are MCP servers / npx shims, never the agent leaf, so the
// tree walk correctly skips them. A bare shell prompt matches nothing.
//
// Polling every ~2s is robust against process spawns that don't change the
// title (agy has no stable title pattern; title can be disabled on all three).
// The title-change hook is an ADDITIONAL early trigger, not the sole signal.
import { invoke } from "../backend/core";
import { sessionIds } from "./term";

export interface AgentMatch {
  /** Stable id from AGENT_PROCESSES (claude / antigravity / opencode). */
  id: string;
}

interface AgentProcess {
  bin: string;
  id: string;
  /** Human label shown as the tab title base when the agent is detected. */
  label: string;
}

const AGENT_PROCESSES: AgentProcess[] = [
  { bin: "claude.exe", id: "claude", label: "Claude Code" },
  { bin: "agy.exe", id: "antigravity", label: "Antigravity" },
  { bin: "opencode.exe", id: "opencode", label: "OpenCode" },
  { bin: "pi.exe", id: "pi", label: "Pi" },
];

const AGENT_BY_ID = new Map(AGENT_PROCESSES.map((p) => [p.id, p]));

const matches = new Map<string, AgentMatch>();
const listeners = new Set<() => void>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let scanning = false;

function notify() {
  listeners.forEach((fn) => fn());
}

function matchName(name: string): AgentMatch | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  const hit = AGENT_PROCESSES.find((p) => p.bin === lower);
  return hit ? { id: hit.id } : null;
}

/** Ask the backend for the foreground process of one terminal and update the
 *  store if the match changed. Safe to call repeatedly. */
async function detectOne(id: string): Promise<void> {
  let name = "";
  try {
    const res = await invoke<{ name: string; pid: number }>(
      "pty_foreground_process",
      { id },
    );
    name = res?.name ?? "";
  } catch {
    // PTY gone or binding unavailable — clear any stale match.
    if (matches.has(id)) {
      matches.delete(id);
      notify();
    }
    return;
  }
  const matched = matchName(name);
  const prev = matches.get(id);
  if (matched && prev?.id === matched.id) return; // unchanged
  if (!matched && !prev) return; // still no agent
  if (matched) matches.set(id, matched);
  else matches.delete(id);
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
  if (matches.delete(id)) notify();
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

// Claude Code's OSC title is a braille spinner (U+2800–U+28FF) or asterisk
// marker (U+2733) + an auto-generated conversation topic, sometimes in a
// "repo · topic · session-id" triple. We strip the spinner and extract the
// topic to show "Claude Code · {topic}" — the clean, short title the user sees
// instead of the raw messy OSC payload. Topic capped so the tab stays short.
function extractClaudeTopic(raw: string): string {
  // Drop leading spinner/marker glyphs + whitespace.
  let s = raw.replace(/^[\u2800-\u28ff\u2733-\u2735\u2727]+\s*/, "").trim();
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
  return { name, desc };
}

/** Build a clean, short tab title for a detected agent from its raw OSC title.
 *  Falls back to the agent's plain display name when no topic can be parsed
 *  (agy has no stable title format; Claude at startup; title disabled). Pi
 *  shows the folder it's working in ("Pi - ash-wails") when `folderName` is
 *  supplied — Pi's own OSC title is just the cwd path, so the workspace
 *  folder is the useful identity. */
export function agentTabTitle(
  agentId: string,
  rawTitle: string,
  folderName?: string,
): string {
  const base = agentDisplayName(agentId);
  if (!base) return rawTitle;
  if (agentId === "pi") {
    // Pi's OSC title is the cwd path — the folder name (passed in by the
    // caller from the tab's workspace) is the clean identity.
    return folderName ? `${base} - ${folderName}` : base;
  }
  let topic = "";
  if (agentId === "claude") topic = extractClaudeTopic(rawTitle);
  else if (agentId === "opencode") topic = extractOpenCodeTopic(rawTitle);
  // antigravity: no stable title pattern — just the brand name.
  return topic ? `${base} · ${topic}` : base;
}

/** Combined title for a split holding multiple detected agents — joins each
 *  agent's own title with " · " ("Claude Code · Pi - ash-wails"). Falls back to
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
  // folder, the rest get their brand/topic. Joined identities read at a glance.
  return entries
    .map((e) => agentTabTitle(e.id, e.rawTitle, folderFor?.(e.id)))
    .filter(Boolean)
    .join(" · ");
}

// ── Agent working/done status ───────────────────────────────────────────
// Each CLI surfaces its state in the OSC title (and Pi also via OSC 9;4
// progress sequences, sniffed in term.ts). We parse the title into a status so
// the sidebar can show a working spinner vs a done check on the agent's tab.
//   Claude Code: braille spinner (U+2800–U+28FF) = working, asterisk
//     marker (U+2733) = turn ended.
//   OpenCode: spinner prefix (braille) = busy, `▣` = idle (built-in, PR #29597).
//   Pi (with a status extension): `◰◳◲◱`/braille spinner = working,
//     `✓` or `●` = idle. Pi's built-in OSC 9;4 path is handled separately.
//   Antigravity: title is user-customizable — no reliable status pattern.
export type AgentRunStatus = "working" | "done";

const BRAILLE_SPINNER = /[\u2800-\u28ff]/;
const PI_SPINNER = /[\u25f0-\u25f3 ◰◳◲◱]/;

/** Parse an agent's run status from its raw OSC title. Returns null when no
 *  status can be inferred (unknown agent, title disabled, or idle without a
 *  distinct done-marker). Callers should treat null as "unchanged". */
export function parseAgentStatus(agentId: string, rawTitle: string): AgentRunStatus | null {
  const t = rawTitle ?? "";
  if (!t) return null;
  if (agentId === "claude") {
    // Working while a braille spinner leads; done when the asterisk marker leads.
    if (/^[\u2800-\u28ff]/.test(t)) return "working";
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
    if (PI_SPINNER.test(t) || BRAILLE_SPINNER.test(t.slice(0, 3))) return "working";
    if (/^(\[\d+%\]!?\s*)?[✓●]/.test(t)) return "done";
    return null;
  }
  return null;
}
