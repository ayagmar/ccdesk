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

test("turning off the built-in AGENTS.md plugin leaves CLAUDE.md files only, under either of its ids", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", {
    enabledPlugins: { "cc-plugin-agents-md@builtin": false },
  });
  f.write("app/AGENTS.md", "agent rules");
  f.json("other/.claude/settings.local.json", { enabledPlugins: { "agents-md@builtin": false } });
  f.write("other/AGENTS.md", "agent rules");

  const app = await scanDirectory(f.env, f.at("app"));
  const other = await scanDirectory(f.env, f.at("other"));

  assert.equal(app.agentsMdMode, "claude-md");
  assert.deepEqual(
    [...app.instructions, ...other.instructions].map((i) => [f.rel(i.path), i.status, i.reason]),
    [
      [
        "app/AGENTS.md",
        "skipped",
        "Skipped: the built-in plugin that reads AGENTS.md is off in user settings",
      ],
      [
        "other/AGENTS.md",
        "skipped",
        "Skipped: the built-in plugin that reads AGENTS.md is off in local settings",
      ],
    ]
  );
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

test("in a worktree inside the main checkout, the main checkout's project files are not read again", async () => {
  const f = makeFixture();
  f.write("repo/CLAUDE.md", "shared");
  f.write("repo/.claude/rules/style.md", "style");
  f.write("repo/.gitignore", "CLAUDE.local.md\n.claude/worktrees/\n");
  f.git("repo", "init", "-q");
  f.git("repo", "add", ".");
  f.git("repo", "commit", "-qm", "init");
  f.write("repo/CLAUDE.local.md", "mine");
  f.git("repo", "worktree", "add", "-q", f.at("repo/.claude/worktrees/feat"));

  const view = await scanDirectory(f.env, f.at("repo/.claude/worktrees/feat"));

  assert.deepEqual(loadedPaths(view, f.root), [
    "repo/CLAUDE.local.md",
    "repo/.claude/worktrees/feat/CLAUDE.md",
    "repo/.claude/worktrees/feat/.claude/rules/style.md",
  ]);
  assert.deepEqual(
    view.instructions.filter((i) => i.status === "skipped").map((i) => f.rel(i.path)),
    ["repo/CLAUDE.md", "repo/.claude/rules/style.md"]
  );
});

test("claudeMdExcludes globs match files in .claude folders", async () => {
  const f = makeFixture();
  f.write("mono/team/CLAUDE.md", "team");
  f.write("mono/team/.claude/CLAUDE.md", "team settings");
  f.write("mono/team/.claude/rules/a.md", "rule");
  f.json("home/.claude/settings.json", { claudeMdExcludes: [`${f.at("mono/team")}/**`] });

  const team = await scanDirectory(f.env, f.at("mono/team"));

  assert.deepEqual(loadedPaths(team, f.root), []);
});

test("a claudeMdExcludes glob written through a linked folder matches the files it leads to", {
  // Claude Code adds the linked form only for a glob that starts with /, never for C:/... ones.
  skip: process.platform === "win32",
}, async () => {
  const f = makeFixture();
  f.write("mono/other/CLAUDE.md", "other");
  f.write("mono/other/.claude/rules/b.md", "rule");
  f.link("monolink", f.at("mono"));
  f.json("home/.claude/settings.json", { claudeMdExcludes: [`${f.at("monolink/other")}/**`] });

  const other = await scanDirectory(f.env, f.at("mono/other"));

  assert.deepEqual(loadedPaths(other, f.root), []);
});

test("rules in the managed folder load after the managed CLAUDE.md and cannot be excluded", async () => {
  const f = makeFixture();
  f.write("etc/claude-code/CLAUDE.md", "policy");
  f.write("etc/claude-code/.claude/rules/security.md", "never commit secrets");
  f.write("etc/claude-code/.claude/rules/infra.md", '---\npaths: "infra/**"\n---\ninfra rules');
  f.write("home/.claude/CLAUDE.md", "mine");
  f.json("home/.claude/settings.json", { claudeMdExcludes: ["**/rules/**"] });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.instructions.map((i) => [f.rel(i.path), i.scope, i.status]),
    [
      ["etc/claude-code/CLAUDE.md", "managed", "loaded"],
      ["etc/claude-code/.claude/rules/infra.md", "managed", "on-match"],
      ["etc/claude-code/.claude/rules/security.md", "managed", "loaded"],
      ["home/.claude/CLAUDE.md", "user", "loaded"],
    ]
  );
});

test("a file reached under two names, such as .claude/CLAUDE.md linked to CLAUDE.md, loads once", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "shared");
  f.link("app/.claude/CLAUDE.md", "../CLAUDE.md");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(loadedPaths(view, f.root), ["app/CLAUDE.md"]);
  assert.equal(view.context.filter((b) => b.kind === "instruction").length, 1);
});

test("a managed CLAUDE.md over 4 MiB does not load either; the claudeMd setting has no such limit", async () => {
  const f = makeFixture();
  const limit = 4 * 1024 * 1024;
  f.write("etc/claude-code/CLAUDE.md", "x".repeat(limit + 1));
  f.json("etc/claude-code/managed-settings.json", { claudeMd: "Use the approved registry." });
  f.write("app/README.md", "x");

  const view = await scanDirectory(f.env, f.at("app"));

  assert.deepEqual(
    view.instructions.map((i) => [f.rel(i.path), i.status]),
    [
      ["etc/claude-code/CLAUDE.md", "skipped"],
      ["etc/claude-code/managed-settings.json#claudeMd", "loaded"],
    ]
  );
  assert.deepEqual(
    view.context.filter((b) => b.kind === "instruction").map((b) => f.rel(b.path)),
    ["etc/claude-code/managed-settings.json#claudeMd"]
  );
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

test("a rule whose paths all match everything, such as **, loads every session", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/all.md", '---\npaths: "**"\n---\neverywhere');
  f.write("app/.claude/rules/both.md", '---\npaths: ["**", "**/**"]\n---\neverywhere too');
  f.write("app/.claude/rules/src.md", '---\npaths: ["src/**", "**"]\n---\nsource');

  const view = await scanDirectory(f.env, f.at("app"));
  const rules = view.instructions.filter((i) => i.kind === "rule");

  assert.deepEqual(
    rules.map((r) => [f.rel(r.path), r.status]),
    [
      ["app/.claude/rules/all.md", "loaded"],
      ["app/.claude/rules/both.md", "loaded"],
      ["app/.claude/rules/src.md", "on-match"],
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
