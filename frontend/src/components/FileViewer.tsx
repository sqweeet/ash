import { useEffect, useState } from "react";
import { invoke } from "../backend/core";
import { openPath } from "../backend/opener";
import hljs from "highlight.js/lib/common";
import powershell from "highlight.js/lib/languages/powershell";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import "highlight.js/styles/github-dark.css";

import vscodeIcon from "../assets/editors/vscode.svg";
import zedIcon from "../assets/editors/zed.svg";
import cursorIcon from "../assets/editors/cursor.svg";
import explorerIcon from "../assets/editors/explorer-win.svg";
import { toast } from "../lib/toast";
import Spinner from "./Spinner";

hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("dockerfile", dockerfile);

interface FileViewerProps {
  id: string;
  path: string;
  dimmed: boolean;
  onFocus: () => void;
  onClose: () => void;
}

// Map file extension → highlight.js language id.
const LANG: Record<string, string> = {
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  xml: "xml",
  html: "xml",
  css: "css",
  scss: "scss",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "dockerfile",
};

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg", "pdf", "zip",
  "gz", "tar", "rar", "7z", "exe", "dll", "so", "bin", "ttf", "otf", "woff",
  "woff2", "mp3", "mp4", "mov", "avi", "class", "jar", "wasm",
]);

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;
}
function ext(p: string): string {
  const n = baseName(p).toLowerCase();
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(i + 1) : "";
}

// highlightAuto tries every registered language heuristic — on a big file
// that freezes the main thread for seconds. Known-language files highlight at
// any size (cheap single-grammar pass); unknown ones only when small.
const AUTO_HIGHLIGHT_MAX = 50_000;

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

const OPEN_WITH_CHOICES: { id: string; label: string; icon: string | null }[] = [
  { id: "code", label: "VS Code", icon: vscodeIcon },
  { id: "zed", label: "Zed", icon: zedIcon },
  { id: "explorer", label: "Explorer", icon: explorerIcon },
  { id: "cursor", label: "Cursor", icon: cursorIcon },
  { id: "default", label: "Default", icon: null },
];

const LinkGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

export default function FileViewer({
  id,
  path,
  dimmed,
  onFocus,
  onClose,
}: FileViewerProps) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "binary" } | { kind: "error"; msg: string } |
    { kind: "code"; html: string; lines: number }
  >({ kind: "loading" });
  const [owMenu, setOwMenu] = useState(false);
  const [owDefault, setOwDefault] = useState(
    () => localStorage.getItem("ash.openWith") || "",
  );

  const choices = OPEN_WITH_CHOICES;
  const active = choices.find((c) => c.id === owDefault) ?? choices[0];

  const runOpen = (id: string) => {
    if (id === "default") {
      openPath(path).catch(() => {});
      return;
    }
    invoke("open_in", { app: id, path, isDir: false }).catch(() => {
      const c = choices.find((x) => x.id === id);
      toast(`${c?.label ?? id} is not installed`);
    });
  };
  const pick = (id: string) => {
    setOwDefault(id);
    localStorage.setItem("ash.openWith", id);
    setOwMenu(false);
    runOpen(id);
  };

  useEffect(() => {
    let alive = true;
    const e = ext(path);
    if (BINARY_EXT.has(e)) {
      setState({ kind: "binary" });
      return;
    }
    invoke<string | null>("read_text", { path })
      .then((raw) => {
        if (!alive) return;
        if (raw == null) {
          setState({ kind: "error", msg: "File not found" });
          return;
        }
        if (raw.length > 2_000_000) {
          setState({ kind: "error", msg: "File too large to preview" });
          return;
        }
        const lang = LANG[e];
        let html: string;
        try {
          if (lang && hljs.getLanguage(lang)) {
            html = hljs.highlight(raw, { language: lang }).value;
          } else if (raw.length <= AUTO_HIGHLIGHT_MAX) {
            html = hljs.highlightAuto(raw).value;
          } else {
            html = escapeHtml(raw); // big unknown file: plain text beats a freeze
          }
        } catch {
          html = escapeHtml(raw);
        }
        const lines = raw.split("\n").length;
        setState({ kind: "code", html, lines });
      })
      .catch((err) => alive && setState({ kind: "error", msg: String(err) }));
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <div
      className={`pane file-pane${dimmed ? " dim" : ""}`}
      data-pane-id={id}
      onMouseDownCapture={onFocus}
    >
      <div className="file-bar">
        <span className="file-name">{baseName(path)}</span>
        <span className="file-actions">
          <span className="open-with">
            <button
              className="web-btn ow-main"
              title={`Open with ${active.label}`}
              onClick={() => runOpen(active.id)}
            >
              {active.icon ? (
                <img className="brand-ico" src={active.icon} alt="" />
              ) : (
                <LinkGlyph />
              )}
            </button>
            <button
              className="ow-caret"
              title="Choose app"
              onClick={() => setOwMenu((o) => !o)}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {owMenu && (
              <>
                <div className="menu-backdrop" onMouseDown={() => setOwMenu(false)} />
                <div className="ctx-menu ow-menu">
                  {choices.map((c) => (
                    <button key={c.id} onClick={() => pick(c.id)}>
                      {c.icon ? (
                        <img className="brand-ico" src={c.icon} alt="" />
                      ) : (
                        <LinkGlyph />
                      )}
                      Open with {c.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </span>
          <button className="web-btn" title="Close" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </span>
      </div>
      <div className="file-body">
        {state.kind === "loading" && <Spinner />}
        {state.kind === "binary" && (
          <div className="file-msg">
            Binary file —{" "}
            <button className="link" onClick={() => openPath(path)}>
              open externally
            </button>
          </div>
        )}
        {state.kind === "error" && <div className="file-msg">{state.msg}</div>}
        {state.kind === "code" && (
          <div className="code-wrap">
            <div className="code-gutter" aria-hidden>
              {Array.from({ length: state.lines }, (_, i) => (
                <span key={i}>{i + 1}</span>
              ))}
            </div>
            <pre className="code-view">
              <code dangerouslySetInnerHTML={{ __html: state.html }} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
