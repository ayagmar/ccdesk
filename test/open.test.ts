import assert from "node:assert/strict";
import { test } from "node:test";
import { editorCommands, spawnPlan } from "../src/core/open.ts";

const none = () => false;

test("a terminal editor in EDITOR is skipped, leaving the system opener", () => {
  assert.deepEqual(editorCommands({ EDITOR: "nvim" }, "linux", none), [["xdg-open", []]]);
  assert.deepEqual(editorCommands({ EDITOR: "/usr/bin/vim" }, "darwin", none), [["open", []]]);
});

test("graphical editors on PATH come before the system opener, which often picks a terminal editor", () => {
  assert.deepEqual(
    editorCommands({ EDITOR: "nvim" }, "linux", (name) => name === "code"),
    [
      ["code", []],
      ["xdg-open", []],
    ]
  );
});

test("a graphical editor is used without its wait flag, and CCDESK_EDITOR alone wins", () => {
  assert.deepEqual(editorCommands({ VISUAL: "code --wait", EDITOR: "nvim" }, "linux", none), [
    ["code", []],
    ["xdg-open", []],
  ]);
  assert.deepEqual(
    editorCommands({ CCDESK_EDITOR: "zed", VISUAL: "code" }, "linux", () => true),
    [["zed", []]]
  );
});

test("on Windows a quoted editor path stays whole and a terminal editor's .exe is still recognised", () => {
  assert.deepEqual(
    editorCommands(
      { VISUAL: '"C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd" --wait' },
      "win32",
      none
    )[0],
    ["C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd", []]
  );
  assert.deepEqual(editorCommands({ EDITOR: "C:\\tools\\nvim.exe" }, "win32", none), [
    ["explorer", []],
  ]);
});

test("on Windows a .cmd editor is started through cmd.exe with every part quoted", () => {
  const plan = spawnPlan("code", [], "C:\\Users\\me\\a b\\CLAUDE.md", "win32");
  assert.deepEqual(plan, {
    file: "cmd.exe",
    args: ["/d", "/s", "/c", '""code" "C:\\Users\\me\\a b\\CLAUDE.md""'],
    verbatim: true,
  });
  assert.throws(() => spawnPlan("code", [], "C:\\%PATH%\\x.md", "win32"));
  assert.equal(spawnPlan("code", [], "/a b/x.md", "linux").file, "code");
});
