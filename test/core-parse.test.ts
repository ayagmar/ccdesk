import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InvalidEditError,
  parseHookEdit,
  parseSettingsEdit,
  RefusedError,
} from "../src/core/index.ts";

const hook = { type: "command", command: "true" };

test("an edit for a settings file no scope names is invalid, not refused", () => {
  // Invalid means the caller is wrong (400); refused means ccdesk will not make the change (409).
  assert.throws(
    () => parseSettingsEdit({ dir: "/work", scope: "global", key: "model", value: "opus" }),
    (error) => error instanceof InvalidEditError && !(error instanceof RefusedError)
  );
});

test("a hook to remove needs a place of whole, non-negative numbers", () => {
  for (const at of [undefined, { group: 0 }, { group: -1, index: 0 }, { group: 0, index: 1.5 }])
    assert.throws(
      () =>
        parseHookEdit({
          dir: "/work",
          file: "/work/.claude/settings.json",
          remove: { event: "PreToolUse", at, definition: hook },
        }),
      InvalidEditError
    );
});

test("a new hook under an event Claude Code does not fire is invalid", () => {
  const edit = (event: string) => ({
    dir: "/work",
    file: "/work/.claude/settings.json",
    add: { event, definition: hook },
  });
  assert.throws(() => parseHookEdit(edit("BeforeEverything")), InvalidEditError);
  assert.deepEqual(parseHookEdit(edit("PreToolUse")).add, {
    event: "PreToolUse",
    definition: hook,
  });
});
