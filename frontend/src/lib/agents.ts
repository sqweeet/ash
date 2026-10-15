/**
 * Curated registry of CLI coding agents. Agents run INSIDE the default shell
 * (typed as a command), so when a one-shot run exits the tab stays alive with
 * a prompt instead of closing.
 */

export interface AgentExtra {
  label: string;
  command: string;
}

export interface AgentModel {
  id: string;
  label: string;
}

export interface AgentDef {
  id: string;
  name: string;
  /** Vendor/brand shown as a subtitle in the agent picker. */
  vendor?: string;
  /** Binary looked up on PATH to detect the agent. */
  bin: string;
  /** Interactive launch command. */
  launch: string;
  /** Flag that auto-approves everything (YOLO). Absent = agent needs none. */
  yolo?: string;
  /** Known model presets; empty id = agent default. */
  models?: AgentModel[];
  extra?: AgentExtra[];
}

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    bin: "claude",
    launch: "claude",
    yolo: "--dangerously-skip-permissions",
    models: [
      { id: "", label: "Default" },
      { id: "fable", label: "Fable" },
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ],
    extra: [
      { label: "Continue last session", command: "claude -c" },
      {
        label: "Skip permissions",
        command: "claude --dangerously-skip-permissions",
      },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    bin: "codex",
    launch: "codex",
    yolo: "--dangerously-bypass-approvals-and-sandbox",
    models: [
      { id: "", label: "Default" },
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
      { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
      { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
    ],
    extra: [{ label: "Resume last session", command: "codex resume --last" }],
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "opencode",
    bin: "opencode",
    launch: "opencode",
    models: [{ id: "", label: "Default" }],
    extra: [{ label: "Continue last session", command: "opencode --continue" }],
  },
  {
    id: "pi",
    name: "Pi",
    bin: "pi",
    launch: "pi",
    models: [{ id: "", label: "Default" }],
    extra: [{ label: "Continue last session", command: "pi -c" }],
  },
  {
    id: "omp",
    name: "omp",
    vendor: "oh-my-pi",
    bin: "omp",
    launch: "omp",
    models: [{ id: "", label: "Default" }],
    extra: [{ label: "Continue last session", command: "omp -c" }],
  },
  {
    id: "muse",
    name: "Muse Code",
    vendor: "Meta",
    bin: "muse",
    launch: "muse",
    models: [{ id: "", label: "Default" }],
  },
  {
    id: "agy",
    name: "Antigravity",
    vendor: "Google",
    bin: "agy",
    launch: "agy",
    yolo: "--dangerously-skip-permissions",
    models: [{ id: "", label: "Default" }],
  },
];
