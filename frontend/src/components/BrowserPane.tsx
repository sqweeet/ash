import { useEffect, useRef, useState } from "react";
import { openUrl } from "../backend/opener";

interface BrowserPaneProps {
  id: string;
  url: string;
  dimmed: boolean;
  onFocus: () => void;
  onUrlChange: (url: string) => void;
  onClose: () => void;
}

function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?([/?#]|$)/i.test(s) || /^127\./.test(s))
    return `http://${s}`;
  if (/^:\d+$/.test(s)) return `http://localhost${s}`;
  return `https://${s}`;
}

export default function BrowserPane({
  id,
  url,
  dimmed,
  onFocus,
  onUrlChange,
  onClose,
}: BrowserPaneProps) {
  const [draft, setDraft] = useState(url);
  const [nonce, setNonce] = useState(0);
  // Our own URL-bar history — a cross-origin iframe won't expose its history,
  // so back/forward walk the addresses the user navigated to here.
  const [nav, setNav] = useState<{ stack: string[]; i: number }>(() => ({
    stack: [url],
    i: 0,
  }));
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  useEffect(() => setDraft(url), [url]);

  // Keep the history in sync when the URL is changed from outside; a no-op for
  // our own navigate/back/forward (they already land stack[i] on url).
  useEffect(() => {
    setNav((s) =>
      s.stack[s.i] === url
        ? s
        : { stack: [...s.stack.slice(0, s.i + 1), url], i: s.i + 1 },
    );
  }, [url]);

  // Clicks inside the iframe never reach us, but when focus moves into it
  // the host window fires `blur` with activeElement pointing at the frame.
  useEffect(() => {
    const check = () => {
      if (document.activeElement === frameRef.current) onFocusRef.current();
    };
    window.addEventListener("blur", check);
    return () => window.removeEventListener("blur", check);
  }, []);

  const navigate = (next: string) => {
    if (!next) return;
    if (next === url) {
      setNonce((n) => n + 1);
      return;
    }
    setNav((s) => ({ stack: [...s.stack.slice(0, s.i + 1), next], i: s.i + 1 }));
    onUrlChange(next);
  };

  const go = () => navigate(normalizeUrl(draft));

  const canBack = nav.i > 0;
  const canForward = nav.i < nav.stack.length - 1;
  const back = () => {
    if (!canBack) return;
    const target = nav.stack[nav.i - 1];
    setNav((s) => ({ ...s, i: Math.max(0, s.i - 1) }));
    onUrlChange(target);
  };
  const forward = () => {
    if (!canForward) return;
    const target = nav.stack[nav.i + 1];
    setNav((s) => ({ ...s, i: Math.min(s.stack.length - 1, s.i + 1) }));
    onUrlChange(target);
  };

  return (
    <div
      className={`pane web-pane${dimmed ? " dim" : ""}`}
      data-pane-id={id}
      onMouseDownCapture={onFocus}
    >
      <div className="web-toolbar">
        <div className="web-nav">
          <button className="web-btn" title="Back" disabled={!canBack} onClick={back}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <button className="web-btn" title="Forward" disabled={!canForward} onClick={forward}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
          <button className="web-btn" title="Reload" onClick={() => setNonce((n) => n + 1)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>

        <div className="web-url-wrap">
          <input
            className="web-url"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                go();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                setDraft(url);
                e.currentTarget.blur();
              }
            }}
          />
        </div>

        <div className="web-actions">
          <button
            className="web-btn"
            title="Open in system browser"
            onClick={() => openUrl(url).catch(() => {})}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
          </button>
          <button className="web-btn" title="Close pane" onClick={onClose}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="web-frame-wrap">
        <iframe
          key={`${url}#${nonce}`}
          ref={frameRef}
          className="web-frame"
          src={url}
          title="browser pane"
        />
      </div>
    </div>
  );
}
