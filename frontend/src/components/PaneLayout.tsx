import { memo, lazy, Suspense } from "react";

import TerminalPane from "./TerminalPane";
import BrowserPane from "./BrowserPane";
import { PaneNode } from "../lib/layout";

// Lazily loaded so its heavy, on-demand-only dependencies don't parse at
// startup: FileViewer pulls in CodeMirror + 13 language packs. A fresh
// terminal / Welcome launch never touches it.
const FileViewer = lazy(() => import("./FileViewer"));

// All callbacks take tabId as their first argument so App can pass the SAME
// stable (useCallback) functions to every tab — that's what lets memo() below
// actually skip re-rendering the pane trees of untouched (and hidden) tabs on
// every App state change.
interface PaneLayoutProps {
  node: PaneNode;
  tabId: string;
  tabActive: boolean;
  activePane: string;
  multi: boolean;
  onFocus: (tabId: string, paneId: string) => void;
  onRatio: (tabId: string, splitId: string, ratio: number) => void;
  onUrlChange: (tabId: string, paneId: string, url: string) => void;
  onClosePane: (paneId: string) => void;
}

function PaneLayout(props: PaneLayoutProps) {
  const {
    node,
    tabId,
    tabActive,
    activePane,
    multi,
    onFocus,
    onRatio,
    onUrlChange,
    onClosePane,
  } = props;

  if (node.type === "leaf") {
    let content;
    if (node.kind === "web") {
      content = (
        <BrowserPane
          id={node.id}
          url={node.url}
          dimmed={multi && activePane !== node.id}
          onFocus={() => onFocus(tabId, node.id)}
          onUrlChange={(url) => onUrlChange(tabId, node.id, url)}
          onClose={() => onClosePane(node.id)}
        />
      );
    } else if (node.kind === "file") {
      content = (
        <FileViewer
          id={node.id}
          path={node.path}
          dimmed={multi && activePane !== node.id}
          onFocus={() => onFocus(tabId, node.id)}
          onClose={() => onClosePane(node.id)}
        />
      );
    } else {
      content = (
        <TerminalPane
          id={node.id}
          focused={tabActive && activePane === node.id}
          dimmed={multi && activePane !== node.id}
          onFocus={() => onFocus(tabId, node.id)}
        />
      );
    }
    // Suspense covers the lazily-loaded file pane; it's a no-op
    // for the eager terminal/web panes. Fallback fills the pane with the app bg
    // so there's no white flash during the (fast, local) chunk load.
    return (
      <Suspense fallback={<div style={{ flex: 1, background: "var(--bg)" }} />}>
        {content}
      </Suspense>
    );
  }

  const { dir, ratio } = node;

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement!;
    const rect = container.getBoundingClientRect();
    // rAF-throttled — raw mousemove would setTabs (full tree state) 100+/s
    let raf = 0;
    let lastPos = ratio;
    const apply = () => {
      raf = 0;
      onRatio(tabId, node.id, Math.min(0.85, Math.max(0.15, lastPos)));
    };
    const move = (ev: MouseEvent) => {
      lastPos =
        dir === "row"
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      if (raf) cancelAnimationFrame(raf);
      apply();
      document.body.style.cursor = "";
      document.body.classList.remove("dragging");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    document.body.style.cursor = dir === "row" ? "col-resize" : "row-resize";
    // iframes swallow mousemove — block their pointer events while dragging.
    document.body.classList.add("dragging");
  };

  return (
    <div className={`split ${dir}`}>
      <div className="split-child" style={{ flexGrow: ratio }}>
        <MemoPaneLayout {...props} node={node.a} />
      </div>
      <div className="divider" onMouseDown={startDrag} />
      <div className="split-child" style={{ flexGrow: 1 - ratio }}>
        <MemoPaneLayout {...props} node={node.b} />
      </div>
    </div>
  );
}

// Memoized at every level: an unchanged subtree (same node identity + same
// stable callbacks) bails out entirely, so hidden tabs and untouched split
// halves stop re-rendering on every App state change.
const MemoPaneLayout = memo(PaneLayout);
export default MemoPaneLayout;
