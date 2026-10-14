import { invoke } from "../../../backend/core";

export interface RunProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export interface RunProcessOpts {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Promise wrapper over the raw one-shot process bridge, shared by every
 * tool that shells out (bash/grep/glob/web_fetch). A per-call id lets Stop
 * cancel the matching Go process tree instead of merely abandoning the UI's
 * Promise while npm/dev-server descendants keep running in the background. */
export function runProcess(
  program: string,
  args: string[],
  cwd: string,
  opts: RunProcessOpts,
): Promise<RunProcessResult> {
  if (opts.signal?.aborted)
    return Promise.resolve({
      code: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: true,
    });

  const id = crypto.randomUUID();
  let cancelSent = false;
  const cancel = () => {
    if (cancelSent) return;
    cancelSent = true;
    void invoke("process_cancel", { id }).catch(() => {});
  };
  opts.signal?.addEventListener("abort", cancel, { once: true });

  return invoke<{
    code: number | null;
    stdout: string;
    stderr: string;
    timed_out: boolean;
    cancelled: boolean;
  }>("process_run", {
    id,
    program,
    args,
    cwd,
    timeoutMs: opts.timeoutMs,
  })
    .then((res) => ({
      code: res.code,
      stdout: res.stdout,
      stderr: res.stderr,
      timedOut: res.timed_out,
      cancelled: res.cancelled,
    }))
    .catch((error) => ({
      code: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      timedOut: false,
      cancelled: opts.signal?.aborted ?? false,
    }))
    .finally(() => opts.signal?.removeEventListener("abort", cancel));
}
