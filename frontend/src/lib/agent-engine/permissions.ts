export type PermissionMode = "full-auto" | "confirm";

const RISKY_TOOLS = new Set([
  "bash",
  "bash_background",
  "kill_background",
  "terminal_input",
  "edit_file",
  "write_file",
  // spawns an autonomous full-auto child — the user approves the delegation
  "agent",
  "spawn_agents",
  "run_workflow",
  "stop_agent",
]);

export function isRisky(toolName: string): boolean {
  return RISKY_TOOLS.has(toolName);
}

export interface PermissionRequest {
  id: string;
  toolName: string;
  input: unknown;
  summary: string;
}

function summarize(toolName: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "bash":
    case "bash_background":
      return String(args.command ?? "");
    case "kill_background":
      return `Stop session: ${String(args.session ?? "")}`;
    case "terminal_input": {
      const keys = Array.isArray(args.keys) && args.keys.length ? ` [${(args.keys as string[]).join(" ")}]` : "";
      return `Type in ${String(args.session ?? "")}: ${String(args.text ?? "")}${keys}`;
    }
    case "edit_file":
    case "write_file":
      return String(args.path ?? "");
    case "agent":
      return `Start background agent: ${String(args.task ?? "").slice(0, 80)}`;
    default:
      return toolName;
  }
}

/** Gates risky tool calls behind an approval Promise the UI resolves.
 * full-auto (or a non-risky tool) resolves immediately with no round-trip. */
export class PermissionGate {
  private waiters = new Map<string, (approved: boolean) => void>();

  constructor(
    private mode: PermissionMode,
    private onRequest: (req: PermissionRequest) => void,
  ) {}

  setMode(mode: PermissionMode) {
    this.mode = mode;
  }

  check(
    toolName: string,
    input: unknown,
    options?: { forcePrompt?: boolean; summary?: string },
  ): Promise<boolean> {
    if (!options?.forcePrompt && (this.mode === "full-auto" || !isRisky(toolName)))
      return Promise.resolve(true);
    const id = crypto.randomUUID();
    return new Promise<boolean>((resolve) => {
      this.waiters.set(id, resolve);
      this.onRequest({
        id,
        toolName,
        input,
        summary: options?.summary ?? summarize(toolName, input),
      });
    });
  }

  resolve(id: string, approved: boolean) {
    this.waiters.get(id)?.(approved);
    this.waiters.delete(id);
  }

  /** Deny any still-pending requests (e.g. on cancel/dispose) so callers awaiting them don't hang. */
  denyAllPending() {
    for (const resolve of this.waiters.values()) resolve(false);
    this.waiters.clear();
  }
}
