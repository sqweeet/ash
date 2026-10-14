import { OpenDialog, Ask } from "../../wailsjs/go/app/Tools";

export async function open(opts?: { directory?: boolean; title?: string }): Promise<string | null> {
  return (await OpenDialog(opts?.title ?? "", !!opts?.directory)) || null;
}

export function ask(message: string, opts?: { title?: string; kind?: string }): Promise<boolean> {
  return Ask(message, opts?.title ?? "Confirm");
}
