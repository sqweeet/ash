import { Tool } from "../types";
import { runProcess } from "./run-process";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 12_000;

// One-shot PowerShell for work that finishes by itself. Background terminals
// are persistent PTYs and may prefer pwsh, so the system prompt tells the model
// to use syntax compatible with Windows PowerShell in both execution paths.
function cap(s: string): string {
  return s.length > MAX_OUTPUT
    ? s.slice(0, MAX_OUTPUT) + `\n[truncated — ${s.length - MAX_OUTPUT} more chars]`
    : s;
}

export const bashTool: Tool = {
  name: "bash",
  description:
    "Run one PowerShell command in the workspace and return its combined stdout/stderr and exit code. Each call is a fresh process; combine cd/env setup with the command when needed.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to run" },
      timeout_ms: { type: "number", description: `Max time to wait (default ${DEFAULT_TIMEOUT_MS}ms)` },
    },
    required: ["command"],
  },
  async run(args, ctx) {
    const command: string = args.command;
    const timeoutMs = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const res = await runProcess(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      ctx.cwd,
      { timeoutMs, signal: ctx.signal },
    );
    if (res.cancelled)
      return { ok: false, output: `Command cancelled.\n${cap(res.stdout + res.stderr)}`.trim() };
    if (res.timedOut)
      return { ok: false, output: `Command timed out after ${timeoutMs}ms.\n${cap(res.stdout + res.stderr)}` };

    const combined = cap((res.stdout + res.stderr).trim());
    const header = `exit code: ${res.code ?? "?"}`;
    return { ok: res.code === 0, output: combined ? `${header}\n${combined}` : header };
  },
};
