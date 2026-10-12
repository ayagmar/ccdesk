import assert from "node:assert/strict";
import { test } from "node:test";
import { scanDirectory } from "../src/core/index.ts";
import { makeFixture } from "./helpers/fixture.ts";

test("a front end scans a directory through the core entry point", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "# App rules\n");
  f.json("app/.claude/settings.json", { model: "opus" });
  const view = await scanDirectory(f.env, f.at("app"));
  assert.deepEqual(
    view.instructions.map((i) => f.rel(i.path)),
    ["app/CLAUDE.md"]
  );
  assert.equal(view.effective.find((s) => s.key === "model")?.value, "opus");
});
