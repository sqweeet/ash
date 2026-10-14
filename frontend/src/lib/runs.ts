import { invoke } from "../backend/core";

/** A quick-launch entry stored per-project in .ash/run.json. */
export interface RunConfig {
  id: string;
  name: string;
  type: "command" | "url";
  /** For type "command": shell command to run. */
  command?: string;
  /** For type "url": address to open in the in-app browser. */
  url?: string;
  /** Working dir, relative to the project root (command runs). */
  cwd?: string;
}

interface RunFile {
  runs: RunConfig[];
}

function joinPath(root: string, rel: string): string {
  return root.replace(/[\\/]+$/, "") + "\\" + rel;
}

export function runFilePath(projectRoot: string): string {
  return joinPath(projectRoot, ".ash\\run.json");
}

export async function loadRuns(projectRoot: string): Promise<RunConfig[]> {
  try {
    const raw = await invoke<string | null>("read_text", {
      path: runFilePath(projectRoot),
    });
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RunFile;
    return Array.isArray(parsed.runs) ? parsed.runs : [];
  } catch {
    return [];
  }
}

export async function saveRuns(
  projectRoot: string,
  runs: RunConfig[],
): Promise<void> {
  const body: RunFile = { runs };
  await invoke("write_text", {
    path: runFilePath(projectRoot),
    contents: JSON.stringify(body, null, 2) + "\n",
  });
}

/** Absolute cwd for a run, honoring its optional relative cwd. */
export function runCwd(projectRoot: string, run: RunConfig): string {
  if (!run.cwd) return projectRoot;
  return joinPath(projectRoot, run.cwd.replace(/[\\/]+/g, "\\"));
}
