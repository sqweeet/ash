// App commands route to the generated Wails bindings.
import * as Fs from "../../wailsjs/go/app/Fs";
import * as Git from "../../wailsjs/go/app/Git";
import * as Tools from "../../wailsjs/go/app/Tools";
import * as Pty from "../../wailsjs/go/app/Pty";
import * as Updater from "../../wailsjs/go/app/Updater";
import * as AppBinding from "../../wailsjs/go/app/App";

// Keep named command arguments at the UI/tool boundary.
export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    // ── fs ───────────────────────────────────────────────────
    case "read_text":
      return Fs.ReadText(args?.path as string) as Promise<T>;
    case "write_text":
      return Fs.WriteText(args?.path as string, args?.contents as string) as Promise<T>;
    case "delete_path":
      return Fs.DeletePath(args?.path as string) as Promise<T>;
    case "create_file":
      return Fs.CreateFile(args?.path as string) as Promise<T>;
    case "create_dir":
      return Fs.CreateDir(args?.path as string) as Promise<T>;
    case "list_dir":
      return (Fs.ListDir(args?.path as string) as Promise<unknown[]>).then(
        (r) => (r ?? []) as unknown as T,
      );

    // ── git ──────────────────────────────────────────────────
    case "git_branch":
      return Git.Branch(args?.path as string) as Promise<T>;
    case "git_status":
      return Git.Status(args?.path as string) as Promise<T>;
    case "git_diff_stat":
      return Git.DiffStat(args?.path as string) as Promise<T>;

    // ── tools ────────────────────────────────────────────────
    case "detect_bins":
      return Tools.DetectBins(args?.names as string[]).then(
        (r: string[] | null) => (r ?? []) as unknown as T,
      );
    case "ssh_hosts":
      return Tools.SshHosts().then((r: string[] | null) => (r ?? []) as unknown as T);
    case "open_in":
      return Tools.OpenIn(args?.app as string, args?.path as string, args?.isDir as boolean) as Promise<T>;

    // ── pty ──────────────────────────────────────────────────
    case "pty_backend":
      return Pty.PtyBackend() as Promise<T>;
    case "pty_spawn":
      return Pty.PtySpawn(
        args?.id as string,
        args?.cols as number,
        args?.rows as number,
        (args?.cwd as string | null) ?? "",
        (args?.program as string | null) ?? "",
        (args?.args as string[] | null) ?? [],
      ) as Promise<T>;
    case "pty_write":
      return Pty.PtyWrite(args?.id as string, args?.data as string) as Promise<T>;
    case "pty_resize":
      return Pty.PtyResize(args?.id as string, args?.cols as number, args?.rows as number) as Promise<T>;
    case "pty_kill":
      return Pty.PtyKill(args?.id as string) as Promise<T>;
    case "pty_foreground_process":
      return Pty.PtyForegroundProcess(args?.id as string) as Promise<T>;

    // ── updater (self-update against GitHub Releases) ────────
    case "check_update":
      return Updater.CheckUpdate() as Promise<T>;
    case "download_update":
      return Updater.DownloadUpdate() as Promise<T>;
    case "apply_update":
      return Updater.ApplyUpdate(args?.path as string) as Promise<T>;
    case "restart_app":
      return Updater.Restart() as Promise<T>;
    case "app_info":
      // AppInfo is on the root App binding, not Updater.
      return AppBinding.AppInfo() as unknown as Promise<T>;

    default:
      return Promise.reject(new Error(`Unknown backend command "${cmd}"`));
  }
}
