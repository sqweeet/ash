import { invoke } from "../backend/core";
import { listen } from "../backend/event";

const dataHandlers = new Map<string, (data: string) => void>();
const exitHandlers = new Map<string, () => void>();

interface PtyBackendInfo {
  backend: string;
  buildNumber: number;
}
let backendInfo: Promise<PtyBackendInfo> | undefined;

export function ptyBackend() {
  return backendInfo ??= invoke<PtyBackendInfo>("pty_backend");
}

let initialized = false;

/** Single global subscription; events are routed to per-session handlers. */
export function initPtyEvents() {
  if (initialized) return;
  initialized = true;
  listen<{ id: string; data: string }>("pty:data", (e) => {
    dataHandlers.get(e.payload.id)?.(e.payload.data);
  });
  listen<{ id: string }>("pty:exit", (e) => {
    exitHandlers.get(e.payload.id)?.();
  });
}

export function onPtyData(id: string, handler: (data: string) => void) {
  dataHandlers.set(id, handler);
}

export function onPtyExit(id: string, handler: () => void) {
  exitHandlers.set(id, handler);
}

export function offPty(id: string) {
  dataHandlers.delete(id);
  exitHandlers.delete(id);
}

export const ptySpawn = (
  id: string,
  cols: number,
  rows: number,
  cwd: string | null,
  program: string | null = null,
  args: string[] | null = null,
) => invoke<string>("pty_spawn", { id, cols, rows, cwd, program, args });

// Wails dispatches calls concurrently. Keep each terminal's input in wire
// order: notably, the DA reply must not overtake the OSC palette replies that
// precede it, or TUIs can finish theme detection with an empty/partial palette.
const pendingInput = new Map<string, Promise<unknown>>();
export function ptyWrite(id: string, data: string): Promise<unknown> {
  const send = () => invoke("pty_write", { id, data });
  const previous = pendingInput.get(id) ?? Promise.resolve();
  const next = previous.then(send, send);
  pendingInput.set(id, next);
  const cleanup = () => {
    if (pendingInput.get(id) === next) pendingInput.delete(id);
  };
  void next.then(cleanup, cleanup);
  return next;
}

export const ptyResize = (id: string, cols: number, rows: number) =>
  invoke("pty_resize", { id, cols, rows });

export const ptyKill = (id: string) => invoke("pty_kill", { id });
