import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { REFERENCE, scanDirectory } from "../src/core/index.ts";
import { buildRows, formatter, SECTIONS, type ViewContext } from "../src/view/index.ts";
import { type Fixture, makeFixture, memoryDirFor, memoryFile } from "./helpers/fixture.ts";

/** A project with something in every section of the directory page. */
async function fullView(f: Fixture) {
  f.write("app/CLAUDE.md", "# App rules\n");
  f.json("app/.claude/settings.json", {
    model: "opus",
    permissions: { allow: ["Bash(npm test)"] },
    hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
  });
  f.json("app/.mcp.json", { mcpServers: { docs: { command: "docs-server" } } });
  f.write(
    "home/.claude/agents/reviewer.md",
    "---\nname: reviewer\ndescription: Reviews changes\n---\n\nReview.\n"
  );
  const memory = memoryDirFor(f, f.at("app"));
  f.write(`${memory}/MEMORY.md`, "- [Style](style.md) — tabs\n");
  f.write(`${memory}/style.md`, memoryFile("style", "feedback", "tabs", "Use tabs."));
  return scanDirectory(f.env, f.at("app"));
}

test("every section of the page builds its rows from a scanned directory, without the page", async () => {
  const f = makeFixture();
  const view = await fullView(f);
  const context: ViewContext = { format: formatter(f.env.home), reference: REFERENCE };

  const rows = buildRows(view, context);

  for (const section of SECTIONS) {
    const own = rows.filter((r) => r.section === section.id);
    assert.ok(own.length > 0, `${section.id} has rows`);
    for (const row of own) {
      assert.ok(section.text(row), `${row.id} has filter text`);
      assert.ok(section.label(row, context), `${row.id} has a label`);
      assert.ok(section.heading(row, context), `${row.id} has a heading`);
    }
  }
  // The page selects a row by its id, so two rows sharing one would select each other.
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  // The catalog lists every documented setting and marks the one set here with its file's scope.
  const model = rows.find((r) => r.section === "catalog" && r.item.key === "model");
  assert.equal(model?.line, "project");
  assert.equal(rows.filter((r) => r.section === "catalog").length, REFERENCE.catalog.length);
});

test("paths in labels are shown from the home folder the caller gives", async () => {
  const f = makeFixture();
  f.write("home/.claude/CLAUDE.md", "# Mine\n");
  const view = await scanDirectory(f.env, f.at("home"));
  const instructions = SECTIONS.find((s) => s.id === "instructions");
  const labels = (home: string) => {
    const context: ViewContext = { format: formatter(home), reference: REFERENCE };
    return buildRows(view, context)
      .filter((r) => r.section === "instructions")
      .map((r) => instructions?.label(r, context));
  };

  // The path keeps the platform's separators after the ~.
  const mine = join("~", ".claude", "CLAUDE.md");
  assert.deepEqual(labels(f.env.home), [mine]);
  // A second formatter does not change what the first shows.
  assert.deepEqual(labels(""), [f.at("home/.claude/CLAUDE.md")]);
  assert.deepEqual(labels(f.env.home), [mine]);
});
