import assert from "node:assert/strict";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { test } from "node:test";
import { createCore } from "../src/core/index.ts";
import { makeFixture } from "./helpers/fixture.ts";

// A review is saved only to the file it showed. Saving works the change out again, so each case
// below moves or reroutes the target between the review and the save, or reaches the user's own
// files through a link, where a Project change would change every project.

const STALE = /review it again|changed since you reviewed/;

test("a Project settings edit through a link to the home folder is refused before ~/.claude exists", async () => {
  const f = makeFixture();
  rmSync(f.env.claudeDir, { recursive: true });
  f.link("home-alias", f.env.home);
  const core = createCore(f.env);

  await assert.rejects(
    core.previewSettingsEdit({
      dir: f.at("home-alias"),
      scope: "project",
      key: "effortLevel",
      value: "high",
    }),
    /edit it as User/
  );
  assert.equal(existsSync(f.env.claudeDir), false);
});

test("a Project settings file that links to the user settings is not edited as Project", async () => {
  // As dotfile managers lay it out: ~/.claude/settings.json links into a dotfiles checkout.
  const f = makeFixture();
  const shared = f.json("dotfiles/claude/.claude/settings.json", { model: "opus" });
  f.link("home/.claude/settings.json", shared);
  const core = createCore(f.env);

  await assert.rejects(
    core.previewSettingsEdit({
      dir: f.at("dotfiles/claude"),
      scope: "project",
      key: "effortLevel",
      value: "high",
    }),
    /leads to your user settings; edit it as User/
  );
});

test("a Project agent is not created in the user agents folder through a link to the home folder", async () => {
  const f = makeFixture();
  f.link("home-alias", f.env.home);
  const core = createCore(f.env);

  await assert.rejects(
    core.previewAgentEdit({
      dir: f.at("home-alias"),
      create: { scope: "project", file: "rev" },
      text: "---\nname: rev\ndescription: Reviews.\n---\nReview.\n",
    }),
    /create it as User/
  );
});

test("a new Project agent is not saved after its folder moved to a new repository's root", async () => {
  const f = makeFixture();
  f.write("work/pkg/README.md", "x");
  const core = createCore(f.env);
  const edit = {
    dir: f.at("work/pkg"),
    create: { scope: "project" as const, file: "rev" },
    text: "---\nname: rev\ndescription: Reviews.\n---\nReview.\n",
  };
  const { path, revision } = await core.previewAgentEdit(edit);
  assert.equal(path, f.at("work/pkg/.claude/agents/rev.md"));

  f.git("work", "init", "-q");
  await assert.rejects(core.saveAgentEdit(edit, revision), STALE);
  assert.equal(existsSync(f.at("work/.claude/agents/rev.md")), false);
});

test("a new project MCP server is not saved after the folder's link was pointed elsewhere", async () => {
  const f = makeFixture();
  f.write("first/README.md", "x");
  f.write("second/README.md", "x");
  f.link("app", f.at("first"));
  const core = createCore(f.env);
  const edit = {
    dir: f.at("app"),
    scope: "project" as const,
    add: { name: "db", definition: { command: "db-mcp" } },
  };
  const { revision } = await core.previewMcpEdit(edit);

  unlinkSync(f.at("app"));
  f.link("app", f.at("second"));
  await assert.rejects(core.saveMcpEdit(edit, revision), STALE);
  assert.equal(existsSync(f.at("second/.mcp.json")), false);
});

test("a new local MCP server is not added after its folder moved to a new repository's root", async () => {
  const f = makeFixture();
  f.write("work/pkg/README.md", "x");
  const ran: string[][] = [];
  const core = createCore(f.env, {
    runClaude: async (args) => {
      ran.push(args);
      return "";
    },
  });
  const edit = {
    dir: f.at("work/pkg"),
    scope: "local" as const,
    add: { name: "db", definition: { command: "db-mcp" } },
  };
  const { revision } = await core.previewMcpEdit(edit);

  f.git("work", "init", "-q");
  await assert.rejects(core.saveMcpEdit(edit, revision), STALE);
  assert.deepEqual(ran, []);
});
