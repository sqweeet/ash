import { Tool } from "../types";
import { runProcess } from "./run-process";
import { htmlToText } from "./html-to-text";

const TIMEOUT_MS = 20_000;
const MAX_CHARS = 8_000;

// Runs as a child process (curl.exe), not fetch() — arbitrary third-party
// pages essentially never send Access-Control-Allow-Origin, so a webview
// fetch() would likely fail to expose the body even with CSP disabled.
// curl.exe (stock on modern Windows) sidesteps CORS entirely.
export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "Fetch a URL and return its readable text content (HTML stripped to plain text).",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
    },
    required: ["url"],
  },
  async run(args, ctx) {
    const url: string = args.url;
    try {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
    } catch {
      return { ok: false, output: "Expected an HTTP or HTTPS URL." };
    }
    const res = await runProcess(
      "curl.exe",
      // Bind the URL with --url so a value starting with '-' isn't parsed as a
      // curl option (curl treats bare args as URLs but still option-parses a
      // leading '-').
      ["-sSL", "--proto", "=http,https", "--proto-redir", "=http,https", "--max-time", "18", "--url", url],
      ctx.cwd,
      { timeoutMs: TIMEOUT_MS, signal: ctx.signal },
    );
    if (res.timedOut) return { ok: false, output: `Timed out fetching ${url}.` };
    if (res.code !== 0)
      return { ok: false, output: `Failed to fetch ${url} (curl exit ${res.code}):\n${res.stderr.trim()}` };
    if (!res.stdout.trim()) return { ok: false, output: `${url} returned no content.` };

    const text = htmlToText(res.stdout);
    const capped =
      text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + `\n[truncated — ${text.length - MAX_CHARS} more chars]` : text;
    return { ok: true, output: capped };
  },
};
