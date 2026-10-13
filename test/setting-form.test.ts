import assert from "node:assert/strict";
import { test } from "node:test";
import { type SettingSchema } from "../src/shared/types.ts";
import {
  asForm,
  asJson,
  type DraftObject,
  editKind,
  expects,
  type Form,
  firstSentence,
  fieldKind,
  followFile,
  formFor,
  fromDraft,
  replacesBuiltIns,
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
function save(
  schema: SettingSchema,
  draft: ReturnType<typeof toDraft>,
  kind = fieldKind(schema)
): unknown {
  const parsed = fromDraft(kind, schema, draft);
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
  assert.equal(editKind(rules, { allow: ["$defaults"] }), "object");
  assert.equal(editKind(rules, { allow: ["$defaults"], deny: ["x"] }), "json");
  // An empty list, which an empty field would leave out.
  assert.equal(editKind(rules, { soft_deny: [] }), "json");
  // Text with a line break, which a one-line field would join.
  assert.equal(editKind(command, { type: "command", command: "echo one\necho two" }), "json");
  assert.equal(editKind({ type: "string" }, "first\nsecond"), "json");
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

test("an unsaved edit is kept when the file changes, even when the file no longer fits the form", () => {
  const was = { allow: ["$defaults"] };
  const typed: Form = {
    kind: "object",
    draft: { ...(formFor(rules, was).draft as DraftObject), allow: "$defaults\nnpm test" },
  };

  const kept = followFile(typed, rules, was, { allow: ["$defaults"], deny: ["x"] });
  assert.equal(kept.conflict, true);
  assert.deepEqual(kept.form, typed);
});

test("picking another file keeps a typed value for it, without calling that a conflict", () => {
  const typed: Form = { kind: "string", draft: "opus" };
  const switched = followFile(typed, { type: "string" }, "sonnet", "haiku", true);
  assert.deepEqual(switched, { form: typed, conflict: false });
});

test("a form you have not edited follows the file, into JSON when the new value needs it", () => {
  const was = { allow: ["$defaults"] };
  const now = { allow: ["$defaults"], deny: ["x"] };
  const followed = followFile(formFor(rules, was), rules, was, now);
  assert.equal(followed.conflict, false);
  assert.deepEqual(followed.form, { kind: "json", draft: JSON.stringify(now, null, 2) });
});

test("an edit the file now matches, as after saving it, follows the file", () => {
  const now = { allow: ["$defaults", "npm test"] };
  const typed: Form = {
    kind: "object",
    draft: { ...(formFor(rules, undefined).draft as DraftObject), allow: "$defaults\nnpm test" },
  };
  assert.deepEqual(followFile(typed, rules, undefined, now).form, formFor(rules, now));
});

test("what the form cannot say, such as an empty list, is written through JSON", () => {
  const typed = formFor(rules, { allow: ["$defaults"] });
  const json = asJson(typed, rules);
  assert.ok(!("error" in json));
  assert.deepEqual(save(rules, json.draft, "json"), { allow: ["$defaults"] });

  const empty: Form = { kind: "json", draft: '{ "soft_deny": [] }' };
  assert.deepEqual(asForm(empty, rules), {
    error: "The form cannot hold this value exactly; edit it as JSON.",
  });
  assert.deepEqual(asForm({ kind: "json", draft: '{ "soft_deny": ["rm"] }' }, rules), {
    kind: "object",
    draft: formFor(rules, { soft_deny: ["rm"] }).draft,
  });
});

test("a form switched to JSON but not edited still follows the file", () => {
  const model: SettingSchema = { type: "string" };
  const json = asJson(formFor(model, "sonnet"), model);
  assert.ok(!("error" in json));

  const followed = followFile(json, model, "sonnet", "opus");
  assert.equal(followed.conflict, false);
  assert.deepEqual(followed.form, formFor(model, "opus"));
});

test("a value saved from JSON is in step with the file, so a later change is followed", () => {
  const model: SettingSchema = { type: "string" };
  const saved: Form = { kind: "json", draft: '"opus"' };

  const afterSave = followFile(saved, model, "sonnet", "opus");
  assert.equal(afterSave.conflict, false);
  assert.deepEqual(
    followFile(afterSave.form, model, "opus", "haiku").form,
    formFor(model, "haiku")
  );
});

test("an empty field for a key the file lacks follows the file when the key appears", () => {
  const model: SettingSchema = { type: "string" };
  assert.deepEqual(
    followFile(formFor(model, undefined), model, undefined, "opus").form,
    formFor(model, "opus")
  );
});

test("an autoMode list without $defaults is flagged as replacing the built-in rules", () => {
  // Catches a custom hard_deny list silently dropping Claude Code's built-in block rules.
  assert.equal(replacesBuiltIns("autoMode", "hard_deny", "Never push to main"), true);
  assert.equal(replacesBuiltIns("autoMode", "hard_deny", "$defaults\nNever push to main"), false);
  assert.equal(
    replacesBuiltIns("autoMode", "allow", ""),
    false,
    "an empty list keeps the built-ins"
  );
  assert.equal(replacesBuiltIns("autoMode", "classifyAllShell", "true"), false);
  assert.equal(replacesBuiltIns("permissions", "allow", "Bash(npm test)"), false);
});

test("a field's description shows its first sentence, and an example's \"e.g.\" does not end it", () => {
  assert.deepEqual(
    firstSentence('Dictionary to use, passed to the checker as-is, e.g. "en_GB". Names vary.'),
    ['Dictionary to use, passed to the checker as-is, e.g. "en_GB".', "Names vary."]
  );
  assert.deepEqual(firstSentence("Which ref new worktrees branch from."), [
    "Which ref new worktrees branch from.",
    "",
  ]);
});
