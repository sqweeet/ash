import { invoke } from "../../backend/core";
import { homeDir } from "../../backend/path";
import { resolveInCwd } from "./tools/paths";

// Claude Code-style skills: a folder holding a SKILL.md with YAML
// frontmatter (name/description) plus supporting files. Discovered from the
// project AND the user's global skill dirs, across the common conventions.
export interface SkillMeta {
  name: string;
  description: string;
  /** Directory holding SKILL.md — given to the model as the skill's base. */
  dir: string;
}

interface DirItem {
  name: string;
  path: string;
  is_dir: boolean;
}

const SKILL_ROOTS = [".ash/skills", ".claude/skills", ".agents/skills"];
const MD_CAP = 12_000;

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  const name = m[1].match(/^name:\s*["']?(.+?)["']?\s*$/m);
  const desc = m[1].match(/^description:\s*["']?([\s\S]+?)["']?\s*$/m);
  if (name) out.name = name[1].trim();
  if (desc) out.description = desc[1].trim();
  return out;
}

async function scanRoot(root: string): Promise<SkillMeta[]> {
  let entries: DirItem[];
  try {
    entries = await invoke<DirItem[]>("list_dir", { path: root });
  } catch {
    return []; // root doesn't exist — fine
  }
  const skills: SkillMeta[] = [];
  for (const e of entries) {
    if (!e.is_dir) continue;
    try {
      const md = await invoke<string | null>("read_text", { path: `${e.path}\\SKILL.md` });
      if (!md?.trim()) continue;
      const fm = parseFrontmatter(md);
      skills.push({
        name: fm.name ?? e.name,
        description: fm.description ?? md.replace(/^---[\s\S]*?---/, "").trim().split("\n")[0] ?? "",
        dir: e.path,
      });
    } catch {
      // unreadable skill folder — skip
    }
  }
  return skills;
}

// Discovery hits up to 6 directories (list + read per skill) and is invoked on
// every session init and slash-menu open — cache per cwd with a short TTL so
// five open panes don't rescan the same folders, while edits still show up.
const SKILL_CACHE_TTL = 30_000;
const skillCache = new Map<string, { at: number; skills: SkillMeta[] }>();

/** Project skills shadow same-named global ones. */
export async function discoverSkills(cwd: string): Promise<SkillMeta[]> {
  const cached = skillCache.get(cwd);
  if (cached && Date.now() - cached.at < SKILL_CACHE_TTL) return cached.skills;

  const roots: string[] = [];
  if (cwd) for (const r of SKILL_ROOTS) roots.push(resolveInCwd(cwd, r));
  try {
    const home = (await homeDir()).replace(/[\\/]+$/, "");
    for (const r of SKILL_ROOTS) roots.push(`${home}\\${r.replace(/\//g, "\\")}`);
  } catch {
    // no home dir — project roots only
  }
  // Project roots take precedence; scan independent directories concurrently.
  const results = await Promise.all(roots.map(scanRoot));
  const seen = new Map<string, SkillMeta>();
  for (const list of results)
    for (const s of list) if (!seen.has(s.name)) seen.set(s.name, s);
  const skills = [...seen.values()];
  skillCache.set(cwd, { at: Date.now(), skills });
  return skills;
}

export async function loadSkill(cwd: string, name: string): Promise<{ meta: SkillMeta; content: string } | null> {
  const skills = await discoverSkills(cwd);
  const meta = skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!meta) return null;
  const md = await invoke<string | null>("read_text", { path: `${meta.dir}\\SKILL.md` });
  if (!md) return null;
  const content = md.length > MD_CAP ? md.slice(0, MD_CAP) + "\n[truncated]" : md;
  return { meta, content };
}
