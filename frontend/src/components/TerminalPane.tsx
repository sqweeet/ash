import { useEffect, useRef, useState } from "react";

import { ensureSession, getSession } from "../lib/term";
import { isTerminalActive, onTerminalActivityChange } from "../lib/agent-activity";
import { isBackgroundTerm, onBackgroundTermsChange } from "../lib/background-terms";

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
  // Show the "agent controls this terminal" overlay while the agent is actively
  // typing/reading here, AND permanently for agent-spawned background terminals
  // (dev servers, watchers) — those are the agent's for their whole life, so the
  // overlay must stay put instead of blinking off between the agent's actions.
  const agentControls = () => isTerminalActive(id) || isBackgroundTerm(id);
  const [agentActive, setAgentActive] = useState(agentControls);
  useEffect(() => {
    const update = () => setAgentActive(agentControls());
    const offActivity = onTerminalActivityChange(update);
    const offBg = onBackgroundTermsChange(update);
    return () => {
      offActivity();
      offBg();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const host = hostRef.current!;
    // ensureSession always returns a rendered session (fit + container set),
    // attaching a renderer to a headless background session on first open.
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
      {agentActive && (
        <div className="agent-glow">
          <div className="agent-takeover">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <g transform="scale(1.33333)" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16.25 9.44788V4.75C16.25 3.65 15.355 2.75 14.25 2.75H3.75C2.645 2.75 1.75 3.65 1.75 4.75V13.25C1.75 14.35 2.645 15.25 3.75 15.25H9.0779" />
                <path d="m4.4 6.3 2.3 2.3-2.3 2.3" />
                <path d="M11.126 10.7701L17.066 12.94C17.316 13.0301 17.309 13.39 17.055 13.4699L14.336 14.3399L13.466 17.0601C13.385 17.3101 13.028 17.32 12.937 17.07L10.767 11.13C10.685 10.9 10.902 10.69 11.126 10.7701Z" />
              </g>
            </svg>
            <span>Agent is controlling this terminal</span>
          </div>
        </div>
      )}
    </div>
  );
}
