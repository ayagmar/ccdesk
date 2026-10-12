import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";
import { type DirectoryView, type PathMatch, type PathTest } from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import {
  isFile,
  isWithin,
  listDir,
  parseFrontmatter,
  readTextFile,
  stringsIn,
  toStringList,
  walkMarkdown,
} from "./files.ts";
import { scanDirectory } from "./index.ts";
import { applySkillOverrides, readSkill } from "./inventory.ts";

/** Globs are written with forward slashes on every platform. */
function slashed(path: string): string {
  return path.split(sep).join("/");
}

function firstMatch(globs: string[], path: string): string | undefined {
  return globs.find((glob) => {
    try {
      return matchesGlob(path, glob);
    } catch {
      // An invalid pattern matches nothing; the others still count (docs: memory#path-specific-rules).
      return false;
    }
  });
}

/**
 * What Claude Code adds to context once Claude reads or edits `file` in a session started in `dir`:
 * path-scoped rules, skills with matching `paths`, and CLAUDE.md files in the folders between.
 */
export async function testPath(
  env: ScanEnv,
  dir: string,
  file: string,
  /** The view of the start directory; a server passes one that reuses a current scan. */
  viewOf: (cwd: string) => Promise<DirectoryView> = (cwd) => scanDirectory(env, cwd)
): Promise<PathTest> {
  const cwd = resolve(dir);
  const target = isAbsolute(file) ? resolve(file) : resolve(cwd, file);
  if (target === cwd || !isWithin(cwd, target))
    return { file: target, inside: false, exists: false, matches: [] };

  const view = await viewOf(cwd);
  const projectRoot = view.gitRoot ?? cwd;
  const matches: PathMatch[] = [];

  const excludes = stringsIn(view.effective.find((e) => e.key === "claudeMdExcludes")?.value);
  const overrides = view.effective.find((e) => e.key === "skillOverrides")?.value;
  const excluded = (path: string) =>
    excludes.some((glob) => firstMatch([glob], path) !== undefined);

  // Path rules Claude Code would use at all: not excluded, not waiting for approval.
  for (const rule of view.instructions) {
    if (!rule.paths || rule.status !== "on-match") continue;
    // A project rule's globs are relative to the folder holding its .claude; others to the project.
    const base = rule.scope === "project" || rule.scope === "local" ? rule.dir : projectRoot;
    const glob = firstMatch(rule.paths, slashed(relative(base, target)));
    if (glob) matches.push({ kind: "rule", path: rule.path, scope: rule.scope, glob });
  }

  // Folders below the start directory load their own instructions, rules and skills on demand.
  const mode = view.agentsMdMode;
  const startSkills = new Set(
    view.inventory.skills.filter((s) => s.scope !== "plugin").map((s) => s.name)
  );
  const between: string[] = [];
  for (let d = dirname(target); d !== cwd && isWithin(cwd, d); d = dirname(d)) between.unshift(d);
  for (const folder of between) {
    const nested = async (name: string, scope: PathMatch["scope"]) => {
      const path = join(folder, name);
      if (excluded(path) || !(await readTextFile(env, path))) return false;
      matches.push({ kind: "nested", path, scope });
      return true;
    };
    // managed-only leaves out files at launch, but a subfolder's CLAUDE.md and rules still load
    // on demand (docs: memory#choose-which-instruction-files-load).
    let hasClaudeMd = false;
    for (const name of ["CLAUDE.md", ".claude/CLAUDE.md"])
      if (await nested(name, "project")) hasClaudeMd = true;
    if (mode !== "managed-only" && (await nested("CLAUDE.local.md", "local"))) hasClaudeMd = true;
    const agents =
      mode === "claude-md-and-agents-md" || (mode === "claude-md-or-agents-md" && !hasClaudeMd);
    if (agents) await nested("AGENTS.md", "project");
    for (const path of await walkMarkdown(join(folder, ".claude", "rules"))) {
      const text = await readTextFile(env, path);
      if (!text || excluded(path)) continue;
      const globs = toStringList(parseFrontmatter(text.text).data.paths);
      const glob =
        globs.length === 0 ? undefined : firstMatch(globs, slashed(relative(folder, target)));
      if (globs.length === 0 || glob)
        matches.push({ kind: "nested", path, scope: "project", ...(glob ? { glob } : {}) });
    }
    // Only skills Claude may pick itself: not off, user-invocable-only or disable-model-invocation;
    // one with paths only for a matching file, its globs read from its folder like a rule's.
    for (const name of await listDir(join(folder, ".claude", "skills"))) {
      const skill = await readSkill(env, join(folder, ".claude", "skills", name), "project");
      if (!skill) continue;
      applySkillOverrides([skill], overrides);
      if (skill.listed === false) continue;
      const glob = skill.paths && firstMatch(skill.paths, slashed(relative(folder, target)));
      if (skill.paths && !glob) continue;
      // A nested skill whose folder name another skill has is called by its folder as well, as
      // apps/web:deploy (docs: skills#how-a-skill-gets-its-command-name).
      matches.push({
        kind: "skill",
        path: skill.path,
        scope: "project",
        name: startSkills.has(name) ? `${slashed(relative(cwd, folder))}:${name}` : skill.name,
        ...(glob ? { glob } : {}),
      });
    }
  }

  // Skills Claude can pick on its own; one with disable-model-invocation only runs when you call it.
  for (const skill of view.inventory.skills) {
    if (!skill.paths || skill.listed === false || skill.shadowedBy) continue;
    const glob = firstMatch(skill.paths, slashed(relative(projectRoot, target)));
    if (glob)
      matches.push({
        kind: "skill",
        path: skill.path,
        scope: skill.scope,
        glob,
        name: skill.id ?? skill.name,
      });
  }

  return { file: target, inside: true, exists: await isFile(target), matches };
}
