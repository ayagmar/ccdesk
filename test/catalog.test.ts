import assert from "node:assert/strict";
import { test } from "node:test";
import { valuesIn } from "../src/view/index.ts";
import { plain } from "../src/view/sections/catalog.ts";

test("documented values come from an inline list, without placeholders", () => {
  assert.deepEqual(valuesIn('string, one of `"60s"`, `"5m"`, `"10m"`, or `"never"`'), [
    "60s",
    "5m",
    "10m",
    "never",
  ]);
  assert.deepEqual(valuesIn('string, `"dark"`, `"light"` or `"custom:<slug>"`'), ["dark", "light"]);
});

test("in a bulleted list, values quoted inside an explanation are not offered", () => {
  const type = [
    "string, one of:",
    '* `"prefix"`: a model ID entry permits any model ID that extends it',
    '* `"exact"`: so `"claude-opus-5"` permits Opus 5 only. A family alias such as `"opus"` still works',
  ].join("\n");
  assert.deepEqual(valuesIn(type), ["prefix", "exact"]);
});

test("a type that is not a list of strings offers nothing", () => {
  assert.deepEqual(valuesIn("Boolean"), []);
});

test("examples and remarks are not offered as values, and no value is offered twice", () => {
  assert.deepEqual(valuesIn('string, such as `"japanese"` or `"spanish"`'), []);
  assert.deepEqual(
    valuesIn(
      'string, one of the aliases `"opus"` or `"sonnet"`, or a full model ID such as `"claude-opus-5-5"`'
    ),
    ["opus", "sonnet"]
  );
  assert.deepEqual(valuesIn('string, `"disabled"`; the desktop app also accepts `"disable"`'), [
    "disabled",
  ]);
  assert.deepEqual(valuesIn('string, one of `"high"`, `"max"`, or `"max"`'), ["high", "max"]);
});

test("docs text made plain keeps what is inside code spans, asterisks included", () => {
  // Catches emphasis stripping that also eats wildcards, turning `*.example.com` into a pattern
  // that matches nothing an admin meant.
  assert.equal(
    plain("`*` matches any host, `*.example.com` matches **every** subdomain"),
    "* matches any host, *.example.com matches every subdomain"
  );
  assert.equal(plain("see [`managed-mcp.json`](https://example.com/a)"), "see managed-mcp.json");
});
