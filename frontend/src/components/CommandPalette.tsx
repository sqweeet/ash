import { useEffect, useMemo, useRef, useState } from "react";

import { Tab, Workspace } from "../App";
import { leaves } from "../lib/layout";

interface CommandPaletteProps {
  tabs: Tab[];
  workspaces: Workspace[];
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

interface Item {
  key: string;
  label: string;
  sub?: string;
  shortcut?: string;
  icon: React.ReactNode;
  run: () => void;
}

const ComposeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M11.9426 1.25L13.5 1.25C13.9142 1.25 14.25 1.58579 14.25 2C14.25 2.41421 13.9142 2.75 13.5 2.75H12C9.62177 2.75 7.91356 2.75159 6.61358 2.92637C5.33517 3.09825 4.56445 3.42514 3.9948 3.9948C3.42514 4.56445 3.09825 5.33517 2.92637 6.61358C2.75159 7.91356 2.75 9.62177 2.75 12C2.75 14.3782 2.75159 16.0864 2.92637 17.3864C3.09825 18.6648 3.42514 19.4355 3.9948 20.0052C4.56445 20.5749 5.33517 20.9018 6.61358 21.0736C7.91356 21.2484 9.62177 21.25 12 21.25C14.3782 21.25 16.0864 21.2484 17.3864 21.0736C18.6648 20.9018 19.4355 20.5749 20.0052 20.0052C20.5749 19.4355 20.9018 18.6648 21.0736 17.3864C21.2484 16.0864 21.25 14.3782 21.25 12V10.5C21.25 10.0858 21.5858 9.75 22 9.75C22.4142 9.75 22.75 10.0858 22.75 10.5V12.0574C22.75 14.3658 22.75 16.1748 22.5603 17.5863C22.366 19.031 21.9607 20.1711 21.0659 21.0659C20.1711 21.9607 19.031 22.366 17.5863 22.5603C16.1748 22.75 14.3658 22.75 12.0574 22.75H11.9426C9.63423 22.75 7.82519 22.75 6.41371 22.5603C4.96897 22.366 3.82895 21.9607 2.93414 21.0659C2.03933 20.1711 1.63399 19.031 1.43975 17.5863C1.24998 16.1748 1.24999 14.3658 1.25 12.0574V11.9426C1.24999 9.63423 1.24998 7.82519 1.43975 6.41371C1.63399 4.96897 2.03933 3.82895 2.93414 2.93414C3.82895 2.03933 4.96897 1.63399 6.41371 1.43975C7.82519 1.24998 9.63423 1.24999 11.9426 1.25ZM16.7705 2.27592C18.1384 0.908029 20.3562 0.908029 21.7241 2.27592C23.092 3.6438 23.092 5.86158 21.7241 7.22947L15.076 13.8776C14.7047 14.2489 14.4721 14.4815 14.2126 14.684C13.9069 14.9224 13.5761 15.1268 13.2261 15.2936C12.929 15.4352 12.6169 15.5392 12.1188 15.7052L9.21426 16.6734C8.67801 16.8521 8.0868 16.7126 7.68711 16.3129C7.28742 15.9132 7.14785 15.322 7.3266 14.7857L8.29477 11.8812C8.46079 11.3831 8.56479 11.071 8.7064 10.7739C8.87319 10.4239 9.07761 10.0931 9.31605 9.78742C9.51849 9.52787 9.7511 9.29529 10.1224 8.924L16.7705 2.27592ZM20.6634 3.33658C19.8813 2.55448 18.6133 2.55448 17.8312 3.33658L17.4546 3.7132C17.4773 3.80906 17.509 3.92327 17.5532 4.05066C17.6965 4.46372 17.9677 5.00771 18.48 5.51999C18.9923 6.03227 19.5363 6.30346 19.9493 6.44677C20.0767 6.49097 20.1909 6.52273 20.2868 6.54543L20.6634 6.16881C21.4455 5.38671 21.4455 4.11867 20.6634 3.33658ZM19.1051 7.72709C18.5892 7.50519 17.9882 7.14946 17.4193 6.58065C16.8505 6.01185 16.4948 5.41082 16.2729 4.89486L11.2175 9.95026C10.801 10.3668 10.6376 10.532 10.4988 10.7099C10.3274 10.9297 10.1804 11.1676 10.0605 11.4192C9.96337 11.623 9.88868 11.8429 9.7024 12.4017L9.27051 13.6974L10.3026 14.7295L11.5983 14.2976C12.1571 14.1113 12.377 14.0366 12.5808 13.9395C12.8324 13.8196 13.0703 13.6726 13.2901 13.5012C13.468 13.3624 13.6332 13.199 14.0497 12.7825L19.1051 7.72709Z" />
  </svg>
);
const FolderIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.4299 14.55H9.42993" />
    <path d="M22 11V17C22 21 21 22 17 22H7C3 22 2 21 2 17V7C2 3 3 2 7 2H8.5C10 2 10.33 2.44 10.9 3.2L12.4 5.2C12.78 5.7 13 6 14 6H17C21 6 22 7 22 11Z" />
  </svg>
);
const GearIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 8.25C9.92893 8.25 8.25 9.92893 8.25 12C8.25 14.0711 9.92893 15.75 12 15.75C14.0711 15.75 15.75 14.0711 15.75 12C15.75 9.92893 14.0711 8.25 12 8.25ZM9.75 12C9.75 10.7574 10.7574 9.75 12 9.75C13.2426 9.75 14.25 10.7574 14.25 12C14.25 13.2426 13.2426 14.25 12 14.25C10.7574 14.25 9.75 13.2426 9.75 12Z" />
    <path fillRule="evenodd" clipRule="evenodd" d="M12 1.25C11.2954 1.25 10.6519 1.44359 9.94858 1.77037C9.26808 2.08656 8.48039 2.55304 7.49457 3.13685L6.74148 3.58283C5.75533 4.16682 4.96771 4.63324 4.36076 5.07944C3.73315 5.54083 3.25177 6.01311 2.90334 6.63212C2.55548 7.25014 2.39841 7.91095 2.32306 8.69506C2.24999 9.45539 2.24999 10.3865 2.25 11.556V12.444C2.24999 13.6135 2.24999 14.5446 2.32306 15.3049C2.39841 16.0891 2.55548 16.7499 2.90334 17.3679C3.25177 17.9869 3.73315 18.4592 4.36076 18.9206C4.96771 19.3668 5.75533 19.8332 6.74148 20.4172L7.4946 20.8632C8.48038 21.447 9.2681 21.9135 9.94858 22.2296C10.6519 22.5564 11.2954 22.75 12 22.75C12.7046 22.75 13.3481 22.5564 14.0514 22.2296C14.7319 21.9134 15.5196 21.447 16.5054 20.8632L17.2585 20.4172C18.2446 19.8332 19.0323 19.3668 19.6392 18.9206C20.2669 18.4592 20.7482 17.9869 21.0967 17.3679C21.4445 16.7499 21.6016 16.0891 21.6769 15.3049C21.75 14.5446 21.75 13.6135 21.75 12.4441V11.556C21.75 10.3866 21.75 9.45538 21.6769 8.69506C21.6016 7.91095 21.4445 7.25014 21.0967 6.63212C20.7482 6.01311 20.2669 5.54083 19.6392 5.07944C19.0323 4.63324 18.2447 4.16683 17.2585 3.58285L16.5054 3.13685C15.5196 2.55303 14.7319 2.08656 14.0514 1.77037C13.3481 1.44359 12.7046 1.25 12 1.25ZM8.22524 4.44744C9.25238 3.83917 9.97606 3.41161 10.5807 3.13069C11.1702 2.85676 11.5907 2.75 12 2.75C12.4093 2.75 12.8298 2.85676 13.4193 3.13069C14.0239 3.41161 14.7476 3.83917 15.7748 4.44744L16.4609 4.85379C17.4879 5.46197 18.2109 5.89115 18.7508 6.288C19.2767 6.67467 19.581 6.99746 19.7895 7.36788C19.9986 7.73929 20.1199 8.1739 20.1838 8.83855C20.2492 9.51884 20.25 10.378 20.25 11.5937V12.4063C20.25 13.622 20.2492 14.4812 20.1838 15.1614C20.1199 15.8261 19.9986 16.2607 19.7895 16.6321C19.581 17.0025 19.2767 17.3253 18.7508 17.712C18.2109 18.1089 17.4879 18.538 16.4609 19.1462L15.7748 19.5526C14.7476 20.1608 14.0239 20.5884 13.4193 20.8693C12.8298 21.1432 12.4093 21.25 12 21.25C11.5907 21.25 11.1702 21.1432 10.5807 20.8693C9.97606 20.5884 9.25238 20.1608 8.22524 19.5526L7.53909 19.1462C6.5121 18.538 5.78906 18.1089 5.24923 17.712C4.72326 17.3253 4.419 17.0025 4.2105 16.6321C4.00145 16.2607 3.88005 15.8261 3.81618 15.1614C3.7508 14.4812 3.75 13.622 3.75 12.4063V11.5937C3.75 10.378 3.7508 9.51884 3.81618 8.83855C3.88005 8.1739 4.00145 7.73929 4.2105 7.36788C4.419 6.99746 4.72326 6.67467 5.24923 6.288C5.78906 5.89115 6.5121 5.46197 7.53909 4.85379L8.22524 4.44744Z" />
  </svg>
);
const TermIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6.96967 7.46967C7.26256 7.17678 7.73744 7.17678 8.03033 7.46967L12.0303 11.4697C12.3232 11.7626 12.3232 12.2374 12.0303 12.5303L8.03033 16.5303C7.73744 16.8232 7.26256 16.8232 6.96967 16.5303C6.67678 16.2374 6.67678 15.7626 6.96967 15.4697L10.4393 12L6.96967 8.53033C6.67678 8.23744 6.67678 7.76256 6.96967 7.46967Z" />
    <path d="M11.5 15.25C11.0858 15.25 10.75 15.5858 10.75 16C10.75 16.4142 11.0858 16.75 11.5 16.75H16.5C16.9142 16.75 17.25 16.4142 17.25 16C17.25 15.5858 16.9142 15.25 16.5 15.25H11.5Z" />
    <path fillRule="evenodd" clipRule="evenodd" d="M8.367 1.25H15.633C16.7251 1.24999 17.5906 1.24999 18.2883 1.30699C19.0017 1.36527 19.6053 1.48688 20.1565 1.76772C21.0502 2.22312 21.7769 2.94978 22.2323 3.84355C22.5131 4.39472 22.6347 4.99834 22.693 5.71173C22.75 6.40935 22.75 7.27484 22.75 8.36698V15.633C22.75 16.7252 22.75 17.5906 22.693 18.2883C22.6347 19.0017 22.5131 19.6053 22.2323 20.1565C21.7769 21.0502 21.0502 21.7769 20.1565 22.2323C19.6053 22.5131 19.0017 22.6347 18.2883 22.693C17.5906 22.75 16.7252 22.75 15.633 22.75H8.36698C7.27484 22.75 6.40935 22.75 5.71173 22.693C4.99834 22.6347 4.39472 22.5131 3.84355 22.2323C2.94978 21.7769 2.22312 21.0502 1.76772 20.1565C1.48688 19.6053 1.36527 19.0017 1.30699 18.2883C1.24999 17.5906 1.24999 16.7252 1.25 15.633V8.367C1.24999 7.27486 1.24999 6.40935 1.30699 5.71173C1.36527 4.99834 1.48688 4.39472 1.76772 3.84355C2.22312 2.94978 2.94978 2.22312 3.84355 1.76772C4.39472 1.48688 4.99834 1.36527 5.71173 1.30699C6.40935 1.24999 7.27486 1.24999 8.367 1.25ZM5.83388 2.80201C5.21325 2.85271 4.829 2.94909 4.52453 3.10423C3.913 3.41582 3.41582 3.913 3.10423 4.52453C2.94909 4.829 2.85271 5.21325 2.80201 5.83388C2.75058 6.46327 2.75 7.26752 2.75 8.4V15.6C2.75 16.7325 2.75058 17.5367 2.80201 18.1661C2.85271 18.7867 2.94909 19.171 3.10423 19.4755C3.41582 20.087 3.913 20.5842 4.52453 20.8958C4.829 21.0509 5.21325 21.1473 5.83388 21.198C6.46327 21.2494 7.26752 21.25 8.4 21.25H15.6C16.7325 21.25 17.5367 21.2494 18.1661 21.198C18.7867 21.1473 19.171 21.0509 19.4755 20.8958C20.087 20.5842 20.5842 20.087 20.8958 19.4755C21.0509 19.171 21.1473 18.7867 21.198 18.1661C21.2494 17.5367 21.25 16.7325 21.25 15.6V8.4C21.25 7.26752 21.2494 6.46327 21.198 5.83388C21.1473 5.21325 21.0509 4.829 20.8958 4.52453C20.5842 3.913 20.087 3.41582 19.4755 3.10423C19.171 2.94909 18.7867 2.85271 18.1661 2.80201C17.5367 2.75058 16.7325 2.75 15.6 2.75H8.4C7.26752 2.75 6.46327 2.75058 5.83388 2.80201Z" />
  </svg>
);
const FileIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M18 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2Z" />
  </svg>
);

// Match the sidebar: pick the icon by what the single-leaf tab holds.
function tabItemIcon(t: Tab) {
  const ls = leaves(t.root);
  const kind = ls.length === 1 ? ls[0].kind : "term";
  if (kind === "file") return <FileIcon />;
  return <TermIcon />;
}

export default function CommandPalette({
  tabs,
  workspaces,
  onSelectTab,
  onNewTab,
  onOpenFolder,
  onOpenSettings,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [closing, setClosing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Sliding selection highlight (glides between rows instead of snapping).
  const [hl, setHl] = useState<{ top: number; height: number; ready: boolean }>({
    top: 0,
    height: 0,
    ready: false,
  });

  // Play the exit animation, then actually unmount.
  const closeTimer = useRef<number | undefined>(undefined);
  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 150);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const q = query.trim().toLowerCase();
  const wsName = (id: string | null) =>
    workspaces.find((w) => w.id === id)?.name ?? "";

  const groups = useMemo(() => {
    const tabItems: Item[] = tabs
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !q || t.title.toLowerCase().includes(q))
      .map(({ t, i }) => ({
        key: `tab:${t.id}`,
        label: t.title,
        sub: wsName(t.workspaceId),
        shortcut: i < 9 ? `Ctrl ${i + 1}` : undefined,
        icon: tabItemIcon(t),
        run: () => {
          onSelectTab(t.id);
          onClose();
        },
      }));

    const actionItems: Item[] = (
      [
        {
          key: "new",
          label: "New terminal",
          shortcut: "Ctrl ⇧ T",
          icon: <ComposeIcon />,
          run: () => {
            onNewTab();
            onClose();
          },
        },
        {
          key: "folder",
          label: "Open folder",
          icon: <FolderIcon />,
          run: () => {
            onOpenFolder();
            onClose();
          },
        },
        {
          key: "settings",
          label: "Settings",
          shortcut: "Ctrl ,",
          icon: <GearIcon />,
          run: () => {
            onOpenSettings();
            onClose();
          },
        },
      ] as Item[]
    ).filter((a) => !q || a.label.toLowerCase().includes(q));

    return [
      { title: "Tabs", items: tabItems },
      { title: "Actions", items: actionItems },
    ].filter((g) => g.items.length > 0);
  }, [tabs, workspaces, q]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    if (sel >= flat.length) setSel(Math.max(0, flat.length - 1));
  }, [flat.length, sel]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(".palette-item.sel");
    if (!el) {
      setHl((h) => ({ ...h, ready: false }));
      return;
    }
    el.scrollIntoView({ block: "nearest" });
    setHl({ top: el.offsetTop, height: el.offsetHeight, ready: true });
  }, [sel, flat.length, query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[sel]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    }
  };

  let idx = -1;
  return (
    <div
      className={`palette-overlay${closing ? " closing" : ""}`}
      onMouseDown={dismiss}
    >
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <svg className="palette-search-ico" width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M11.5 2.75C6.66751 2.75 2.75 6.66751 2.75 11.5C2.75 16.3325 6.66751 20.25 11.5 20.25C16.3325 20.25 20.25 16.3325 20.25 11.5C20.25 6.66751 16.3325 2.75 11.5 2.75ZM1.25 11.5C1.25 5.83908 5.83908 1.25 11.5 1.25C17.1609 1.25 21.75 5.83908 21.75 11.5C21.75 14.0605 20.8111 16.4017 19.2589 18.1982L22.5303 21.4697C22.8232 21.7626 22.8232 22.2374 22.5303 22.5303C22.2374 22.8232 21.7626 22.8232 21.4697 22.5303L18.1982 19.2589C16.4017 20.8111 14.0605 21.75 11.5 21.75C5.83908 21.75 1.25 17.1609 1.25 11.5Z" />
          </svg>
          <input
            className="palette-input"
            autoFocus
            value={query}
            placeholder="Search tabs or run a command"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd className="palette-esc" onClick={dismiss}>
            Esc
          </kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {hl.ready && flat.length > 0 && (
            <div
              className="palette-highlight"
              style={{
                transform: `translateY(${hl.top}px)`,
                height: hl.height,
              }}
            />
          )}
          {flat.length === 0 && (
            <div className="palette-empty">No matches</div>
          )}
          {groups.map((g) => (
            <div className="palette-group" key={g.title}>
              <div className="palette-head">{g.title}</div>
              {g.items.map((it) => {
                idx += 1;
                const i = idx;
                return (
                  <button
                    key={it.key}
                    className={`palette-item${i === sel ? " sel" : ""}`}
                    onMouseMove={() => setSel(i)}
                    onClick={it.run}
                  >
                    <span className="palette-ico">{it.icon}</span>
                    <span className="palette-label">{it.label}</span>
                    {it.sub && <span className="palette-sub">{it.sub}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
