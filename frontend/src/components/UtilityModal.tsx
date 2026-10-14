import { useEffect, useState } from "react";
import { open as openDialog } from "../backend/dialog";

import { Utility } from "../App";

interface UtilityModalProps {
  initial: Utility | null;
  onSave: (data: { name: string; command: string; cwd?: string }) => void;
  onClose: () => void;
}

export default function UtilityModal({
  initial,
  onSave,
  onClose,
}: UtilityModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [cwd, setCwd] = useState(initial?.cwd ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const valid = name.trim() && command.trim();

  const save = () => {
    if (!valid) return;
    onSave({
      name: name.trim(),
      command: command.trim(),
      cwd: cwd.trim() || undefined,
    });
  };

  const browse = async () => {
    const selected = await openDialog({ directory: true, title: "Utility folder" });
    if (typeof selected === "string") setCwd(selected);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{initial ? "Edit utility" : "New utility"}</span>
        </div>

        <div className="field">
          <label>Name</label>
          <input
            autoFocus
            value={name}
            placeholder="claude"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") save();
            }}
          />
        </div>

        <div className="field">
          <label>Command</label>
          <input
            value={command}
            placeholder="claude --dangerously-skip-permissions"
            spellCheck={false}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") save();
            }}
          />
        </div>

        <div className="field">
          <label>Folder (optional — defaults to active workspace)</label>
          <div className="field-row">
            <input
              value={cwd}
              placeholder="C:\projects\app"
              spellCheck={false}
              onChange={(e) => setCwd(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button className="btn" onClick={browse}>
              Browse
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
