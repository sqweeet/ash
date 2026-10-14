import { invoke } from "../../../backend/core";
import { Tool } from "../types";
import { resolveToolPath } from "./paths";

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  for (;;) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) break;
    count++;
    idx += needle.length;
  }
  return count;
}

// Claude Code's actual edit mechanism: exact old_string/new_string
// replacement, not a line-numbered diff — line numbers drift and are
// unreliable for LLMs to produce correctly.
export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Replace an exact, unique block of text in an existing file with new text. old_string must match the file's current content exactly (including whitespace) and must be unique unless replace_all is set. Use write_file to create a new file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative file path" },
      old_string: { type: "string", description: "Exact text to find (must be unique unless replace_all)" },
      new_string: { type: "string", description: "Text to replace it with" },
      replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a single match" },
    },
    required: ["path", "old_string", "new_string"],
  },
  async run(args, ctx) {
    const path = resolveToolPath(ctx.cwd, args.path, ctx.safety);
    const oldString: string = args.old_string;
    const newString: string = args.new_string;
    const replaceAll: boolean = !!args.replace_all;

    if (!oldString)
      return { ok: false, output: "old_string must be non-empty." };
    if (oldString === newString)
      return { ok: false, output: "new_string is identical to old_string; no edit would be made." };

    const content = await invoke<string | null>("read_text", { path });
    if (content === null)
      return { ok: false, output: `File not found: ${path}. Use write_file to create it.` };

    const occurrences = countOccurrences(content, oldString);
    if (occurrences === 0)
      return { ok: false, output: `old_string not found in ${path}. Re-read the file to get exact current content.` };
    if (occurrences > 1 && !replaceAll)
      return {
        ok: false,
        output: `old_string occurs ${occurrences} times in ${path} — it must be unique, or pass replace_all: true.`,
      };

    // split/join does a LITERAL replacement. String.prototype.replace would
    // interpret $-sequences in new_string ($&, $1, $$, $`) as special patterns
    // and silently corrupt any replacement text containing '$'. In the
    // non-replace_all branch occurrences is exactly 1 here, so this is equivalent.
    const next = content.split(oldString).join(newString);

    await invoke("write_text", { path, contents: next });
    return { ok: true, output: `Edited ${path} (${occurrences} replacement${occurrences > 1 ? "s" : ""})` };
  },
};
