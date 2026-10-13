import assert from "node:assert/strict";
import { test } from "node:test";
import { BORROWED_NOTE, borrowMissingKeys } from "../scripts/schemastore.ts";

// SchemaStore is community maintained; the SDK's type comes from Claude Code itself.

test("SchemaStore fills only documented keys the SDK lacks, and never replaces the SDK's own", () => {
  const sdk = { model: { type: "string" } };
  const schemastore = {
    model: { type: "number" },
    autoMode: { type: "object" },
    retiredKey: { type: "boolean" },
  };

  const { properties, borrowed, uncovered } = borrowMissingKeys(sdk, schemastore, [
    "model",
    "autoMode",
    "copyOnSelect",
  ]);

  assert.deepEqual(properties, {
    model: { type: "string" },
    autoMode: { type: "object", $comment: BORROWED_NOTE },
  });
  assert.deepEqual(borrowed, ["autoMode"]);
  assert.deepEqual(uncovered, ["copyOnSelect"]);
});

test("a borrowed key that refers elsewhere in SchemaStore's schema stops the run", () => {
  const schemastore = { hooks: { type: "array", items: { $ref: "#/$defs/hookMatcher" } } };

  assert.throws(() => borrowMissingKeys({}, schemastore, ["hooks"]), /hooks uses \$ref/);
});
