import type { Terminal } from "@xterm/xterm";

const WHEEL_MOUSE_MODES = new Set(["vt200", "drag", "any"]);
const MOUSE_TRACKING_PARAMS = new Set([9, 1000, 1002, 1003]);

/** Never translate a wheel gesture into cursor/history/page keys.
 *
 * Normally xterm owns scrollback and encodes the mouse protocol requested by
 * the application. Legacy ConPTY can swallow mouse setup sent BEFORE raw mode
 * (notably Pi's fullscreen startup). Only a caller that knows the application
 * expects SGR mouse input may opt into that compatibility path. An explicit
 * mouse-mode change always takes precedence over the fallback.
 */
export function configureTerminalWheel(
  term: Terminal,
  useSgrFallback: () => boolean = () => false,
): () => void {
  let partial = 0;
  let mouseModeSeen = false;

  const bufferChange = term.buffer.onBufferChange(() => {
    partial = 0;
    mouseModeSeen = false;
  });
  const observeMouseMode = (params: (number | number[])[]) => {
    if (params.some((p) => typeof p === "number" && MOUSE_TRACKING_PARAMS.has(p))) {
      partial = 0;
      mouseModeSeen = true;
    }
    return false; // observe only; xterm must still apply the requested modes
  };
  const enable = term.parser.registerCsiHandler({ prefix: "?", final: "h" }, observeMouseMode);
  const disable = term.parser.registerCsiHandler({ prefix: "?", final: "l" }, observeMouseMode);

  term.attachCustomWheelEventHandler((event) => {
    if (WHEEL_MOUSE_MODES.has(term.modes.mouseTrackingMode)) {
      partial = 0;
      return true; // retain native encoding, coordinates and application scrolling
    }
    if (term.buffer.active.type !== "alternate") {
      partial = 0;
      // With scrollback disabled xterm would generate arrow keys even in the
      // normal buffer. Otherwise let its viewport scroll normally.
      if (term.options.scrollback !== 0) return true;
      event.preventDefault();
      return false;
    }

    // No scrollback exists in the alternate buffer. Suppress xterm's automatic
    // wheel-to-arrow conversion even when no mouse fallback is available.
    event.preventDefault();
    if (term.modes.mouseTrackingMode !== "none" || mouseModeSeen || !useSgrFallback()) {
      partial = 0;
      return false;
    }
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return false;

    // Use the grid, not the padded terminal host. DOM client coordinates and
    // its bounding rect share the same scale, including Ash's UI zoom.
    const rect = term.element?.querySelector(".xterm-screen")?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    const col = Math.max(1, Math.min(term.cols, Math.floor((event.clientX - rect.left) * term.cols / rect.width) + 1));
    const row = Math.max(1, Math.min(term.rows, Math.floor((event.clientY - rect.top) * term.rows / rect.height) + 1));
    const lines = event.deltaMode === 0 ? event.deltaY * term.rows / rect.height
      : event.deltaMode === 2 ? event.deltaY * term.rows : event.deltaY;
    if (Math.sign(lines) !== Math.sign(partial)) partial = 0;
    partial += lines;
    if (Math.abs(partial) < 1) return false;
    partial %= 1;

    // Match xterm's one report per qualifying wheel event; the TUI owns the
    // scroll distance/acceleration. Preserve modifiers for e.g. Pi's Alt+wheel.
    const button = (event.deltaY < 0 ? 64 : 65)
      + (event.shiftKey ? 4 : 0) + (event.altKey ? 8 : 0) + (event.ctrlKey ? 16 : 0);
    term.input(`\x1b[<${button};${col};${row}M`, true);
    return false;
  });

  return () => {
    bufferChange.dispose();
    enable.dispose();
    disable.dispose();
    term.attachCustomWheelEventHandler(() => true);
  };
}
