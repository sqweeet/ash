import { invoke } from "../../../backend/core";
import { Tool } from "../types";
import { resolveToolPath } from "./paths";

// edit_file can't create a file (no old_string to anchor to) — this is the
// only tool that creates or wholesale-overwrites one.
export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Create a new file or overwrite an existing one with the given content. Use edit_file instead when modifying part of an existing file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative file path" },
      content: { type: "string", description: "Full file content to write" },
    },
    required: ["path", "content"],
  },
  async run(args, ctx) {
    const path = resolveToolPath(ctx.cwd, args.path, ctx.safety);
    await invoke("write_text", { path, contents: args.content ?? "" });
    return { ok: true, output: `Wrote ${path}` };
  },
};
