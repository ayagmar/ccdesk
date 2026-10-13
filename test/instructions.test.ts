import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { relative, sep } from "node:path";
import { test } from "node:test";
import { scanDirectory } from "../src/core/index.ts";
import { makeFixture } from "./helpers/fixture.ts";

function loadedPaths(view: Awaited<ReturnType<typeof scanDirectory>>, root: string) {
  return view.instructions
    .filter((i) => i.status === "loaded")
    .map((i) => relative(root, i.path).split(sep).join("/"));
}

test("a repository with only AGENTS.md has Claude read AGENTS.md", async () => {
  const f = makeFixture();
  f.write("home/.claude/CLAUDE.md", "personal rules");
  f.write("work/app/AGENTS.md", "agent rules");

  const view = await scanDirectory(f.env, f.at("work/app"));

  // The user's own ~/.claude/CLAUDE.md does not count as a CLAUDE.md for this check.
  assert.deepEqual(loadedPaths(view, f.root), ["home/.claude/CLAUDE.md", "work/app/AGENTS.md"]);
});

test("a CLAUDE.local.md in a parent directory makes Claude skip AGENTS.md", async () => {
  const f = makeFixture();
  f.write("work/CLAUDE.local.md", "my private notes");
  f.write("work/app/AGENTS.md", "agent rules");

  const view = await scanDirectory(f.env, f.at("work/app"));

  const agents = view.instructions.find((i) => i.kind === "agents-md");
  assert.equal(agents?.status, "skipped");
  assert.deepEqual(loadedPaths(view, f.root), ["work/CLAUDE.local.md"]);
});

test("an AGENTS.md that CLAUDE.md imports is not loaded a second time", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "@AGENTS.md\n");
  f.write("app/AGENTS.md", "agent rules");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(loadedPaths(view, f.root), ["app/CLAUDE.md"]);
  assert.equal(view.instructions.find((i) => i.kind === "claude-md")?.imports[0]?.exists, true);
});

test("instruction mode claude-md-and-agents-md from user settings loads both files", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", {
    pluginConfigs: {
      "cc-plugin-agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } },
    },
  });
  f.write("app/CLAUDE.md", "claude rules");
  f.write("app/AGENTS.md", "agent rules");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(view.agentsMdMode, "claude-md-and-agents-md");
  assert.deepEqual(loadedPaths(view, f.root), ["app/CLAUDE.md", "app/AGENTS.md"]);
});

test("the instruction mode is ignored when set in a project settings file", async () => {
  const f = makeFixture();
  f.json("app/.claude/settings.json", {
    pluginConfigs: {
      "cc-plugin-agents-md@builtin": { options: { instructionFiles: "claude-md" } },
    },
  });
  f.write("app/AGENTS.md", "agent rules");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.equal(view.agentsMdMode, "claude-md-or-agents-md");
  assert.deepEqual(loadedPaths(view, f.root), ["app/AGENTS.md"]);
});

test("parent directory instructions load before the working directory's", async () => {
  const f = makeFixture();
  f.write("work/CLAUDE.md", "outer");
  f.write("work/app/CLAUDE.md", "inner");
  f.write("work/app/CLAUDE.local.md", "mine");

  const view = await scanDirectory(f.env, f.at("work/app"));

  assert.deepEqual(loadedPaths(view, f.root), [
    "work/CLAUDE.md",
    "work/app/CLAUDE.md",
    "work/app/CLAUDE.local.md",
  ]);
});

test("paths mentioned in code spans or fences are not treated as imports", async () => {
  const f = makeFixture();
  f.write(
    "app/CLAUDE.md",
    "Use `@docs/a.md` or `` @docs/d.md `` as an example.\n```\n@docs/b.md\n```\nReal: @docs/c.md\n"
  );

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.instructions[0]?.imports.map((i) => i.raw),
    ["docs/c.md"]
  );
  assert.equal(view.instructions[0]?.imports[0]?.exists, false);
});

test("a rule with paths frontmatter is listed but not loaded at session start", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/always.md", "always on");
  f.write("app/.claude/rules/tests.md", '---\npaths:\n  - "**/*.test.ts"\n---\nwrite good tests');

  const view = await scanDirectory(f.env, f.at("app"));
  const rules = view.instructions.filter((i) => i.kind === "rule");

  assert.deepEqual(
    rules.map((r) => [f.rel(r.path), r.status, r.paths ?? []]),
    [
      ["app/.claude/rules/always.md", "loaded", []],
      ["app/.claude/rules/tests.md", "on-match", ["**/*.test.ts"]],
    ]
  );
});

test("a rule with unquoted globs, a tab-indented paths list or spaces after its opening --- is still path-scoped", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/unquoted.md", "---\npaths: **/*.ts\n---\ntypes first");
  f.write("app/.claude/rules/tabbed.md", '---\npaths:\n\t- "docs/**"\n---\ndocs rules');
  f.write("app/.claude/rules/spaced.md", '--- \npaths: "src/**"\n---\nsource rules');

  const view = await scanDirectory(f.env, f.at("app"));
  const rules = view.instructions.filter((i) => i.kind === "rule");

  assert.deepEqual(
    rules.map((r) => [f.rel(r.path), r.status, r.paths ?? []]),
    [
      ["app/.claude/rules/spaced.md", "on-match", ["src/**"]],
      ["app/.claude/rules/tabbed.md", "on-match", ["docs/**"]],
      ["app/.claude/rules/unquoted.md", "on-match", ["**/*.ts"]],
    ]
  );
});

test("project instruction files report whether git tracks them", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "shared");
  f.write("app/CLAUDE.local.md", "private");
  f.write("app/.gitignore", "CLAUDE.local.md\n");
  f.git("app", "init", "-q");
  f.git("app", "add", "CLAUDE.md", ".gitignore");

  const view = await scanDirectory(f.env, f.at("app"));
  const byName = Object.fromEntries(view.instructions.map((i) => [f.rel(i.path), i.visibility]));

  assert.deepEqual(byName, { "app/CLAUDE.md": "tracked", "app/CLAUDE.local.md": "ignored" });
});

test("health checks flag a paragraph repeated across files and an import that does not exist", async () => {
  const f = makeFixture();
  const paragraph = "Always run the full test suite before you say a change is finished.";
  f.write("home/.claude/CLAUDE.md", `${paragraph}\n`);
  f.write("home/work/app/CLAUDE.md", `Intro.\n\n${paragraph}\n\n@docs/gone.md\n`);

  const view = await scanDirectory(f.env, f.at("home/work/app"));
  const project = view.instructions.find((i) => i.path === f.at("home/work/app/CLAUDE.md"));

  assert.deepEqual(project?.checks, [
    `Repeats a paragraph from ${f.at("home/.claude/CLAUDE.md")}`,
    "Imports @docs/gone.md, which does not exist",
  ]);
});

test("an instruction file that cannot be read is reported, not taken for missing", {
  // Root reads any file, and Windows ignores the mode bits that make a file unreadable.
  skip: process.getuid?.() === 0 || process.platform === "win32",
}, async () => {
  const f = makeFixture();
  const locked = f.write("app/CLAUDE.md", "secret plans\n");
  chmodSync(locked, 0o000);

  const view = await scanDirectory(f.env, f.at("app"));

  chmodSync(locked, 0o644);
  assert.deepEqual(
    view.problems.map((p) => p.path),
    [locked]
  );
});
