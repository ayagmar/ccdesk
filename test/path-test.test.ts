import assert from "node:assert/strict";
import { test } from "node:test";
import { testPath } from "../src/server/scan/path-test.ts";
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

test("a file outside the start directory gets nothing from it", async () => {
  const f = makeFixture();
  f.write("app/.claude/rules/all.md", '---\npaths: ["**/*"]\n---\nx\n');

  const result = await testPath(f.env, f.at("app"), f.at("elsewhere/x.ts"));

  assert.equal(result.inside, false);
  assert.deepEqual(result.matches, []);
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

test("a subfolder's skills load on demand only when Claude may invoke them itself", async () => {
  const f = makeFixture();
  f.json("app/.claude/settings.json", { skillOverrides: { deploy: "off" } });
  f.write("app/src/.claude/skills/deploy/SKILL.md", "---\nname: deploy\ndescription: d\n---\n");
  f.write(
    "app/src/.claude/skills/release/SKILL.md",
    "---\nname: release\ndescription: r\ndisable-model-invocation: true\n---\n"
  );
  f.write("app/src/.claude/skills/lint/SKILL.md", "---\nname: lint\ndescription: l\n---\n");

  const result = await testPath(f.env, f.at("app"), "src/a.ts");

  assert.deepEqual(
    result.matches.filter((m) => m.kind === "skill").map((m) => m.name),
    ["lint"]
  );
});
