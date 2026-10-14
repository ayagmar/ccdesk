import assert from "node:assert/strict";
import { basename, dirname } from "node:path";
import { test } from "node:test";
import { scanDirectory, testPath } from "../src/core/index.ts";
import { makeFixture } from "./helpers/fixture.ts";

test("touching a file brings in matching path rules, skills and the CLAUDE.md files of the folders on the way", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/api.md", '---\npaths: ["src/api/**/*.ts"]\n---\nValidate input.\n');
  f.write("app/.claude/rules/css.md", '---\npaths: ["**/*.css"]\n---\nNo !important.\n');
  f.write("app/src/CLAUDE.md", "Source rules.\n");
  f.write("app/src/api/CLAUDE.local.md", "My API notes.\n");
  f.write("app/docs/CLAUDE.md", "Not on the way.\n");
  f.write(
    "app/.claude/skills/migrate/SKILL.md",
    "---\nname: migrate\ndescription: DB migrations\npaths: src/api/**, db/**\n---\n"
  );

  const result = await testPath(f.env, f.at("app"), "src/api/users.ts");

  assert.equal(result.inside, true);
  assert.deepEqual(
    result.matches.map((m) => [m.kind, f.rel(m.path), m.glob ?? null]),
    [
      ["rule", "app/.claude/rules/api.md", "src/api/**/*.ts"],
      ["nested", "app/src/CLAUDE.md", null],
      ["nested", "app/src/api/CLAUDE.local.md", null],
      ["skill", "app/.claude/skills/migrate/SKILL.md", "src/api/**"],
    ]
  );
});

test("a subfolder's instruction file or rule over 4 MiB does not load, one at the limit does", async () => {
  const f = makeFixture();
  const limit = 4 * 1024 * 1024;
  f.write("app/src/CLAUDE.md", "x".repeat(limit + 1));
  // The CLAUDE.md is still there, so AGENTS.md does not load in its place.
  f.write("app/src/AGENTS.md", "Agent rules.\n");
  f.write("app/src/.claude/rules/big.md", "x".repeat(limit + 1));
  f.write("app/src/api/CLAUDE.md", "x".repeat(limit));

  const result = await testPath(f.env, f.at("app"), "src/api/users.ts");

  assert.deepEqual(
    result.matches.map((m) => [m.kind, f.rel(m.path)]),
    [["nested", "app/src/api/CLAUDE.md"]]
  );
});

test("a nested skill whose folder name another skill has is named with its directory", async () => {
  const f = makeFixture();
  const skill = (name: string) => `---\nname: ${name}\ndescription: Deploy ${name}\n---\n`;
  f.write("repo/.claude/skills/deploy/SKILL.md", skill("deploy"));
  f.write("repo/apps/web/.claude/skills/deploy/SKILL.md", skill("deploy"));
  f.write("repo/apps/web/.claude/skills/lint/SKILL.md", skill("lint"));
  f.git("repo", "init", "-q");

  const result = await testPath(f.env, f.at("repo"), "apps/web/index.ts");

  assert.deepEqual(
    result.matches.filter((m) => m.kind === "skill").map((m) => m.name),
    ["apps/web:deploy", "lint"]
  );
});

test("a subfolder's rule whose paths is ** loads for any file there, as one without paths", async () => {
  const f = makeFixture();
  f.write("app/sub/.claude/rules/all.md", '---\npaths: "**"\n---\neverywhere');

  const result = await testPath(f.env, f.at("app"), "sub/a.ts");

  assert.deepEqual(
    result.matches.map((m) => [m.kind, f.rel(m.path), m.glob ?? null]),
    [["nested", "app/sub/.claude/rules/all.md", null]]
  );
});

test("paths split at commas outside braces, in a string and in each list item", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/web.md", '---\npaths: "src/**/*.{ts,tsx}, docs/**"\n---\nweb');
  f.write("app/.claude/rules/list.md", '---\npaths: ["lib/a.ts, src/**/*.tsx"]\n---\nlist');

  const result = await testPath(f.env, f.at("app"), "src/x.tsx");

  assert.deepEqual(
    result.matches.map((m) => [f.rel(m.path), m.glob ?? null]),
    [
      ["app/.claude/rules/list.md", "src/**/*.tsx"],
      ["app/.claude/rules/web.md", "src/**/*.{ts,tsx}"],
    ]
  );
});

test("rule and skill paths match as Claude Code matches them: by gitignore rules, in any case, dot folders included", async () => {
  // Claude Code 2.1.296 matches paths with the ignore package, after cutting a trailing /**; the
  // docs' table says *.md is the project root only (docs: memory#path-specific-rules).
  const f = makeFixture();
  const rule = (name: string, glob: string) =>
    f.write(`app/.claude/rules/${name}.md`, `---\npaths: "${glob}"\n---\n${name}`);
  rule("markdown", "*.md");
  rule("source", "src/**");
  rule("types", "**/*.ts");
  rule("upper", "*.TXT");
  f.write(
    "app/.claude/skills/docs/SKILL.md",
    '---\nname: docs\ndescription: d\npaths: "*.md"\n---\n'
  );
  const matched = async (file: string) =>
    (await testPath(f.env, f.at("app"), file)).matches
      .map((m) => (basename(dirname(m.path)) === "docs" ? "docs skill" : basename(m.path)))
      .sort();

  assert.deepEqual(await matched("guide/intro.md"), ["docs skill", "markdown.md"]);
  assert.deepEqual(await matched("packages/x/src/a.go"), ["source.md"]);
  assert.deepEqual(await matched(".github/x.ts"), ["types.md"]);
  assert.deepEqual(await matched("notes/a.txt"), ["upper.md"]);
});

test("user and managed rules and skills with paths are matched from the start directory, project rules from their folder", async () => {
  const f = makeFixture();
  const paths = '---\npaths: "src/**/*.ts"\n---\n';
  f.write("home/.claude/rules/user.md", `${paths}user`);
  f.write("etc/claude-code/.claude/rules/managed.md", `${paths}managed`);
  f.write(
    "home/.claude/skills/types/SKILL.md",
    `---\nname: types\ndescription: t\npaths: "src/**/*.ts"\n---\n`
  );
  f.write("repo/.claude/rules/root.md", `${paths}root`);
  f.write("repo/pkg/README.md", "x");
  f.git("repo", "init", "-q");

  const result = await testPath(f.env, f.at("repo/pkg"), "src/a.ts");

  assert.deepEqual(result.matches.map((m) => f.rel(m.path)).sort(), [
    "etc/claude-code/.claude/rules/managed.md",
    "home/.claude/rules/user.md",
    "home/.claude/skills/types/SKILL.md",
  ]);
});

test("a pattern too large to use matches nothing, and the rule's other patterns still match", async () => {
  const f = makeFixture();
  f.write(
    "app/.claude/rules/types.md",
    `---\npaths: ["${"a".repeat(200_000)}", "*.ts"]\n---\ntypes`
  );

  const result = await testPath(f.env, f.at("app"), "a.ts");

  assert.deepEqual(
    result.matches.map((m) => [f.rel(m.path), m.glob]),
    [["app/.claude/rules/types.md", "*.ts"]]
  );
});

test("a file outside the start directory gets nothing from it", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/all.md", '---\npaths: ["**/*"]\n---\nx\n');

  const result = await testPath(f.env, f.at("app"), f.at("elsewhere/x.ts"));

  assert.equal(result.inside, false);
  assert.deepEqual(result.matches, []);
});

test("a folder whose name starts with two dots is inside the start directory", async () => {
  const f = makeFixture();
  f.write("app/README.md", "x");

  assert.equal((await testPath(f.env, f.at("app"), "..cache/x.ts")).inside, true);
  assert.equal((await testPath(f.env, f.at("app"), "../x.ts")).inside, false);
});

test("a subfolder's rules linked from outside the project load as they would at startup", async () => {
  const f = makeFixture();
  f.write("shared-rules/style.md", "Early returns.\n");
  f.write("shared-rules/api.md", '---\npaths: ["**/*.ts"]\n---\nValidate.\n');
  f.link("app/sub/.claude/rules/shared", f.at("shared-rules"));
  const loaded = async () =>
    (await testPath(f.env, f.at("app"), "sub/x.ts")).matches.map((m) => basename(m.path));

  assert.deepEqual(await loaded(), []);
  f.json("home/.claude.json", {
    projects: { [f.at("app")]: { hasClaudeMdExternalIncludesApproved: true } },
  });
  // Once approved, only the linked rules without a paths field load.
  assert.deepEqual(await loaded(), ["style.md"]);
});

test("a rule in a folder linked within the project is not excluded by its target's path, as at startup", async () => {
  const f = makeFixture();
  f.write("app/rules-src/api.md", '---\npaths: ["**/*.ts"]\n---\nValidate.\n');
  f.link("app/.claude/rules", f.at("app/rules-src"));
  f.link("app/sub/.claude/rules", f.at("app/rules-src"));
  f.json("app/.claude/settings.local.json", { claudeMdExcludes: ["**/rules-src/**"] });

  const startup = (await scanDirectory(f.env, f.at("app"))).instructions.find(
    (i) => i.path === f.at("app/.claude/rules/api.md")
  );
  assert.equal(startup?.status, "on-match");

  const result = await testPath(f.env, f.at("app"), "sub/x.ts");
  assert.ok(result.matches.some((m) => m.path === f.at("app/sub/.claude/rules/api.md")));
});

test("an excluded rule and a skill Claude cannot invoke itself do not load for matching files", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/legacy.md", '---\npaths: ["**/*.ts"]\n---\nOld rule.\n');
  f.json("app/.claude/settings.local.json", { claudeMdExcludes: ["**/.claude/rules/legacy.md"] });
  f.write(
    "app/.claude/skills/release/SKILL.md",
    "---\nname: release\ndescription: Ship\npaths: src/**\ndisable-model-invocation: true\n---\n"
  );

  const result = await testPath(f.env, f.at("app"), "src/x.ts");

  assert.deepEqual(result.matches, []);
});

test("with only managed instruction files at launch, path rules and subfolder files still load on demand", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", {
    pluginConfigs: {
      "cc-plugin-agents-md@builtin": { options: { instructionFiles: "managed-only" } },
    },
  });
  f.write("app/CLAUDE.md", "Root.\n");
  f.write("app/.claude/rules/src.md", '---\npaths: ["src/**"]\n---\nSource rule.\n');
  f.write("app/src/CLAUDE.md", "Source notes.\n");

  const result = await testPath(f.env, f.at("app"), "src/a.ts");

  assert.deepEqual(
    result.matches.map((m) => [m.kind, f.rel(m.path)]),
    [
      ["rule", "app/.claude/rules/src.md"],
      ["nested", "app/src/CLAUDE.md"],
    ]
  );
});

test("a subfolder's skills load on demand, whatever their paths, only when Claude may invoke them itself", async () => {
  const f = makeFixture();
  f.json("app/.claude/settings.json", { skillOverrides: { deploy: "off" } });
  f.write("app/src/.claude/skills/deploy/SKILL.md", "---\nname: deploy\ndescription: d\n---\n");
  f.write(
    "app/src/.claude/skills/release/SKILL.md",
    "---\nname: release\ndescription: r\ndisable-model-invocation: true\n---\n"
  );
  f.write("app/src/.claude/skills/lint/SKILL.md", "---\nname: lint\ndescription: l\n---\n");
  f.write(
    "app/src/.claude/skills/css/SKILL.md",
    '---\nname: css\ndescription: c\npaths: "**/*.css"\n---\n'
  );
  // Reserved names do not load here either (docs: skills#where-skills-live).
  f.write("app/src/.claude/skills/SYNCED/SKILL.md", "---\nname: s\ndescription: s\n---\n");
  f.write(
    "app/src/.claude/skills/pdf/SKILL.md",
    "---\nname: anthropic-skills:pdf\ndescription: p\n---\n"
  );

  const skills = async (file: string) =>
    (await testPath(f.env, f.at("app"), file)).matches
      .filter((m) => m.kind === "skill")
      .map((m) => m.name)
      .sort();

  // Claude Code 2.1.296 ignores paths for a skill found on demand: it loads with its folder.
  assert.deepEqual(await skills("src/a.ts"), ["css", "lint"]);
});

test("a subfolder's AGENTS.md and linked rules load on demand exactly as they load when Claude starts there", async () => {
  const modes = ["claude-md-or-agents-md", "claude-md-and-agents-md", "claude-md"];
  for (const mode of modes)
    for (const withClaudeMd of [false, true])
      for (const approved of [false, true]) {
        const f = makeFixture();
        f.json("home/.claude/settings.json", {
          pluginConfigs: { "agents-md@builtin": { options: { instructionFiles: mode } } },
        });
        f.write("shared-rules/style.md", "Early returns.\n");
        f.write("shared-rules/api.md", '---\npaths: ["**/*.ts"]\n---\nValidate.\n');
        f.link("app/sub/.claude/rules/shared", f.at("shared-rules"));
        f.write("app/sub/AGENTS.md", "Agents.\n");
        f.write("app/sub/.claude/AGENTS.md", "More agents.\n");
        if (withClaudeMd) f.write("app/sub/CLAUDE.md", "Claude.\n");
        if (approved)
          f.json("home/.claude.json", {
            projects: Object.fromEntries(
              ["app", "app/sub"].map((dir) => [
                f.at(dir),
                { hasClaudeMdExternalIncludesApproved: true },
              ])
            ),
          });

        const atStartup = (await scanDirectory(f.env, f.at("app/sub"))).instructions
          .filter((i) => i.dir === f.at("app/sub") && i.status !== "skipped")
          .map((i) => f.rel(i.path));
        const onDemand = (await testPath(f.env, f.at("app"), "sub/x.ts")).matches.map((m) =>
          f.rel(m.path)
        );

        assert.deepEqual(
          onDemand.sort(),
          atStartup.sort(),
          `${mode}, CLAUDE.md ${withClaudeMd}, approved ${approved}`
        );
      }
});

test("with skills kept to plugins by managed settings, no project skill loads for a matching file", async () => {
  const f = makeFixture();
  f.json("etc/claude-code/managed-settings.json", { strictPluginOnlyCustomization: ["skills"] });
  const skill = (name: string) => `---\nname: ${name}\ndescription: d\npaths: "**/*.ts"\n---\n`;
  f.write("app/.claude/skills/start/SKILL.md", skill("start"));
  f.write("app/src/.claude/skills/nested/SKILL.md", skill("nested"));

  const result = await testPath(f.env, f.at("app"), "src/api/users.ts");

  assert.deepEqual(
    result.matches.filter((m) => m.kind === "skill"),
    []
  );
});
