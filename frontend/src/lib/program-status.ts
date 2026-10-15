import type { AgentStatus } from "./agent-status";

// Run state CLI agents print out of band, next to their output — term.ts
// sniffs both sequences and agent-detect mirrors them for detected agents.

/** OSC 7501 program status ("state=working:app=pi:msg=…"), which Pi reports:
 *  working while a run is active; blocked (a dialog waits on the user), done,
 *  error, idle and clear all mean it isn't. "?" is a support query, not a
 *  report. */
export function parseProgramStatus(body: string): AgentStatus | null {
  const state = /(?:^|:)state=([a-z]+)/.exec(body)?.[1];
  if (!state) return null;
  return state === "working" ? "working" : "done";
}

/** OSC 9;4 progress ("4;<state>[;<percent>]", ConEmu's, shown by Windows
 *  Terminal): 1 (normal) and 3 (indeterminate) mean a run is going, 0 clears
 *  it, 2 (error) and 4 (paused) stop it. Pi's opt-in terminal progress and
 *  several agents' extensions send it. OSC 9 also carries notifications and
 *  cwd reports — only the 4; subcommand counts. */
export function parseProgress(body: string): AgentStatus | null {
  const state = /^4;(\d)/.exec(body)?.[1];
  if (!state) return null;
  return state === "1" || state === "3" ? "working" : "done";
}
