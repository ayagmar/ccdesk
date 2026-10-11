import assert from "node:assert/strict";
import { test } from "node:test";
import { diffLines, withContext } from "../src/ui/diff.ts";

const file = (value: string) =>
  `${JSON.stringify(
    Object.fromEntries("abcdefghijklmnop".split("").map((k) => [k, k === "h" ? value : k])),
    null,
    2
  )}\n`;

test("reviewing a one-key change shows that change, nearby lines, and folds the rest", () => {
  const rows = withContext(diffLines(file("old"), file("new")));

  assert.deepEqual(
    rows
      .filter((r) => r.kind === "add" || r.kind === "remove")
      .map((r) => [r.kind, "text" in r ? r.text : ""]),
    [
      ["remove", '  "h": "old",'],
      ["add", '  "h": "new",'],
    ]
  );
  assert.equal(rows.filter((r) => r.kind === "same").length, 6, "three lines of context each side");
  assert.deepEqual(
    rows.filter((r) => r.kind === "skip").map((r) => ("count" in r ? r.count : 0)),
    [5, 6]
  );
});

test("a new file shows every line as added", () => {
  const rows = diffLines("", '{\n  "model": "opus"\n}\n');
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["add", "add", "add"]
  );
});

test("a large file with one changed line is reviewed quickly and shows only that change", () => {
  const big = Array.from({ length: 50_000 }, (_, i) => `line ${i}`);
  const changed = big.map((l, i) => (i === 25_000 ? "edited" : l));

  const started = performance.now();
  const rows = diffLines(`${big.join("\n")}\n`, `${changed.join("\n")}\n`);

  assert.ok(performance.now() - started < 1000);
  assert.deepEqual(
    rows.filter((r) => r.kind !== "same"),
    [
      { kind: "remove", text: "line 25000" },
      { kind: "add", text: "edited" },
    ]
  );
});

test("two unrelated large files are shown as replaced instead of hanging the page", () => {
  const a = Array.from({ length: 5000 }, (_, i) => `a ${i}`).join("\n");
  const b = Array.from({ length: 5000 }, (_, i) => `b ${i}`).join("\n");

  const rows = diffLines(a, b);

  assert.equal(rows.length, 10_000);
  assert.equal(rows[0]?.kind, "remove");
  assert.equal(rows.at(-1)?.kind, "add");
});
