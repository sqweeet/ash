import { invoke } from "../../../backend/core";
import { Tool } from "../types";
import { runProcess } from "./run-process";
import { resolveToolPath } from "./paths";

const TIMEOUT_MS = 20_000;
const MAX_MATCHES = 200;

let rgAvailable: Promise<boolean> | null = null;
function hasRg(): Promise<boolean> {
  if (!rgAvailable)
    rgAvailable = invoke<string[]>("detect_bins", { names: ["rg"] }).then((f) => f.includes("rg"));
  return rgAvailable;
}

interface RgMatchLine {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
}

export const grepTool: Tool = {
  name: "grep",
  description: "Search file contents for a regex pattern (ripgrep), respecting .gitignore.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "Directory or file to search (default: cwd)" },
      glob: { type: "string", description: "Only search files matching this glob, e.g. '*.ts'" },
      case_insensitive: { type: "boolean", description: "Case-insensitive match" },
    },
    required: ["pattern"],
  },
  async run(args, ctx) {
    if (!(await hasRg()))
      return { ok: false, output: "ripgrep (rg) is not installed / not on PATH — grep is unavailable." };

    const searchPath = args.path ? resolveToolPath(ctx.cwd, args.path, ctx.safety) : ctx.cwd;
    const rgArgs = ["--json", "--max-count", "50"];
    if (args.case_insensitive) rgArgs.push("-i");
    if (args.glob) rgArgs.push("-g", args.glob);
    // `--` ends option parsing so a pattern starting with '-' (e.g. "-->" or a
    // flag-like regex) is treated as the search pattern, not an rg flag.
    rgArgs.push("--", args.pattern, searchPath);

    const res = await runProcess("rg", rgArgs, ctx.cwd, { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
    if (res.timedOut) return { ok: false, output: "grep timed out." };
    // rg exits 1 (not an error here) when there are simply no matches.
    if (res.code !== 0 && res.code !== 1)
      return { ok: false, output: `rg failed (exit ${res.code}):\n${res.stderr.trim()}` };

    const lines: string[] = [];
    let truncated = false;
    for (const raw of res.stdout.split("\n")) {
      if (!raw.trim()) continue;
      let obj: RgMatchLine;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }
      if (obj.type !== "match") continue;
      if (lines.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      const path = obj.data?.path?.text ?? "?";
      const lineNo = obj.data?.line_number ?? "?";
      const text = (obj.data?.lines?.text ?? "").replace(/\n$/, "");
      lines.push(`${path}:${lineNo}: ${text}`);
    }

    if (lines.length === 0) return { ok: true, output: "No matches." };
    if (truncated) lines.push(`[truncated at ${MAX_MATCHES} matches]`);
    return { ok: true, output: lines.join("\n") };
  },
};
