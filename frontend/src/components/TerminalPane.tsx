import { useEffect, useRef } from "react";

import { ensureSession, getSession } from "../lib/term";

interface TerminalPaneProps {
  id: string;
  focused: boolean;
  dimmed: boolean;
  onFocus: () => void;
}

export default function TerminalPane({
  id,
  focused,
  dimmed,
  onFocus,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const session = ensureSession(id, host);
    session.fit?.fit();

    // Debounce fit() during continuous resizes (sidebar open/close, divider
    // drag): xterm's fit recomputes the cell grid + repaints the WebGL/canvas
    // renderer, so calling it every ResizeObserver frame tanks the framerate
    // to single digits. RAF-coalesce, and during an active sidebar/divider
    // animation defer to a trailing fit so only the final size is rendered.
    let raf = 0;
    let trailing = 0;
    const runFit = () => {
      raf = 0;
      session.fit?.fit();
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      // while a sidebar/divider resize is in flight, skip the per-frame fit and
      // schedule ONE trailing fit ~120ms after the last change — the terminal
      // visually snaps to size at the end instead of churning every frame
      if (document.body.classList.contains("dragging") || document.body.classList.contains("resizing")) {
        clearTimeout(trailing);
        trailing = window.setTimeout(runFit, 120);
        return;
      }
      raf = requestAnimationFrame(runFit);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(trailing);
      // Detach only — the session (terminal + PTY) outlives the mount.
      if (session.container?.parentElement === host) session.container.remove();
    };
  }, [id]);

  useEffect(() => {
    const term = getSession(id)?.term;
    if (focused) term?.focus();
    else term?.blur();
  }, [focused, id]);

  return (
    <div
      className={`pane term-pane${dimmed ? " dim" : ""}`}
      data-pane-id={id}
      onMouseDownCapture={onFocus}
    >
      <div className="term-host" ref={hostRef} />
    </div>
  );
}
