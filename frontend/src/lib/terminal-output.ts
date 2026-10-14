import type { Terminal } from "@xterm/xterm";

// ConPTY can send the end of a synchronized update just before its final
// cursor position/visibility. Collect that tail before handing it to xterm.
// The deadline keeps continuous output responsive; timers also run when the
// window is minimized, where requestAnimationFrame stops firing.
const QUIET_MS = 4;
const MAX_WAIT_MS = 16;
const MAX_BATCH_LENGTH = 64 * 1024;

export function createTerminalOutput(term: Pick<Terminal, "write">) {
  let chunks: string[] = [];
  let length = 0;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let writing = false;
  let flushRequested = false;
  let disposed = false;
  let drained: (() => void)[] = [];

  const clearTimers = () => {
    clearTimeout(quietTimer);
    clearTimeout(deadlineTimer);
    quietTimer = deadlineTimer = undefined;
  };

  const flush = (onParsed?: () => void) => {
    if (disposed) return;
    if (onParsed) drained.push(onParsed);
    clearTimers();
    if (writing) {
      flushRequested = true;
      return;
    }
    flushRequested = false;
    if (!length) {
      const callbacks = drained;
      drained = [];
      callbacks.forEach((callback) => callback());
      return;
    }

    const data = chunks.join("");
    chunks = [];
    length = 0;
    writing = true;
    term.write(data, () => {
      writing = false;
      if (disposed) return;
      // Only one write is in flight, so a slow parser cannot reorder output
      // or let the exit event dispose the terminal before its last write.
      if (flushRequested || drained.length || !length) flush();
    });
  };

  return {
    write(data: string) {
      if (disposed || !data) return;
      chunks.push(data);
      length += data.length;
      if (length >= MAX_BATCH_LENGTH) {
        flush();
        return;
      }
      clearTimeout(quietTimer);
      quietTimer = setTimeout(flush, QUIET_MS);
      deadlineTimer ??= setTimeout(flush, MAX_WAIT_MS);
    },
    flush,
    dispose() {
      disposed = true;
      clearTimers();
      chunks = [];
      length = 0;
      drained = [];
    },
  };
}
