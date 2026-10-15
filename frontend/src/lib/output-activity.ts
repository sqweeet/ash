import type { AgentStatus } from "./agent-status";

// Run state for CLI agents that don't announce one (OpenCode, Antigravity):
// a TUI redraws its spinner or streams text the whole time it works, and goes
// quiet once it waits on the user — measured idle, they print nothing at all.
// Output right after a keystroke is that keystroke's echo, not work, and a
// burst must outlast a startup screen before it counts as a run.
export const ECHO_MS = 300;
export const GAP_MS = 600; // a longer pause ends the burst
export const SUSTAIN_MS = 1500;
export const QUIET_MS = 2000; // silent this long: the run is over

export interface ActivityMeter {
  input(): void;
  output(): void;
  dispose(): void;
}

export function createActivityMeter(
  onChange: (status: AgentStatus) => void,
  now: () => number = Date.now,
): ActivityMeter {
  let lastInput = -Infinity;
  let lastOutput = -Infinity;
  let burstStart = -Infinity;
  let working = false;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    quiet = undefined;
    working = false;
    onChange("done");
  };
  return {
    input() {
      lastInput = now();
    },
    output() {
      const t = now();
      if (t - lastInput < ECHO_MS) return;
      if (t - lastOutput > GAP_MS) burstStart = t;
      lastOutput = t;
      if (!working && t - burstStart >= SUSTAIN_MS) {
        working = true;
        onChange("working");
      }
      if (working) {
        clearTimeout(quiet);
        quiet = setTimeout(settle, QUIET_MS);
      }
    },
    dispose() {
      clearTimeout(quiet);
    },
  };
}
