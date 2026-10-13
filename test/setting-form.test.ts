import assert from "node:assert/strict";
import { test } from "node:test";
import { type SettingSchema } from "../src/shared/types.ts";
import {
  type DraftObject,
  editKind,
  expects,
  fieldKind,
  fromDraft,
  toDraft,
} from "../src/view/index.ts";

const lines: SettingSchema = { type: "array", items: { type: "string" } };

/** Shaped like autoMode: lists of rules and a flag, no other properties. */
const rules: SettingSchema = {
  type: "object",
  additionalProperties: false,
  properties: { allow: lines, soft_deny: lines, classifyAllShell: { type: "boolean" } },
};

/** Shaped like statusLine: a required command whose type has one allowed value. */
const command: SettingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "command"],
  properties: {
    type: { type: "string", const: "command" },
    command: { type: "string" },
    padding: { type: "number" },
  },
};

const providers: SettingSchema = {
  type: "array",
  items: { type: "string", enum: ["anthropic", "bedrock", "vertex"] },
};

/** Saves a draft the way the editor does, failing the test on an error. */
function save(schema: SettingSchema, draft: ReturnType<typeof toDraft>): unknown {
  const parsed = fromDraft(fieldKind(schema), schema, draft);
  assert.ok("value" in parsed, "error" in parsed ? parsed.error : "");
  return parsed.value;
}

test("a setting that may be null is edited as text, not JSON", () => {
  assert.equal(fieldKind({ type: ["string", "null"] }), "string");
});

test("a list of listed values is picked from, in the order you pick them", () => {
  assert.equal(editKind(providers, ["vertex", "anthropic"]), "choices");
  assert.deepEqual(save(providers, ["vertex", "anthropic", "bedrock"]), [
    "vertex",
    "anthropic",
    "bedrock",
  ]);
});

test("an object is edited as a form that writes back only what you set, in the file's order", () => {
  const file = { soft_deny: ["rm -rf"], allow: ["$defaults"] };
  assert.equal(editKind(rules, file), "object");

  const draft = toDraft("object", rules, file) as DraftObject;
  const value = save(rules, { ...draft, allow: "$defaults\nnpm test" });

  assert.equal(
    JSON.stringify(value),
    JSON.stringify({ soft_deny: ["rm -rf"], allow: ["$defaults", "npm test"] })
  );
});

test("a flag left unset in an object form is not written, and one set false is", () => {
  const draft = toDraft("object", rules, undefined) as DraftObject;
  assert.deepEqual(save(rules, draft), {});
  assert.deepEqual(save(rules, { ...draft, classifyAllShell: "false" }), {
    classifyAllShell: false,
  });
});

test("a new object starts with the one value a required property allows", () => {
  const draft = toDraft("object", command, undefined) as DraftObject;
  assert.deepEqual(save(command, { ...draft, command: "~/status.sh" }), {
    type: "command",
    command: "~/status.sh",
  });
});

test("a property that is not a number is refused by name", () => {
  const draft = toDraft("object", command, undefined) as DraftObject;
  assert.deepEqual(fromDraft("object", command, { ...draft, padding: "wide" }), {
    error: "padding: Enter a number.",
  });
});

test("a value a form cannot hold exactly is edited as JSON, so saving loses nothing", () => {
  // A property the schema does not name.
  assert.equal(editKind(rules, { allow: [], deny: ["x"] }), "json");
  // A property of the wrong type.
  assert.equal(editKind(command, { type: "command", command: "x", padding: "2" }), "json");
  // A value the schema does not list.
  assert.equal(editKind({ type: "string", enum: ["dark", "light"] }, "solarized"), "json");
  assert.equal(editKind(providers, ["anthropic", "azure"]), "json");
  // null where the form would write text.
  assert.equal(editKind({ type: ["string", "null"] }, null), "json");
  // A list entry a line per entry would change.
  assert.equal(editKind(lines, ["two\nlines"]), "json");
});

test("an object with a property that needs JSON is edited as JSON as a whole", () => {
  const helper: SettingSchema = {
    type: "object",
    properties: {
      path: { type: "string" },
      refreshIntervalMs: { anyOf: [{ type: "number", const: 0 }, { type: "number" }] },
    },
  };
  assert.equal(fieldKind(helper), "json");
});

test("bare text where text is allowed is refused with how to quote it", () => {
  const orgs: SettingSchema = { anyOf: [{ type: "string" }, lines] };
  const parsed = fromDraft("json", orgs, "my-org");
  assert.ok("error" in parsed);
  assert.match(parsed.error, /^Not valid JSON: .+\. Text goes in double quotes: "my-org"$/);

  const flags = fromDraft("json", { type: "object" }, "my-org");
  assert.ok("error" in flags);
  assert.doesNotMatch(flags.error, /double quotes/);
});

test("a JSON field says what shape the value takes", () => {
  assert.equal(
    expects({
      anyOf: [
        { type: "boolean" },
        { type: "object", properties: { commit: {}, pr: {}, sessionUrl: {} } },
      ],
    }),
    "true or false, or an object with commit, pr and sessionUrl"
  );
  assert.equal(
    expects({ type: "object", additionalProperties: { type: "string" } }),
    "an object mapping each name to a string"
  );
  assert.equal(
    expects({ type: "array", items: { type: "string", enum: ["skills", "agents"] } }),
    'a list, each one of "skills", "agents"'
  );
});
