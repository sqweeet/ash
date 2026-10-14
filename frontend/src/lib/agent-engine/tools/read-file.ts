import { invoke } from "../../../backend/core";
import { Tool } from "../types";
import { resolveToolPath } from "./paths";

const MAX_LINES = 2000;
// A single minified/base64 line, or a giant file, otherwise produces a huge
// blob that's slow both to hand to the model and for it to reason around —
// which is exactly what made a "read one file" step drag. Clamp both axes.
const MAX_LINE_LEN = 1000;
const MAX_OUTPUT_CHARS = 60_000;

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read a text file's contents. Optionally start at a line offset and limit how many lines are returned.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative file path" },
      offset: { type: "number", description: "1-indexed line to start from (default 1)" },
      limit: { type: "number", description: `Max lines to return (default ${MAX_LINES})` },
    },
    required: ["path"],
  },
  async run(args, ctx) {
    const path = resolveToolPath(ctx.cwd, args.path, ctx.safety);
    const content = await invoke<string | null>("read_text", { path });
    if (content === null) return { ok: false, output: `File not found: ${path}` };

    const lines = content.split("\n");
    const offset = Math.max(1, args.offset ?? 1) - 1;
    const limit = Math.max(1, args.limit ?? MAX_LINES);
    const slice = lines.slice(offset, offset + limit);
    const lineTruncated = offset + limit < lines.length;

    // Clamp over-long lines so one minified line can't balloon the output.
    let longLines = 0;
    const clamped = slice.map((l) => {
      if (l.length <= MAX_LINE_LEN) return l;
      longLines++;
      return l.slice(0, MAX_LINE_LEN) + ` … [+${l.length - MAX_LINE_LEN} chars]`;
    });

    let output = clamped.join("\n");
    let charTruncated = false;
    if (output.length > MAX_OUTPUT_CHARS) {
      output = output.slice(0, MAX_OUTPUT_CHARS);
      charTruncated = true;
    }

    const notes: string[] = [];
    if (charTruncated)
      notes.push(`output capped at ${MAX_OUTPUT_CHARS} chars — narrow with offset/limit for more`);
    else if (lineTruncated)
      notes.push(`showing lines ${offset + 1}-${offset + slice.length} of ${lines.length}`);
    if (longLines) notes.push(`${longLines} long line(s) clamped to ${MAX_LINE_LEN} chars`);
    if (notes.length) output += `\n\n[${notes.join("; ")}]`;

    return { ok: true, output };
  },
};
