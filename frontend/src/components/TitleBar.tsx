import { useEffect, useState } from "react";
import { getCurrentWindow } from "../backend/window";
import WindowControls from "./WindowControls";

const win = getCurrentWindow();

// macOS draws native traffic-light controls; only Windows/Linux get our custom
// set. The dev Mac-preview flag (Ctrl+Shift+M) also hides them on Windows.
const isMac =
  navigator.userAgent.includes("Macintosh") ||
  localStorage.getItem("ash.macPreview") === "1";

interface TitleBarProps {
  title: string;
  workspaceName: string | null;
  branch: string | null;
  sidebarOpen: boolean;
}

export default function TitleBar({
  title,
  workspaceName,
  branch,
  sidebarOpen,
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    win.isMaximized().then((m) => !disposed && setMaximized(m));
    // During an OS window-border drag the webview resizes every frame →
    // terminal ResizeObserver → per-frame fit(). Mark the body `resizing` for
    // the duration so TerminalPane defers to a single trailing fit. Debounced
    // on the webview resize event.
    let resizeTimer = 0;
    const onJsResize = () => {
      document.body.classList.add("resizing");
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(
        () => document.body.classList.remove("resizing"),
        120,
      );
    };
    window.addEventListener("resize", onJsResize);
    win
      .onResized(async () => setMaximized(await win.isMaximized()))
      .then((u) => (disposed ? u() : (unlisten = u)));
    return () => {
      disposed = true;
      window.removeEventListener("resize", onJsResize);
      window.clearTimeout(resizeTimer);
      unlisten?.();
    };
  }, []);

  return (
    <header
      className={`main-head${sidebarOpen ? "" : " with-toggle"}`}
      data-window-drag
    >
      <span className="head-title" data-window-drag>
        {title}
      </span>
      {workspaceName && (
        <span className="head-ws" data-window-drag>
          {workspaceName}
          {branch && (
            <>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              {branch}
            </>
          )}
        </span>
      )}
      <div className="head-spacer" data-window-drag />
      <div className="head-right">
        {!isMac && (
          <WindowControls
            maximized={maximized}
            onMinimize={() => win.minimize()}
            onToggleMaximize={() => win.toggleMaximize()}
            onClose={() => win.close()}
          />
        )}
      </div>
    </header>
  );
}
