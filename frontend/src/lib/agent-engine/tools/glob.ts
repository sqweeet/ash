import { invoke } from "../../../backend/core";
import { Tool } from "../types";
import { runProcess } from "./run-process";
import { resolveToolPath } from "./paths";

const TIMEOUT_MS = 20_000;
const MAX_FILES = 500;

let rgAvailable: Promise<boolean> | null = null;
function hasRg(): Promise<boolean> {
  if (!rgAvailable)
    rgAvailable = invoke<string[]>("detect_bins", { names: ["rg"] }).then((f) => f.includes("rg"));
  return rgAvailable;
}

export const globTool: Tool = {
  name: "glob",
  description: "List files matching a glob pattern (e.g. 'src/**/*.ts'), respecting .gitignore.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern, e.g. '**/*.ts'" },
      path: { type: "string", description: "Directory to search (default: cwd)" },
    },
    required: ["pattern"],
  },
  async run(args, ctx) {
    if (!(await hasRg()))
      return { ok: false, output: "ripgrep (rg) is not installed / not on PATH — glob is unavailable." };

    const searchPath = args.path ? resolveToolPath(ctx.cwd, args.path, ctx.safety) : ctx.cwd;
    const rgArgs = ["--files", "-g", args.pattern, searchPath];

    const res = await runProcess("rg", rgArgs, ctx.cwd, { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
    if (res.timedOut) return { ok: false, output: "glob timed out." };
    if (res.code !== 0 && res.code !== 1)
      return { ok: false, output: `rg failed (exit ${res.code}):\n${res.stderr.trim()}` };

    const files = res.stdout.split("\n").filter(Boolean);
    if (files.length === 0) return { ok: true, output: "No files matched." };
    const shown = files.slice(0, MAX_FILES);
    let output = shown.join("\n");
    if (files.length > MAX_FILES) output += `\n[truncated: ${files.length - MAX_FILES} more files]`;
    return { ok: true, output };
  },
};
