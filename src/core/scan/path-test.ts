import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type DirectoryView, type PathMatch, type PathTest } from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import {
  isFile,
  isWithin,
  listDir,
  MAX_TEXT_BYTES,
  matchingGlob,
  readTextFile,
  resolvedPath,
  stringsIn,
  walkMarkdown,
} from "./files.ts";
import { scanDirectory } from "./index.ts";
import {
  AGENTS_MD_NAMES,
  agentsMdLoads,
  CLAUDE_MD_NAMES,
  type ExcludeMatcher,
  excludeMatcher,
  linkedRuleBlock,
  rulePaths,
  ruleTarget,
} from "./instructions.ts";
import { applySkillOverrides, readSkill, reservedSkillNote } from "./inventory.ts";
import { pluginOnlySurfaces } from "./plugins.ts";

/** Globs are written with forward slashes on every platform. */
function slashed(path: string): string {
  return path.split(sep).join("/");
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
  const test: FolderTest = {
    env,
    cwd,
    target,
    realCwd: await resolvedPath(cwd),
    approved: view.trust.externalImports === "approved",
    mode: view.agentsMdMode,
    isExcluded: await excludeMatcher(
      stringsIn(view.effective.find((e) => e.key === "claudeMdExcludes")?.value)
    ),
    overrides: view.effective.find((e) => e.key === "skillOverrides")?.value,
    startSkills: new Set(
      view.inventory.skills.filter((s) => s.scope !== "plugin").map((s) => s.name)
    ),
    skillsLocked: pluginOnlySurfaces(
      view.settings.find((l) => l.scope === "managed")?.data ?? null
    ).has("skills"),
  };
  const matches = startRuleMatches(view, target, cwd);
  // Folders below the start directory load their own instructions, rules and skills on demand.
  const between: string[] = [];
  for (let d = dirname(target); d !== cwd && isWithin(cwd, d); d = dirname(d)) between.unshift(d);
  for (const folder of between)
    matches.push(
      ...(await nestedInstructions(test, folder)),
      ...(await nestedRules(test, folder)),
      ...(await nestedSkills(test, folder))
    );
  matches.push(...startSkillMatches(view, target, cwd));
  return { file: target, inside: true, exists: await isFile(target), matches };
}

/** What one path test needs to know in each folder between the start directory and the file. */
interface FolderTest {
  env: ScanEnv;
  cwd: string;
  target: string;
  realCwd: string;
  approved: boolean;
  mode: DirectoryView["agentsMdMode"];
  isExcluded: ExcludeMatcher;
  overrides: unknown;
  /** Names of the skills loaded at startup, which a nested skill of the same name is told from. */
  startSkills: Set<string>;
  /** Managed settings keep skills to plugins and the managed folder, so no project skill loads. */
  skillsLocked: boolean;
}

/** Path rules Claude Code would use at all: not excluded, not waiting for approval. */
function startRuleMatches(view: DirectoryView, target: string, cwd: string): PathMatch[] {
  const matches: PathMatch[] = [];
  for (const rule of view.instructions) {
    if (!rule.paths || rule.status !== "on-match") continue;
    // A project rule's globs are relative to the folder holding its .claude; user and managed
    // rules' to the start directory (observed in v2.1.296; the docs do not say).
    const base = rule.scope === "project" || rule.scope === "local" ? rule.dir : cwd;
    const glob = matchingGlob(rule.paths, slashed(relative(base, target)));
    if (glob) matches.push({ kind: "rule", path: rule.path, scope: rule.scope, glob });
  }
  return matches;
}

/** A folder's CLAUDE.md, CLAUDE.local.md and AGENTS.md files that load on demand. */
async function nestedInstructions(test: FolderTest, folder: string): Promise<PathMatch[]> {
  const { env, isExcluded, mode } = test;
  const matches: PathMatch[] = [];
  /** Whether the file is there; an excluded one or one over the limit is there but not loaded. */
  const nested = async (name: string, scope: PathMatch["scope"]) => {
    const path = join(folder, name);
    const text = await readTextFile(env, path);
    if (!text) return false;
    if (!isExcluded(path, text.realPath) && text.bytes <= MAX_TEXT_BYTES)
      matches.push({ kind: "nested", path, scope });
    return true;
  };
  // managed-only leaves out files at launch, but a subfolder's CLAUDE.md and rules still load
  // on demand (docs: memory#choose-which-instruction-files-load).
  let hasClaudeMd = false;
  for (const name of CLAUDE_MD_NAMES) if (await nested(name, "project")) hasClaudeMd = true;
  if (mode !== "managed-only" && (await nested("CLAUDE.local.md", "local"))) hasClaudeMd = true;
  if (agentsMdLoads(mode, hasClaudeMd))
    for (const name of AGENTS_MD_NAMES) await nested(name, "project");
  return matches;
}

/** A folder's rules that load for the file: ones without paths, and ones whose paths match it. */
async function nestedRules(test: FolderTest, folder: string): Promise<PathMatch[]> {
  const { env, target, realCwd, approved, isExcluded } = test;
  const matches: PathMatch[] = [];
  for (const path of await walkMarkdown(join(folder, ".claude", "rules"))) {
    const text = await readTextFile(env, path);
    if (!text || text.bytes > MAX_TEXT_BYTES) continue;
    // As at startup: excluded by its target's path too, and one linked from outside the project
    // waits for your approval, then loads only without paths.
    const linked = await ruleTarget(text, folder, realCwd);
    if (isExcluded(path, linked)) continue;
    const globs = rulePaths(text.text);
    if (linkedRuleBlock(linked, realCwd, approved, globs.length > 0)) continue;
    const glob =
      globs.length === 0 ? undefined : matchingGlob(globs, slashed(relative(folder, target)));
    if (globs.length === 0 || glob)
      matches.push({ kind: "nested", path, scope: "project", ...(glob ? { glob } : {}) });
  }
  return matches;
}

/**
 * A folder's skills Claude may pick itself: not off, user-invocable-only or
 * disable-model-invocation. Their paths do not count: Claude Code adds every skill it finds on
 * demand (observed in v2.1.296; the docs do not say).
 */
async function nestedSkills(test: FolderTest, folder: string): Promise<PathMatch[]> {
  const { env, cwd, overrides, startSkills, skillsLocked } = test;
  const matches: PathMatch[] = [];
  if (skillsLocked) return matches;
  for (const name of await listDir(join(folder, ".claude", "skills"))) {
    const skill = await readSkill(env, join(folder, ".claude", "skills", name), "project");
    if (!skill || reservedSkillNote(skill)) continue;
    applySkillOverrides([skill], overrides);
    if (skill.listed === false) continue;
    // A nested skill whose folder name another skill has is called by its folder as well, as
    // apps/web:deploy (docs: skills#how-a-skill-gets-its-command-name).
    matches.push({
      kind: "skill",
      path: skill.path,
      scope: "project",
      name: startSkills.has(name) ? `${slashed(relative(cwd, folder))}:${name}` : skill.name,
    });
  }
  return matches;
}

/**
 * Skills Claude can pick on its own; one with disable-model-invocation only runs when you call it.
 * Their globs are relative to the start directory, wherever the skill is (observed in v2.1.296).
 */
function startSkillMatches(view: DirectoryView, target: string, cwd: string): PathMatch[] {
  return view.inventory.skills.flatMap((skill): PathMatch[] => {
    if (!skill.paths || skill.listed === false || skill.shadowedBy || skill.skipped) return [];
    const glob = matchingGlob(skill.paths, slashed(relative(cwd, target)));
    if (!glob) return [];
    return [
      { kind: "skill", path: skill.path, scope: skill.scope, glob, name: skill.id ?? skill.name },
    ];
  });
}
