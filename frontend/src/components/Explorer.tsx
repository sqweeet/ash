import { useCallback, useEffect, useState } from "react";
import { invoke } from "../backend/core";
import { ask } from "../backend/dialog";

interface DirItem {
  name: string;
  path: string;
  is_dir: boolean;
}

interface ExplorerProps {
  root: string | null;
  rootName: string | null;
  width: number;
  side: "left" | "right";
  onOpenFile: (path: string) => void;
}

interface Creating {
  dir: string;
  kind: "file" | "dir";
}

interface Menu {
  x: number;
  y: number;
  item: DirItem | null;
  parentDir: string;
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transform: open ? "rotate(90deg)" : undefined,
      transition: "transform 0.1s ease",
    }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const FolderIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);

const FileIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </svg>
);

const FilePlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M12 12v6M9 15h6" />
  </svg>
);

const FolderPlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <path d="M12 10v6M9 13h6" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

function join(dir: string, name: string): string {
  return dir.replace(/[\\/]+$/, "") + "\\" + name;
}

interface DirNodeProps {
  path: string;
  depth: number;
  cache: Map<string, DirItem[]>;
  expanded: Set<string>;
  creating: Creating | null;
  gitMap: Map<string, string>;
  gitDirs: Set<string>;
  onToggle: (item: DirItem) => void;
  onOpenFile: (path: string) => void;
  onMenu: (e: React.MouseEvent, item: DirItem, parentDir: string) => void;
  onCreateSubmit: (name: string) => void;
  onCreateCancel: () => void;
}

function DirNode(props: DirNodeProps) {
  const {
    path,
    depth,
    cache,
    expanded,
    creating,
    gitMap,
    gitDirs,
    onToggle,
    onOpenFile,
    onMenu,
    onCreateSubmit,
    onCreateCancel,
  } = props;
  const entries = cache.get(path);
  if (!entries) return null;

  return (
    <>
      {creating?.dir === path && (
        <div className="ex-row" style={{ paddingLeft: 8 + depth * 12 }}>
          <span className="ex-chevron" />
          <span className={`ex-icon${creating.kind === "dir" ? " dir" : ""}`}>
            {creating.kind === "dir" ? <FolderIcon /> : <FileIcon />}
          </span>
          <input
            className="ex-input"
            autoFocus
            spellCheck={false}
            onBlur={onCreateCancel}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                const v = e.currentTarget.value.trim();
                if (v) onCreateSubmit(v);
                else onCreateCancel();
              }
              if (e.key === "Escape") onCreateCancel();
            }}
          />
        </div>
      )}
      {entries.map((item) => {
        const status = item.is_dir
          ? undefined
          : gitMap.get(item.path.toLowerCase());
        const dirTouched = item.is_dir && gitDirs.has(item.path.toLowerCase());
        return (
          <div key={item.path}>
            <div
              className={`ex-row${status ? ` git-${status}` : ""}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() =>
                item.is_dir ? onToggle(item) : onOpenFile(item.path)
              }
              onContextMenu={(e) => onMenu(e, item, path)}
              title={item.name}
            >
              <span className="ex-chevron">
                {item.is_dir && <ChevronIcon open={expanded.has(item.path)} />}
              </span>
              <span className={`ex-icon${item.is_dir ? " dir" : ""}`}>
                {item.is_dir ? <FolderIcon /> : <FileIcon />}
              </span>
              <span className="ex-name">{item.name}</span>
              {status && <span className="ex-badge">{status}</span>}
              {dirTouched && <span className="ex-dot" />}
            </div>
            {item.is_dir && expanded.has(item.path) && (
              <DirNode {...props} path={item.path} depth={depth + 1} />
            )}
          </div>
        );
      })}
    </>
  );
}

export default function Explorer({
  root,
  rootName,
  width,
  side,
  onOpenFile,
}: ExplorerProps) {
  const [cache, setCache] = useState<Map<string, DirItem[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<Creating | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [gitMap, setGitMap] = useState<Map<string, string>>(new Map());
  const [gitDirs, setGitDirs] = useState<Set<string>>(new Set());

  // Poll git status so touched files stay highlighted.
  useEffect(() => {
    if (!root) {
      setGitMap(new Map());
      setGitDirs(new Set());
      return;
    }
    let alive = true;
    let lastKey = "";
    const rootLower = root.toLowerCase();
    const load = () =>
      invoke<{ path: string; status: string }[]>("git_status", { path: root })
        .then((entries) => {
          if (!alive) return;
          // identical status → skip the state set (fresh Map/Set identities
          // re-rendered the whole directory tree every 5s for nothing)
          const key = entries.map((e) => `${e.status}${e.path}`).join("|");
          if (key === lastKey) return;
          lastKey = key;
          const map = new Map<string, string>();
          const dirs = new Set<string>();
          for (const e of entries) {
            const p = e.path.toLowerCase();
            map.set(p, e.status);
            let d = p;
            while (d.includes("\\")) {
              d = d.slice(0, d.lastIndexOf("\\"));
              if (d.length <= rootLower.length) break;
              dirs.add(d);
            }
          }
          setGitMap(map);
          setGitDirs(dirs);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [root]);

  const loadDir = useCallback((path: string) => {
    invoke<DirItem[]>("list_dir", { path })
      .then((items) =>
        setCache((prev) => {
          const next = new Map(prev);
          next.set(path, items);
          return next;
        }),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    setCache(new Map());
    setExpanded(new Set());
    setCreating(null);
    if (root) loadDir(root);
  }, [root, loadDir]);

  const refresh = useCallback(() => {
    if (!root) return;
    loadDir(root);
    expanded.forEach((p) => loadDir(p));
  }, [root, expanded, loadDir]);

  const toggleDir = useCallback(
    (item: DirItem) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(item.path)) {
          next.delete(item.path);
        } else {
          next.add(item.path);
        }
        return next;
      });
      if (!cache.has(item.path)) loadDir(item.path);
    },
    [cache, loadDir],
  );

  const startCreate = useCallback(
    (dir: string, kind: "file" | "dir") => {
      setMenu(null);
      if (root && dir !== root) {
        setExpanded((prev) => new Set(prev).add(dir));
        if (!cache.has(dir)) loadDir(dir);
      }
      setCreating({ dir, kind });
    },
    [root, cache, loadDir],
  );

  const submitCreate = useCallback(
    (name: string) => {
      if (!creating) return;
      const path = join(creating.dir, name);
      invoke(creating.kind === "file" ? "create_file" : "create_dir", { path })
        .then(() => loadDir(creating.dir))
        .catch(() => {});
      setCreating(null);
    },
    [creating, loadDir],
  );

  const deleteItem = useCallback(
    async (item: DirItem, parentDir: string) => {
      setMenu(null);
      const yes = await ask(`Delete "${item.name}"?`, {
        title: "Delete",
        kind: "warning",
      });
      if (!yes) return;
      invoke("delete_path", { path: item.path })
        .then(() => loadDir(parentDir))
        .catch(() => {});
    },
    [loadDir],
  );

  const openMenu = useCallback(
    (e: React.MouseEvent, item: DirItem | null, parentDir: string) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, item, parentDir });
    },
    [],
  );

  const menuTargetDir = menu
    ? menu.item?.is_dir
      ? menu.item.path
      : menu.parentDir
    : null;

  return (
    <aside className={`explorer from-${side}`} style={{ width }}>
      <div className="ex-header">
        <span className="ex-title">{rootName ?? "explorer"}</span>
        {root && (
          <span className="ex-actions">
            <button
              className="web-btn"
              title="New file"
              onClick={() => startCreate(root, "file")}
            >
              <FilePlusIcon />
            </button>
            <button
              className="web-btn"
              title="New folder"
              onClick={() => startCreate(root, "dir")}
            >
              <FolderPlusIcon />
            </button>
            <button className="web-btn" title="Refresh" onClick={refresh}>
              <RefreshIcon />
            </button>
          </span>
        )}
      </div>
      <div
        className="ex-tree"
        onContextMenu={(e) => root && openMenu(e, null, root)}
      >
        {root ? (
          <DirNode
            path={root}
            depth={0}
            cache={cache}
            expanded={expanded}
            creating={creating}
            gitMap={gitMap}
            gitDirs={gitDirs}
            onToggle={toggleDir}
            onOpenFile={onOpenFile}
            onMenu={openMenu}
            onCreateSubmit={submitCreate}
            onCreateCancel={() => setCreating(null)}
          />
        ) : (
          <div className="ex-empty">Open a workspace folder to browse files</div>
        )}
      </div>
      {menu && menuTargetDir && (
        <>
          <div className="menu-backdrop" onMouseDown={() => setMenu(null)} />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => startCreate(menuTargetDir, "file")}>
              New file
            </button>
            <button onClick={() => startCreate(menuTargetDir, "dir")}>
              New folder
            </button>
            {menu.item && (
              <>
                <div className="ctx-sep" />
                <button
                  className="danger"
                  onClick={() => deleteItem(menu.item!, menu.parentDir)}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
