import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { REFERENCE, scanDirectory } from "../src/core/index.ts";
import { buildRows, formatter, routeStops, SECTIONS, type ViewContext } from "../src/view/index.ts";
import { typedPath } from "../src/view/format.ts";
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
      const label = section.label(row, context);
      assert.ok(label.kind && label.name, `${row.id} has a label`);
      assert.ok(section.heading(row, context, view), `${row.id} has a heading`);
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
      .map((r) => instructions?.label(r, context).name);
  };

  // The path keeps the platform's separators after the ~.
  const mine = join("~", ".claude", "CLAUDE.md");
  assert.deepEqual(labels(f.env.home), [mine]);
  // A second formatter does not change what the first shows.
  assert.deepEqual(labels(""), [f.at("home/.claude/CLAUDE.md")]);
  assert.deepEqual(labels(f.env.home), [mine]);
});

test("the route strip flags a scope whose settings file cannot be read instead of calling it unused", async () => {
  const f = makeFixture();
  f.write("app/CLAUDE.md", "# App rules\n");
  f.write("app/.claude/settings.local.json", '{ "model": "opus", permissions: { allow: [ }\n');
  const view = await scanDirectory(f.env, f.at("app"));

  const stops = routeStops(view);
  const local = stops.find((s) => s.line === "local");
  assert.equal(local?.unreadable, 1);
  assert.equal(local?.active, true);
  // A scope with nothing in it stays an idle stop.
  const managed = stops.find((s) => s.line === "managed");
  assert.deepEqual([managed?.unreadable, managed?.active], [0, false]);
});

test("a folder typed with a trailing separator names the same folder, and a root stays a root", () => {
  const cases: [string, string | null][] = [
    ["~/", "/home/me"],
    ["~/code/acme-api/", "/home/me/code/acme-api"],
    ["/a/b//", "/a/b"],
    ["/", "/"],
    ["C:\\", "C:\\"],
    ["C:/x/", "C:/x"],
    ["C:\\code\\acme\\", "C:\\code\\acme"],
    ["acme-api/", null],
  ];
  for (const [typed, path] of cases) assert.equal(typedPath(typed, "/home/me"), path, typed);
});

test("the settings filter counts each key under the file that decides its value", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", {
    model: "sonnet",
    theme: "light",
    permissions: { allow: ["Read"] },
  });
  // Claude Code reads allowManagedHooksOnly only from managed settings, and a project's env waits
  // for the trust dialog.
  f.json("app/.claude/settings.json", {
    model: "opus",
    permissions: { allow: ["Bash(npm test)"] },
    allowManagedHooksOnly: true,
    env: { FAKE_FLAG: "1" },
  });
  f.json("app/.claude/settings.local.json", { verbose: true });
  const view = await scanDirectory(f.env, f.at("app"));
  const context: ViewContext = { format: formatter(f.env.home), reference: REFERENCE };
  const settings = SECTIONS.find((s) => s.id === "settings");

  const counts: Record<string, number> = {};
  for (const row of buildRows(view, context).filter((r) => r.section === "settings")) {
    const scope = settings?.facet?.of(row) ?? "";
    counts[scope] = (counts[scope] ?? 0) + 1;
  }

  // The project's model beats the user's, and merged permissions count under the higher file.
  assert.deepEqual(counts, { User: 1, Project: 2, Local: 1, Ignored: 1, "Waits for trust": 1 });
});

test("a setting is marked as Claude Code's default only when its value is the one default the docs give", async () => {
  const f = makeFixture();
  f.json("home/.claude/settings.json", {
    verbose: false,
    cleanupPeriodDays: 30,
    disableClaudeAiConnectors: false,
    autoCompactEnabled: false,
    model: "opus",
    defaultShell: "bash",
    respectGitignore: false,
    spinnerTipsEnabled: true,
  });
  // The project pins respectGitignore to its default over the user's false, so removing it changes something.
  f.json("app/.claude/settings.json", { respectGitignore: true, spinnerTipsEnabled: true });
  const view = await scanDirectory(f.env, f.at("app"));
  const context: ViewContext = { format: formatter(f.env.home), reference: REFERENCE };

  const atDefault = buildRows(view, context)
    .flatMap((r) => (r.section === "settings" && r.atDefault !== undefined ? [r.item.key] : []))
    .sort();

  // autoCompactEnabled defaults to true; model's default is told in words; defaultShell's depends
  // on the platform.
  assert.deepEqual(atDefault, [
    "cleanupPeriodDays",
    "disableClaudeAiConnectors",
    "spinnerTipsEnabled",
    "verbose",
  ]);
});
