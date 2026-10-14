import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { type AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { createCore, RefusedError, revisionOf, Watcher } from "../src/core/index.ts";
import { createCcdeskServer } from "../src/server/server.ts";
import { storeDirName } from "../src/shared/memory.ts";
import { type ForgetPreview, type Overview, type Usage } from "../src/shared/types.ts";
import { type Fixture, makeFixture, memoryDirFor, memoryFile } from "./helpers/fixture.ts";

const TOKEN = "test-token";
interface Preview {
  path: string;
  before: string | null;
  after: string;
  revision: string;
  errors: string[];
}
interface Change {
  id: string;
  target: string;
  revision: string;
  created: boolean;
}
interface Backup {
  id: string;
  kind: string;
  target: string;
  created: boolean;
  projectPath?: string;
}
interface RestorePreview {
  before: string | null;
  after: string;
  revision: string;
  removes?: boolean;
  blocked?: string;
  createsFolder?: string;
  indexLines?: string[];
  undoCommands?: string[];
}
let fixture: Fixture;
let server: ReturnType<typeof createCcdeskServer>;
let base: string;
/** The files the current test opened in the editor. */
const opened: string[] = [];
/**
 * The claude commands the current test ran; each entry in failing makes the next such command
 * fail once.
 */
const claudeRuns: Array<{ args: string[]; cwd: string }> = [];
const failing: string[] = [];

before(async () => {
  fixture = makeFixture();
  const core = createCore(fixture.env, {
    openFile: async (path) => {
      opened.push(path);
      return "fake-editor";
    },
    runClaude: async (args, cwd) => {
      claudeRuns.push({ args, cwd });
      // As the real runner reports a failed command.
      const fails = failing.indexOf(args[1] ?? "");
      if (fails >= 0) {
        failing.splice(fails, 1);
        throw new RefusedError(`claude ${args[1]} failed`);
      }
      return "";
    },
  });
  server = createCcdeskServer({ core, launchDir: fixture.at("home"), token: TOKEN, uiDir: null });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
// The tests share one server, so what one test opened or ran must not show up in the next.
beforeEach(() => {
  opened.length = 0;
  claudeRuns.length = 0;
  failing.length = 0;
});

/**
 * ~/.claude/.credentials.json, removed first: tests turn it into a link or a hard link, and writing
 * to it would then change the file it links to.
 */
function freshCredentials(): string {
  const path = join(fixture.env.claudeDir, ".credentials.json");
  rmSync(path, { force: true });
  return path;
}

// The hermetic setup blocks fetch, so tests talk to the loopback server with node:http.
async function call(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const { request } = await import("node:http");
  const url = new URL(path, base);
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: init.method ?? "GET",
        headers: {
          "x-ccdesk-token": TOKEN,
          ...(payload ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null })
        );
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** Checks a request was refused and why, so a refusal for another reason fails the test. */
function assertRefused(res: { status: number; json: unknown }, status: number, reason: RegExp) {
  assert.equal(res.status, status);
  assert.match((res.json as { error: string }).error, reason);
}

function seedMemory() {
  const dir = memoryDirFor(fixture, "/work/app");
  fixture.write(`${dir}/MEMORY.md`, "- [Keep](keep.md) — stays\n- [Old](old.md) — stale\n");
  fixture.write(`${dir}/keep.md`, memoryFile("keep", "user", "stays", "x"));
  const old = fixture.write(`${dir}/old.md`, memoryFile("old", "project", "stale", "y"));
  return { dir, old };
}

function previewMemory(action: string, path: string) {
  return call("/api/memory/preview", { method: "POST", body: { action, path } });
}

/**
 * Reviews a memory action, then makes it with the reviewed revision, as the page does, naming the
 * directory the store is saved for when given.
 */
async function changeMemory(action: string, path: string, projectPath?: string) {
  const preview = await previewMemory(action, path);
  if (preview.status !== 200) return preview;
  const { revision } = preview.json as { revision: string };
  return call("/api/memory/change", {
    method: "POST",
    body: { action, path, revision, ...(projectPath && { projectPath }) },
  });
}

function deleteMemory(path: string) {
  return changeMemory("delete", path);
}

/** Undoes a change as the page's Undo button does. */
function undo(change: Change) {
  return call("/api/backups/restore", {
    method: "POST",
    body: { id: change.id, revision: change.revision },
  });
}

async function backups(): Promise<Backup[]> {
  return ((await call("/api/backups?limit=200")).json as { changes: Backup[] }).changes;
}

/** Previews then saves a settings edit, as the page does after you review the diff. */
async function saveSetting(edit: Record<string, unknown>) {
  const { revision } = (await call("/api/settings/preview", { method: "POST", body: edit }))
    .json as Preview;
  return call("/api/settings/save", { method: "POST", body: { ...edit, revision } });
}

test("API calls without the session token are refused", async () => {
  const res = await call("/api/overview", { headers: { "x-ccdesk-token": "wrong" } });
  assertRefused(res, 401, /Missing or wrong token/);
});

/**
 * Opens the page's event stream for `dir`: `next()` gives the next event, or fails after 5 s, and
 * `close()` closes the stream as a page does when it leaves the directory.
 */
async function openEvents(dir: string) {
  const { request } = await import("node:http");
  const url = new URL(`/api/events?dir=${encodeURIComponent(dir)}`, base);
  return new Promise<{
    type: string | undefined;
    next: () => Promise<{ event: string; data: unknown }>;
    close: () => void;
  }>((resolve, reject) => {
    const req = request(url, { headers: { "x-ccdesk-token": TOKEN } }, (res) => {
      const events: Array<{ event: string; data: unknown }> = [];
      let text = "";
      let arrived = () => {
        // Replaced while a test waits for an event.
      };
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
        const blocks = text.split("\n\n");
        text = blocks.pop() ?? "";
        for (const block of blocks) {
          const field = (name: string) =>
            block
              .split("\n")
              .find((line) => line.startsWith(`${name}: `))
              ?.slice(name.length + 2);
          const event = field("event");
          if (event) events.push({ event, data: JSON.parse(field("data") ?? "null") });
        }
        arrived();
      });
      const next = async () => {
        const deadline = Date.now() + 5000;
        while (events.length === 0) {
          if (Date.now() > deadline) throw new Error("no event within 5 s");
          await new Promise<void>((done) => {
            arrived = done;
            setTimeout(done, 100);
          });
        }
        return events.shift() as { event: string; data: unknown };
      };
      resolve({ type: res.headers["content-type"], next, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

test("the page hears about a change to a config file over its event stream", async () => {
  const dir = fixture.at("work/events");
  fixture.write("work/events/CLAUDE.md", "one\n");
  const stream = await openEvents(dir);
  try {
    assert.match(stream.type ?? "", /^text\/event-stream/);
    // First, once the watchers have started: the folders ccdesk cannot watch.
    assert.deepEqual(await stream.next(), { event: "unwatched", data: [] });

    fixture.write("work/events/CLAUDE.md", "two\n");

    assert.equal((await stream.next()).event, "change");
  } finally {
    stream.close();
  }
});

test("closing the event stream stops watching for it", async (t) => {
  const stopped: string[] = [];
  const subscribe = Watcher.prototype.subscribe;
  t.mock.method(
    Watcher.prototype,
    "subscribe",
    async function (this: Watcher, ...args: Parameters<Watcher["subscribe"]>) {
      const unsubscribe = await subscribe.apply(this, args);
      return () => {
        stopped.push(args[0]);
        unsubscribe();
      };
    }
  );
  const dir = fixture.at("work/events-closed");
  fixture.write("work/events-closed/CLAUDE.md", "one\n");
  const stream = await openEvents(dir);
  await stream.next();

  stream.close();
  for (let i = 0; i < 50 && stopped.length === 0; i++)
    await new Promise((done) => setTimeout(done, 20));

  assert.deepEqual(stopped, [dir]);
});

test("the event stream needs the session token, and an absolute directory", async () => {
  const dir = encodeURIComponent(fixture.at("work"));
  assertRefused(
    await call(`/api/events?dir=${dir}`, { headers: { "x-ccdesk-token": "wrong" } }),
    401,
    /Missing or wrong token/
  );
  assertRefused(await call("/api/events?dir=work"), 400, /dir must be an absolute path/);
});

test("requests addressed to another host name are refused (DNS rebinding)", async () => {
  const res = await call("/api/overview", { headers: { host: "evil.example:80" } });
  assertRefused(res, 421, /Unexpected host/);
});

test("the page gets the settings schema, catalog and hook events from the server, behind the token", async () => {
  assertRefused(
    await call("/api/reference", { headers: { "x-ccdesk-token": "wrong" } }),
    401,
    /Missing or wrong token/
  );
  const res = await call("/api/reference");
  assert.equal(res.status, 200);
  const { settings, catalog, hookEvents } = res.json as {
    settings: Record<string, { type?: string }>;
    catalog: Array<{ key: string; scopes: string[] }>;
    hookEvents: string[];
  };
  // The editor reads a key's type from the schema; the catalog lists it under its own name.
  assert.equal(settings.cleanupPeriodDays?.type, "number");
  assert.ok(catalog.some((s) => s.key === "cleanupPeriodDays" && s.scopes.includes("user")));
  assert.ok(hookEvents.includes("PreToolUse"));
});

test("deleting a memory removes its file and index line, and undo puts both back", async () => {
  const { dir, old } = seedMemory();

  const deleted = await deleteMemory(old);
  assert.equal(deleted.status, 200);
  assert.equal(existsSync(old), false);
  assert.equal(readFileSync(`${dir}/MEMORY.md`, "utf8"), "- [Keep](keep.md) — stays\n");

  const restored = await undo(deleted.json as Change);
  assert.equal(restored.status, 200);
  assert.equal(readFileSync(old, "utf8"), memoryFile("old", "project", "stale", "y"));
  assert.match(readFileSync(`${dir}/MEMORY.md`, "utf8"), /\[Old\]\(old\.md\)/);
});

/** An assistant line calling Read on `file`, as Claude Code records it. */
function readLine(id: string, file: string, at: string, cwd: string): string {
  const content = [{ type: "tool_use", id, name: "Read", input: { file_path: file } }];
  return `${JSON.stringify({ type: "assistant", timestamp: at, cwd, message: { content } })}\n`;
}

test("the usage count says how often Claude read each memory file of the directory's store", async () => {
  // Catches the route not counting the store's memory files, so every memory shows as never read.
  const project = fixture.at("work", "reads");
  const memory = fixture.write(
    join(memoryDirFor(fixture, project), "testing.md"),
    memoryFile("testing", "project", "d", "x")
  );
  const at = "2026-10-02T09:00:00.000Z";
  fixture.write(
    join(memoryDirFor(fixture, project), "..", "one.jsonl"),
    readLine("t1", memory, at, project)
  );

  const res = await call("/api/usage", { method: "POST", body: { path: project, rules: [] } });

  assert.deepEqual((res.json as Usage).memories, { [memory]: { reads: 1, last: at } });
});

test("the usage count answers for no file outside the directory's memory folder", async () => {
  // Catches the route counting reads of paths the request names, which would tell anyone with
  // the token whether and when Claude read any file, such as a key or a .env.
  const project = fixture.at("work", "secretive");
  const secret = fixture.write("work/secretive/.env", "TOKEN=fake\n");
  fixture.write(
    join(memoryDirFor(fixture, project), "..", "one.jsonl"),
    readLine("t1", secret, "2026-10-02T09:00:00.000Z", project)
  );

  const res = await call("/api/usage", {
    method: "POST",
    body: { path: project, rules: [], memories: [secret] },
  });

  assert.equal(res.status, 200);
  assert.deepEqual((res.json as Usage).memories, {});
});

test("the usage count is refused for a relative path", async () => {
  // Catches the route scanning and counting a folder relative to wherever ccdesk was started.
  const res = await call("/api/usage", { method: "POST", body: { path: "work", rules: [] } });

  assertRefused(res, 400, /path must be an absolute path/);
});

test("the usage count for a print session counts the memory files of the store it uses", async () => {
  // A repository's autoMemoryDirectory waits for trust in an interactive session but applies to
  // claude -p at once; catches counting the interactive store for the print view, whose memories
  // would then never fill in.
  const project = fixture.at("work", "printed");
  const custom = fixture.at("work", "printed-notes");
  fixture.json("work/printed/.claude/settings.json", { autoMemoryDirectory: custom });
  const printed = fixture.write(join(custom, "printed.md"), memoryFile("p", "project", "d", "x"));
  const interactive = fixture.write(
    join(memoryDirFor(fixture, project), "kept.md"),
    memoryFile("k", "project", "d", "x")
  );
  const count = async (profile: string) =>
    Object.keys(
      (
        (await call("/api/usage", { method: "POST", body: { path: project, rules: [], profile } }))
          .json as Usage
      ).memories
    );

  assert.deepEqual(await count("print"), [printed]);
  assert.deepEqual(await count("interactive"), [interactive]);
});

test("a large memory folder does not stop tool calls being counted", async () => {
  // Catches the page sending every memory's path again: a few hundred long paths passed the
  // request size limit, and the tools' counts failed with it.
  const project = fixture.at("work", "many");
  const store = memoryDirFor(fixture, project);
  for (let i = 0; i < 700; i++)
    fixture.write(join(store, `${"a-rather-long-memory-name-".repeat(4)}${i}.md`), "x\n");
  fixture.write(
    join(store, "..", "one.jsonl"),
    readLine("t1", join(project, "README.md"), "2026-10-02T09:00:00.000Z", project)
  );

  const res = await call("/api/usage", { method: "POST", body: { path: project, rules: [] } });

  assert.equal(res.status, 200);
  assert.equal((res.json as Usage).tools[0]?.calls, 1);
  assert.equal(Object.keys((res.json as Usage).memories).length, 700);
});

test("deleting a memory also removes an index line that names it as [[name]]", async () => {
  const dir = memoryDirFor(fixture, "/work/wiki");
  fixture.write(`${dir}/MEMORY.md`, "- [Keep](keep.md) — stays\n- [[gone]] — stale\n");
  fixture.write(`${dir}/keep.md`, memoryFile("keep", "user", "stays", "x"));
  const gone = fixture.write(`${dir}/gone.md`, memoryFile("gone", "project", "stale", "y"));

  const deleted = await deleteMemory(gone);

  assert.equal(deleted.status, 200);
  assert.equal(readFileSync(`${dir}/MEMORY.md`, "utf8"), "- [Keep](keep.md) — stays\n");
});

test("a memory that changed since you looked at it is not deleted", async () => {
  const { old } = seedMemory();
  const { revision } = (await previewMemory("delete", old)).json as { revision: string };
  fixture.write(old, memoryFile("old", "project", "stale", "rewritten by Claude"));

  const res = await call("/api/memory/change", {
    method: "POST",
    body: { action: "delete", path: old, revision },
  });

  assertRefused(res, 409, /changed since you reviewed this/);
  assert.match(readFileSync(old, "utf8"), /rewritten by Claude/);
});

test("only memory topic files can be deleted", async () => {
  const { dir } = seedMemory();
  const outside = fixture.write("home/.claude/settings.json", "{}");

  const refused: [string, RegExp][] = [
    [`${dir}/MEMORY.md`, /MEMORY\.md is the index Claude maintains/],
    [outside, /only changes auto memory under ~\/\.claude\/projects/],
    [`${dir}/../../../settings.json`, /only changes auto memory under ~\/\.claude\/projects/],
  ];
  for (const [path, reason] of refused) assertRefused(await deleteMemory(path), 409, reason);
  assert.equal(existsSync(`${dir}/MEMORY.md`), true);
  assert.equal(existsSync(outside), true);
});

test("a mutation from another web origin is refused", async () => {
  const { old } = seedMemory();
  const { revision } = (await previewMemory("delete", old)).json as { revision: string };
  const res = await call("/api/memory/change", {
    method: "POST",
    body: { action: "delete", path: old, revision },
    headers: { origin: "https://evil.example" },
  });
  assertRefused(res, 403, /Cross-origin request refused/);
  assert.equal(existsSync(old), true);
});

test("a hook event Claude Code does not know is not written, unless the file already has it", async () => {
  const dir = fixture.at("work/hook-events");
  const file = fixture.json("work/hook-events/.claude/settings.json", {
    hooks: { OldEvent: [{ hooks: [{ type: "command", command: "old" }] }] },
  });
  const hook = { hooks: [{ type: "command", command: "x" }] };
  const preview = (value: unknown) =>
    call("/api/settings/preview", {
      method: "POST",
      body: { dir, scope: "project", key: "hooks", value },
    });
  const untouched = readFileSync(file, "utf8");

  const unknown = (await preview({ OldEvent: [hook], Nope: [hook] })).json as Preview;
  assert.deepEqual(unknown.errors, ["Nope is not a hook event Claude Code knows."]);
  const kept = (await preview({ OldEvent: [hook], Stop: [hook] })).json as Preview;
  assert.deepEqual(kept.errors, []);
  assert.equal(readFileSync(file, "utf8"), untouched);
});

test("a Project edit through a link to your home folder is refused, since that file is your user settings", async () => {
  fixture.link("work/home-alias", fixture.env.home);
  const res = await call("/api/settings/preview", {
    method: "POST",
    body: {
      dir: fixture.at("work/home-alias"),
      scope: "project",
      key: "effortLevel",
      value: "high",
    },
  });
  assertRefused(res, 409, /edit it as User/);
});

test("a save is refused when the reviewed file moved, even though neither file exists", async () => {
  // Outside git the local file is in the start folder; once a parent is a repository, at its root.
  fixture.write("work/relocates/sub/README.md", "x");
  const dir = fixture.at("work/relocates/sub");
  const edit = { dir, scope: "local", key: "effortLevel", value: "high" };
  const preview = (await call("/api/settings/preview", { method: "POST", body: edit }))
    .json as Preview;
  assert.equal(preview.path, fixture.at("work/relocates/sub/.claude/settings.local.json"));

  fixture.git("work/relocates", "init", "-q");
  const res = await call("/api/settings/save", {
    method: "POST",
    body: { ...edit, revision: preview.revision },
  });
  assertRefused(res, 409, /changed since you reviewed this/);
  assert.equal(existsSync(fixture.at("work/relocates/.claude/settings.local.json")), false);
});

test("a settings edit is previewed as a file change, then saved with a backup", async () => {
  const dir = fixture.at("work/site");
  const file = fixture.json("work/site/.claude/settings.json", { model: "sonnet" });
  const edit = { dir, scope: "project", key: "effortLevel", value: "high" };

  const preview = await call("/api/settings/preview", { method: "POST", body: edit });
  assert.equal(preview.status, 200);
  const { before: shownBefore, after: shownAfter, revision, errors } = preview.json as Preview;
  assert.deepEqual(errors, []);
  assert.deepEqual(JSON.parse(shownAfter), { model: "sonnet", effortLevel: "high" });
  assert.deepEqual(
    JSON.parse(readFileSync(file, "utf8")),
    JSON.parse(shownBefore ?? ""),
    "preview writes nothing"
  );

  const saved = await call("/api/settings/save", { method: "POST", body: { ...edit, revision } });
  assert.equal(saved.status, 200);
  assert.equal(readFileSync(file, "utf8"), shownAfter);
  assert.equal((await backups()).find((b) => b.id === (saved.json as Change).id)?.target, file);

  const view = await call(`/api/directory?path=${encodeURIComponent(dir)}`);
  const effective = (view.json as { effective: Array<{ key: string; value: unknown }> }).effective;
  assert.equal(effective.find((s) => s.key === "effortLevel")?.value, "high");
});

test("a settings value of the wrong type is reported and cannot be saved", async () => {
  const dir = fixture.at("work/typed");
  const file = fixture.json("work/typed/.claude/settings.json", {});
  const edit = { dir, scope: "project", key: "effortLevel", value: "turbo" };

  const preview = await call("/api/settings/preview", { method: "POST", body: edit });
  assert.match((preview.json as { errors: string[] }).errors.join(), /effortLevel/);

  const { revision } = preview.json as Preview;
  const saved = await call("/api/settings/save", { method: "POST", body: { ...edit, revision } });
  assertRefused(saved, 409, /effortLevel must be equal to one of the allowed values/);
  assert.equal(readFileSync(file, "utf8"), "{}");
});

test("autoMode, which only SchemaStore's schema defines, is editable in user settings and checked", async () => {
  // Catches the schema losing the documented keys it borrows: autoMode would turn read-only again.
  const dir = fixture.at("work/auto-mode");
  fixture.json("work/auto-mode/.claude/settings.json", {});
  const preview = (value: unknown, scope = "user") =>
    call("/api/settings/preview", { method: "POST", body: { dir, scope, key: "autoMode", value } });

  const rules = { allow: ["$defaults", "Merging directly on our repositories is authorized"] };
  const valid = (await preview(rules)).json as Preview & { errors: string[] };
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(JSON.parse(valid.after).autoMode, rules);

  const wrong = (await preview({ allow: "everything" })).json as { errors: string[] };
  assert.match(wrong.errors.join(), /autoMode\.allow must be array/);

  assertRefused(await preview(rules, "project"), 409, /only from managed or user settings/);
});

test("saving refuses when the file changed after it was reviewed", async () => {
  const dir = fixture.at("work/raced");
  const file = fixture.json("work/raced/.claude/settings.json", { model: "opus" });
  const edit = { dir, scope: "project", key: "model", value: "sonnet" };
  const preview = await call("/api/settings/preview", { method: "POST", body: edit });
  const { revision } = preview.json as Preview;

  fixture.json("work/raced/.claude/settings.json", { model: "haiku" });
  const saved = await call("/api/settings/save", { method: "POST", body: { ...edit, revision } });
  assertRefused(saved, 409, /changed since you reviewed this edit/);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { model: "haiku" });
});

test("settings ccdesk cannot see or may not change are refused", async () => {
  const dir = fixture.at("work/guarded");
  fixture.json("work/guarded/.claude/settings.json", { env: { TOKEN: "secret" } });
  const refused: [Record<string, unknown>, RegExp][] = [
    [{ scope: "project", key: "env", value: {} }, /env holds hidden values/],
    [{ scope: "managed", key: "model", value: "opus" }, /set by your organisation/],
    [
      { scope: "project", key: "notARealSetting", value: 1 },
      /not in Claude Code's settings schema/,
    ],
    [
      { scope: "local", key: "model", value: "opus", dir: fixture.at("work/missing") },
      /is not a directory on this machine/,
    ],
  ];
  for (const [edit, reason] of refused) {
    const res = await call("/api/settings/preview", { method: "POST", body: { dir, ...edit } });
    assertRefused(res, 409, reason);
  }
});

test("a memory missing from MEMORY.md is added as a line, and undo takes the line out", async () => {
  const dir = memoryDirFor(fixture, "/work/indexing");
  fixture.write(`${dir}/MEMORY.md`, "- [Keep](keep.md) — stays\n");
  fixture.write(`${dir}/keep.md`, memoryFile("keep", "user", "stays", "x"));
  const lost = fixture.write(`${dir}/lost.md`, memoryFile("lost", "project", "forgotten", "y"));

  const added = await changeMemory("add", lost);
  assert.equal(added.status, 200);
  const line = "- [lost](lost.md) — forgotten";
  assert.equal(readFileSync(`${dir}/MEMORY.md`, "utf8"), `- [Keep](keep.md) — stays\n${line}\n`);

  assert.equal((await undo(added.json as Change)).status, 200);
  assert.equal(readFileSync(`${dir}/MEMORY.md`, "utf8"), "- [Keep](keep.md) — stays\n");
});

test("only index lines whose file is gone are removed, and only from the MEMORY.md you saw", async () => {
  const dir = memoryDirFor(fixture, "/work/dead");
  const indexPath = fixture.write(
    `${dir}/MEMORY.md`,
    "- [Gone](gone.md) — deleted by hand\n- [Here](here.md) — ok\n"
  );
  fixture.write(`${dir}/here.md`, memoryFile("here", "user", "ok", "x"));
  const preview = (await previewMemory("remove-dead", indexPath)).json as {
    files: Array<{ after: string }>;
    revision: string;
  };
  assert.equal(preview.files[0]?.after, "- [Here](here.md) — ok\n");
  const body = { action: "remove-dead", path: indexPath, revision: preview.revision };

  const removed = await call("/api/memory/change", { method: "POST", body });
  assert.equal(removed.status, 200);
  assert.equal(readFileSync(indexPath, "utf8"), "- [Here](here.md) — ok\n");

  // Another line whose file is gone, added after the review: the reviewed removal is out of date.
  fixture.write(indexPath, "- [Here](here.md) — ok\n- [Lost](lost.md) — deleted too\n");
  const stale = await call("/api/memory/change", { method: "POST", body });
  assertRefused(stale, 409, /changed since you reviewed this/);
});

test("removing dead index lines keeps a line that still links to a memory, and a link written percent-encoded", async () => {
  const dir = memoryDirFor(fixture, "/work/mixed");
  const indexPath = fixture.write(
    `${dir}/MEMORY.md`,
    [
      "- [Gone](gone.md) — deleted by hand",
      "- [Gone](gone.md), see also [Here](here.md)",
      "- [Note](my%20note.md) — spaces in the name",
      "",
    ].join("\n")
  );
  fixture.write(`${dir}/here.md`, memoryFile("here", "user", "ok", "x"));
  fixture.write(`${dir}/my note.md`, memoryFile("note", "user", "spaces", "y"));

  const removed = await changeMemory("remove-dead", indexPath);

  assert.equal(removed.status, 200);
  assert.equal(
    readFileSync(indexPath, "utf8"),
    "- [Gone](gone.md), see also [Here](here.md)\n- [Note](my%20note.md) — spaces in the name\n"
  );
});

test("deleting a memory keeps an index line that also links to another memory", async () => {
  const dir = memoryDirFor(fixture, "/work/shared-line");
  const line = "- [A](a.md), see also [B](b.md)";
  fixture.write(`${dir}/MEMORY.md`, `- [A](a.md) — first\n${line}\n`);
  const a = fixture.write(`${dir}/a.md`, memoryFile("a", "user", "first", "x"));
  fixture.write(`${dir}/b.md`, memoryFile("b", "user", "second", "y"));

  const deleted = await deleteMemory(a);

  assert.equal(deleted.status, 200);
  assert.equal(existsSync(a), false);
  assert.equal(readFileSync(`${dir}/MEMORY.md`, "utf8"), `${line}\n`);
});

test("removing dead index lines reads titled, relative and reference links, and keeps a line it cannot read whole", async () => {
  const dir = memoryDirFor(fixture, "/work/link-forms");
  const kept = [
    '- [Gone](gone.md), see [Live](live.md "kept")',
    "- [Gone](gone.md), see [Live][live]",
    "- [Gone](gone.md), see [Live](<./live.md>)",
    "- [Gone](gone.md), see [Notes](../notes/live.md)",
    "[live]: live.md",
  ];
  const indexPath = fixture.write(
    `${dir}/MEMORY.md`,
    [
      '- [Gone](gone.md "a title") — titled',
      "- [Gone](./gone.md) — relative",
      "- [Gone](<gone.md>) — angle brackets",
      ...kept,
      "",
    ].join("\n")
  );
  fixture.write(`${dir}/live.md`, memoryFile("live", "user", "ok", "x"));

  const removed = await changeMemory("remove-dead", indexPath);

  assert.equal(removed.status, 200);
  assert.equal(readFileSync(indexPath, "utf8"), `${kept.join("\n")}\n`);
});

test("deleting a memory keeps an index line whose other link has a title or a relative path", async () => {
  const dir = memoryDirFor(fixture, "/work/titled-line");
  const lines = ['- [A](a.md), see [B](b.md "second")', "- [A](./a.md), see [B](./b.md)"];
  fixture.write(`${dir}/MEMORY.md`, `- [A](./a.md "first")\n${lines.join("\n")}\n`);
  const a = fixture.write(`${dir}/a.md`, memoryFile("a", "user", "first", "x"));
  fixture.write(`${dir}/b.md`, memoryFile("b", "user", "second", "y"));

  const deleted = await deleteMemory(a);

  assert.equal(deleted.status, 200);
  assert.equal(readFileSync(`${dir}/MEMORY.md`, "utf8"), `${lines.join("\n")}\n`);
});

test("index changes are refused outside a memory folder's MEMORY.md", async () => {
  const target = fixture.write("home/.claude/CLAUDE.md", "keep me\n");

  const res = await changeMemory("remove-dead", target);

  assertRefused(res, 409, /Only a memory folder's MEMORY\.md can be changed/);
  assert.equal(readFileSync(target, "utf8"), "keep me\n");
});

test("a file opens in the editor, but credentials and missing files do not", async () => {
  const file = fixture.write("home/.claude/CLAUDE.md", "x\n");
  const credentials = fixture.write(freshCredentials(), "{}");

  const ok = await call("/api/open", { method: "POST", body: { path: file } });
  const secret = await call("/api/open", { method: "POST", body: { path: credentials } });
  const missing = await call("/api/open", {
    method: "POST",
    body: { path: fixture.at("home/nope.md") },
  });

  const folder = await call("/api/open", { method: "POST", body: { path: fixture.at("home") } });

  assert.equal(ok.status, 200);
  assertRefused(secret, 409, /does not open credentials/);
  assertRefused(missing, 409, /no longer exists/);
  assert.equal(folder.status, 200, "a plugin's folder opens too");
  assert.deepEqual(opened, [file, fixture.at("home")]);
});

test("reviewing an edit never sends hidden env values to the browser", async () => {
  const dir = fixture.at("work/secretive");
  fixture.json("work/secretive/.claude/settings.json", {
    env: { ANTHROPIC_API_KEY: "sk-live-123" },
    model: "opus",
  });

  const preview = await call("/api/settings/preview", {
    method: "POST",
    body: { dir, scope: "project", key: "model", value: "sonnet" },
  });

  assert.equal(preview.status, 200);
  assert.doesNotMatch(JSON.stringify(preview.json), /sk-live-123/);
});

test("an edit cannot add env or header values, which ccdesk never shows", async () => {
  const dir = fixture.at("work/no-env");
  fixture.json("work/no-env/.claude/settings.json", {});

  const res = await call("/api/settings/preview", {
    method: "POST",
    body: { dir, scope: "project", key: "env", value: { TOKEN: "x" } },
  });

  assertRefused(res, 409, /env holds hidden values/);
});

test("saving a settings file that is a symlink updates the linked file and keeps the link", async () => {
  const dotfile = fixture.json("dotfiles/claude-settings.json", { model: "opus" });
  const dir = fixture.at("work/linked");
  fixture.link("work/linked/.claude/settings.json", dotfile);
  const edit = { dir, scope: "project", key: "model", value: "sonnet" };
  const { revision } = (await call("/api/settings/preview", { method: "POST", body: edit }))
    .json as Preview;

  const saved = await call("/api/settings/save", { method: "POST", body: { ...edit, revision } });

  assert.equal(saved.status, 200);
  assert.equal(lstatSync(`${dir}/.claude/settings.json`).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(readFileSync(dotfile, "utf8")), { model: "sonnet" });
});

test("two saves reviewed against the same file: the second is refused, not lost", async () => {
  const dir = fixture.at("work/twice");
  const file = fixture.json("work/twice/.claude/settings.json", { model: "opus" });
  const first = { dir, scope: "project", key: "model", value: "sonnet" };
  const second = { dir, scope: "project", key: "effortLevel", value: "high" };
  const r1 = (
    (await call("/api/settings/preview", { method: "POST", body: first })).json as Preview
  ).revision;
  const r2 = (
    (await call("/api/settings/preview", { method: "POST", body: second })).json as Preview
  ).revision;

  const results = await Promise.all([
    call("/api/settings/save", { method: "POST", body: { ...first, revision: r1 } }),
    call("/api/settings/save", { method: "POST", body: { ...second, revision: r2 } }),
  ]);

  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  for (const res of results)
    if (res.status === 409) assertRefused(res, 409, /changed since you reviewed this edit/);
  const written = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    results[0]?.status === 200 ? written.model : written.effortLevel,
    results[0]?.status === 200 ? "sonnet" : "high"
  );
});

test("undoing an index change is refused when MEMORY.md changed again since", async () => {
  const dir = memoryDirFor(fixture, "/work/drifted");
  fixture.write(`${dir}/MEMORY.md`, "");
  const lost = fixture.write(`${dir}/lost.md`, memoryFile("lost", "project", "gone", "y"));
  const added = (await changeMemory("add", lost)).json as Change;

  fixture.write(`${dir}/MEMORY.md`, `${readFileSync(`${dir}/MEMORY.md`, "utf8")}- [new](new.md)\n`);

  assertRefused(await undo(added), 409, /changed since you reviewed this restore/);
  assert.match(readFileSync(`${dir}/MEMORY.md`, "utf8"), /new\.md/);
});

test("an unreadable MEMORY.md is left alone instead of being replaced", {
  // Root reads any file, and Windows ignores the mode bits that make a file unreadable.
  skip: process.getuid?.() === 0 || process.platform === "win32",
}, async () => {
  const dir = memoryDirFor(fixture, "/work/locked");
  const index = fixture.write(`${dir}/MEMORY.md`, "- [keep](keep.md) — important\n");
  const lost = fixture.write(`${dir}/lost.md`, memoryFile("lost", "project", "gone", "y"));
  chmodSync(index, 0o000);

  const res = await changeMemory("add", lost);

  chmodSync(index, 0o644);
  assert.notEqual(res.status, 200);
  assert.equal(readFileSync(index, "utf8"), "- [keep](keep.md) — important\n");
});

test("a link to the credentials file is never opened", async () => {
  const credentials = fixture.write(freshCredentials(), "{}");
  fixture.link("home/notes.md", credentials);

  const res = await call("/api/open", {
    method: "POST",
    body: { path: fixture.at("home/notes.md") },
  });

  assertRefused(res, 409, /does not open credentials/);
  assert.deepEqual(opened, []);
});

test("credentials kept under another name are never opened by that name", async () => {
  const tokens = fixture.write("home/.claude/token-store.json", '{"accessToken":"x"}');
  fixture.link(freshCredentials(), tokens);

  const res = await call("/api/open", { method: "POST", body: { path: tokens } });

  assertRefused(res, 409, /does not open credentials/);
  assert.deepEqual(opened, []);
});

test("a forged backup cannot restore over a file ccdesk does not change", async () => {
  const claudeMd = fixture.write("home/.claude/CLAUDE.md", "mine\n");
  const forged = join(fixture.env.claudeDir, "backups", "ccdesk", "forged");
  fixture.write(join(forged, "before"), "evil\n");
  fixture.json(join(forged, "ccdesk-backup.json"), {
    kind: "settings",
    target: claudeMd,
    createdAt: new Date().toISOString(),
    before: revisionOf("evil\n"),
    after: revisionOf("mine\n"),
  });

  const res = await call("/api/backups/restore", {
    method: "POST",
    body: { id: "forged", revision: revisionOf("mine\n") },
  });

  assertRefused(res, 409, /does not point at a settings file/);
  assert.equal(readFileSync(claudeMd, "utf8"), "mine\n");
});

test("a backup folder whose manifest ccdesk did not write is not listed", async () => {
  // Catches the manifest check letting through a kind ccdesk does not know, which a restore would
  // then treat as some other kind of file, or a field of the wrong type.
  const root = join(fixture.env.claudeDir, "backups", "ccdesk");
  const manifest = {
    kind: "settings",
    target: fixture.at("work/odd/.claude/settings.json"),
    createdAt: new Date().toISOString(),
    before: revisionOf(null),
    after: revisionOf("{}\n"),
  };
  fixture.json(join(root, "odd-kind", "ccdesk-backup.json"), { ...manifest, kind: "elsewhere" });
  fixture.json(join(root, "odd-lines", "ccdesk-backup.json"), {
    ...manifest,
    removedIndexLines: "- [Old](old.md)",
  });
  fixture.json(join(root, "odd-ok", "ccdesk-backup.json"), manifest);

  const ids = (await backups()).map((b) => b.id);

  assert.ok(ids.includes("odd-ok"));
  assert.equal(ids.includes("odd-kind"), false);
  assert.equal(ids.includes("odd-lines"), false);
});

test("a saved settings change shows up in recent changes and can be restored after review", async () => {
  const dir = fixture.at("work/restore");
  const file = fixture.json("work/restore/.claude/settings.json", {
    model: "sonnet",
    env: { TOKEN: "s3cret" },
  });
  const edit = { dir, scope: "project", key: "model", value: "opus" };
  const { revision } = (await call("/api/settings/preview", { method: "POST", body: edit }))
    .json as Preview;
  await call("/api/settings/save", { method: "POST", body: { ...edit, revision } });

  const backup = (await backups()).find((b) => b.target === file);
  assert.equal(backup?.kind, "settings");

  const preview = await call("/api/backups/preview", { method: "POST", body: { id: backup?.id } });
  const shown = preview.json as RestorePreview;
  assert.equal(JSON.parse(shown.after).model, "sonnet");
  assert.equal(shown.createsFolder, undefined);
  assert.doesNotMatch(JSON.stringify(shown), /s3cret/, "a restore preview hides secrets too");

  const restored = await call("/api/backups/restore", {
    method: "POST",
    body: { id: backup?.id, revision: shown.revision },
  });
  assert.equal(restored.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    model: "sonnet",
    env: { TOKEN: "s3cret" },
  });
  // The opus version is backed up before the restore, so the restore can be undone too.
  assert.equal((await backups()).filter((b) => b.target === file).length, 2);
});

test("restoring a file of a deleted folder says the restore creates the folder again", async () => {
  // Catches a restore of a deleted worktree's settings looking like any other new file, then
  // leaving behind a folder holding only that file.
  const dir = fixture.at("work/deleted");
  const file = fixture.json("work/deleted/.claude/settings.json", { model: "sonnet" });
  await saveSetting({ dir, scope: "project", key: "model", value: "opus" });
  const backup = (await backups()).find((b) => b.target === file);
  rmSync(dir, { recursive: true });

  const shown = (await call("/api/backups/preview", { method: "POST", body: { id: backup?.id } }))
    .json as RestorePreview;

  assert.equal(shown.createsFolder, dir);
});

test("reviewing the removal of a created file in a deleted folder never says it creates the folder", async () => {
  // Catches the deleted-folder warning on a review of a removal, which creates nothing. Such a
  // review is always blocked, since the file went with its folder, so the warning would only
  // confuse why.
  const dir = fixture.at("work/created-deleted");
  fixture.write("work/created-deleted/README.md", "A project.\n");
  await saveSetting({ dir, scope: "project", key: "model", value: "opus" });
  const backup = (await backups()).find((b) => b.target === join(dir, ".claude", "settings.json"));
  rmSync(dir, { recursive: true });

  const shown = (await call("/api/backups/preview", { method: "POST", body: { id: backup?.id } }))
    .json as RestorePreview;

  assert.equal(shown.removes, true);
  assert.ok(shown.blocked);
  assert.equal(shown.createsFolder, undefined);
});

test("a restore is refused when the file changed after it was reviewed", async () => {
  const dir = fixture.at("work/restore-stale");
  const file = fixture.json("work/restore-stale/.claude/settings.json", { model: "sonnet" });
  const edit = { dir, scope: "project", key: "model", value: "opus" };
  const { revision } = (await call("/api/settings/preview", { method: "POST", body: edit }))
    .json as Preview;
  await call("/api/settings/save", { method: "POST", body: { ...edit, revision } });
  const id = (await backups()).find((b) => b.target === file)?.id;
  const shown = (await call("/api/backups/preview", { method: "POST", body: { id } }))
    .json as RestorePreview;

  fixture.json("work/restore-stale/.claude/settings.json", { model: "haiku" });
  const restored = await call("/api/backups/restore", {
    method: "POST",
    body: { id, revision: shown.revision },
  });

  assertRefused(restored, 409, /changed since you reviewed this restore/);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).model, "haiku");
});

test("a deleted memory can be restored from recent changes, but not over a new file of that name", async () => {
  const store = memoryDirFor(fixture, fixture.at("work/recall"));
  const path = fixture.write(`${store}/old-note.md`, memoryFile("old-note", "project", "d", "b"));
  fixture.write(`${store}/MEMORY.md`, "- [old-note](old-note.md) — d\n");
  const { id } = (await deleteMemory(path)).json as Change;

  fixture.write(path, "a new memory with the same name\n");
  const blocked = (await call("/api/backups/preview", { method: "POST", body: { id } }))
    .json as RestorePreview;
  assert.ok(blocked.blocked);

  rmSync(path);
  const shown = (await call("/api/backups/preview", { method: "POST", body: { id } }))
    .json as RestorePreview;
  const restored = await call("/api/backups/restore", {
    method: "POST",
    body: { id, revision: shown.revision },
  });
  assert.equal(restored.status, 200);
  assert.match(readFileSync(path, "utf8"), /old-note/);
  assert.match(readFileSync(`${store}/MEMORY.md`, "utf8"), /old-note\.md/);
});

test("a memory put back from recent changes is listed as a change of its own", async () => {
  const store = memoryDirFor(fixture, fixture.at("work/recalled"));
  // Built with the platform separator, as the change Recent changes records is.
  const path = fixture.write(join(store, "note.md"), memoryFile("note", "project", "d", "b"));
  fixture.write(`${store}/MEMORY.md`, "- [note](note.md) — d\n");
  const deleted = (await deleteMemory(path)).json as Change;

  assert.equal((await undo(deleted)).status, 200);
  const restore = (await backups()).find((b) => b.kind === "memory-restore" && b.target === path);
  assert.ok(restore, "the re-created memory is in recent changes");
  assert.equal(restore.created, true);
  const preview = (await call("/api/backups/preview", { method: "POST", body: { id: restore.id } }))
    .json as RestorePreview;
  assert.match(preview.blocked ?? "", /delete the memory again/);
});

test("Recent changes names the directory a memory is saved for, for its delete and for putting it back", async () => {
  // Catches the directory not being kept with the change: a store's folder name cannot be read back
  // into a path, so Recent changes would show ~/.claude/projects/<name>/memory instead.
  const project = fixture.at("work/named");
  const store = memoryDirFor(fixture, project);
  const path = fixture.write(join(store, "note.md"), memoryFile("note", "project", "d", "b"));
  fixture.write(join(store, "MEMORY.md"), "- [note](note.md) — d\n");

  const deleted = (await changeMemory("delete", path, project)).json as Change;
  assert.equal((await undo(deleted)).status, 200);

  const changes = (await backups()).filter((b) => b.target.startsWith(store));
  assert.deepEqual(changes.map((b) => [b.kind, b.projectPath]).sort(), [
    ["memory-delete", project],
    ["memory-index", project],
    ["memory-restore", project],
  ]);
});

test("a memory change naming a directory its memory is not saved for goes ahead without naming it", async () => {
  // Catches a wrong directory blocking the change, as with a store CLAUDE_CODE_PROJECT_DIR_NAME
  // names, or being shown in Recent changes as where the memory was saved.
  const { old } = seedMemory();

  const res = await changeMemory("delete", old, fixture.at("work/other"));

  assert.equal(res.status, 200);
  assert.equal(existsSync(old), false);
  const change = (await backups()).find((b) => b.id === (res.json as Change).id);
  assert.equal(change?.projectPath, undefined);
});

test("a delete that stopped halfway after Claude rewrote the memory can still put its MEMORY.md line back", async () => {
  const store = memoryDirFor(fixture, fixture.at("work/halfway"));
  const path = fixture.write(`${store}/note.md`, memoryFile("note", "project", "d", "b"));
  const line = "- [note](note.md) — d";
  fixture.write(`${store}/MEMORY.md`, `- [Other](other.md) — o\n${line}\n`);
  const { id } = (await deleteMemory(path)).json as Change;
  // As the delete leaves things when Claude rewrites the memory while ccdesk removes it, and also
  // rewrites MEMORY.md, so the line cannot be put back: the memory stays and the record is partial.
  const rewritten = memoryFile("note", "project", "d", "rewritten by Claude");
  fixture.write(path, rewritten);
  fixture.write(`${store}/MEMORY.md`, "- [Other](other.md) — o\n- [New](new.md) — n\n");
  const manifest = join(fixture.env.claudeDir, "backups", "ccdesk", id, "ccdesk-backup.json");
  writeFileSync(
    manifest,
    JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf8")), after: "partial" })
  );

  const preview = (await call("/api/backups/preview", { method: "POST", body: { id } }))
    .json as RestorePreview;
  assert.equal(preview.blocked, undefined);
  assert.deepEqual(preview.indexLines, [line]);
  assert.equal(preview.before, preview.after, "the memory itself is not changed");
  const restored = await call("/api/backups/restore", {
    method: "POST",
    body: { id, revision: preview.revision },
  });
  assert.equal(restored.status, 200);
  assert.equal(readFileSync(path, "utf8"), rewritten);
  assert.equal(
    readFileSync(`${store}/MEMORY.md`, "utf8"),
    `- [Other](other.md) — o\n- [New](new.md) — n\n${line}\n`
  );
});

test("a backup id cannot reach outside the backup folder", async () => {
  const res = await call("/api/backups/preview", { method: "POST", body: { id: "../../etc" } });
  assertRefused(res, 409, /gone or was not made by ccdesk/);
});

/** Reviews a restore, then makes it with the reviewed revision, as Recent changes does. */
async function restoreReviewed(id: string) {
  const preview = (await call("/api/backups/preview", { method: "POST", body: { id } }))
    .json as RestorePreview;
  const res = await call("/api/backups/restore", {
    method: "POST",
    body: { id, revision: preview.revision },
  });
  return { preview, res };
}

test("undoing a save that created a file removes it, and the removal can be undone too", async () => {
  const dir = fixture.at("work/fresh");
  fixture.write("work/fresh/README.md", "x");
  const file = join(dir, ".claude", "settings.json");

  const saved = await saveSetting({ dir, scope: "project", key: "model", value: "opus" });
  const { id, created } = saved.json as Change;
  const text = readFileSync(file, "utf8");
  assert.equal(created, true);
  assert.equal((await backups()).find((b) => b.id === id)?.created, true);

  const removal = await restoreReviewed(id);
  assert.equal(removal.preview.removes, true);
  assert.equal(removal.preview.after, "");
  assert.equal(removal.res.status, 200);
  assert.equal(existsSync(file), false);

  const record = (await backups()).find((b) => b.target === file && b.id !== id);
  assert.ok(record, "the removal is in recent changes");
  assert.equal(record.created, false);
  assert.equal((await restoreReviewed(record.id)).res.status, 200);
  assert.equal(readFileSync(file, "utf8"), text);
});

test("a file ccdesk created is not removed once something else changed it", async () => {
  const dir = fixture.at("work/fresh-edited");
  fixture.write("work/fresh-edited/README.md", "x");
  const file = join(dir, ".claude", "settings.json");
  const { id } = (await saveSetting({ dir, scope: "project", key: "model", value: "opus" }))
    .json as Change;
  writeFileSync(file, '{ "model": "opus", "effortLevel": "high" }\n');

  const { preview, res } = await restoreReviewed(id);

  assert.match(preview.blocked ?? "", /changed after ccdesk created it/);
  assertRefused(res, 409, /changed after ccdesk created it/);
  assert.equal(readFileSync(file, "utf8"), '{ "model": "opus", "effortLevel": "high" }\n');
});

test("comparing two directories lists each key's value in both, with the files they come from", async () => {
  const a = fixture.at("work/compare-a");
  const b = fixture.at("work/compare-b");
  const aProject = fixture.json("work/compare-a/.claude/settings.json", {
    model: "opus",
    effortLevel: "high",
  });
  fixture.json("work/compare-b/.claude/settings.json", {
    model: "haiku",
    effortLevel: "high",
    env: { TOKEN: "compare-secret" },
  });
  const bLocal = fixture.json("work/compare-b/.claude/settings.local.json", { model: "sonnet" });

  const res = await call(`/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const { settings } = res.json as {
    settings: Array<{
      key: string;
      same: boolean;
      a: { value: unknown; sources: Array<{ scope: string; path: string }> } | null;
      b: { value: unknown; sources: Array<{ scope: string; path: string }> } | null;
    }>;
  };
  const byKey = new Map(settings.map((s) => [s.key, s]));

  assert.equal(res.status, 200);
  assert.deepEqual(byKey.get("model"), {
    key: "model",
    same: false,
    a: { value: "opus", sources: [{ scope: "project", path: aProject }] },
    b: { value: "sonnet", sources: [{ scope: "local", path: bLocal }] },
  });
  assert.equal(byKey.get("effortLevel")?.same, true);
  assert.equal(byKey.get("env")?.same, false);
  assert.equal(byKey.get("env")?.a, null);
  assert.doesNotMatch(JSON.stringify(res.json), /compare-secret/);
  const relative = await call("/api/compare?a=work&b=other");
  assertRefused(relative, 400, /a must be an absolute path/);
});

test("hidden values that differ compare as different, without either value in the answer", async () => {
  const a = fixture.at("work/compare-hidden-a");
  const b = fixture.at("work/compare-hidden-b");
  const c = fixture.at("work/compare-hidden-c");
  fixture.json("work/compare-hidden-a/.claude/settings.json", { env: { API_TOKEN: "fake-one" } });
  fixture.json("work/compare-hidden-b/.claude/settings.json", { env: { API_TOKEN: "fake-two" } });
  fixture.json("work/compare-hidden-c/.claude/settings.json", { env: { API_TOKEN: "fake-one" } });
  const d = fixture.at("work/compare-hidden-d");
  fixture.json("work/compare-hidden-d/.claude/settings.json", {
    env: { API_TOKEN: "fake-one", REGION: "eu" },
  });
  const compare = async (x: string, y: string) => {
    const res = await call(`/api/compare?a=${encodeURIComponent(x)}&b=${encodeURIComponent(y)}`);
    assert.doesNotMatch(JSON.stringify(res.json), /fake-one|fake-two/);
    const { settings } = res.json as {
      settings: Array<{ key: string; same: boolean; hiddenDiffers?: boolean }>;
    };
    return settings.find((s) => s.key === "env");
  };

  const differ = await compare(a, b);
  assert.equal(differ?.same, false);
  assert.equal(differ?.hiddenDiffers, true);
  const alike = await compare(a, c);
  assert.equal(alike?.same, true);
  assert.equal(alike?.hiddenDiffers, undefined);
  // Values that differ as shown too need no note.
  const shown = await compare(a, d);
  assert.equal(shown?.same, false);
  assert.equal(shown?.hiddenDiffers, undefined);
});

test("settings that differ only in the order of their keys compare the same", async () => {
  const a = fixture.at("work/compare-order-a");
  const b = fixture.at("work/compare-order-b");
  fixture.json("work/compare-order-a/.claude/settings.json", {
    permissions: { allow: ["Bash"], deny: ["Read"] },
  });
  fixture.json("work/compare-order-b/.claude/settings.json", {
    permissions: { deny: ["Read"], allow: ["Bash"] },
  });

  const res = await call(`/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const { settings } = res.json as { settings: Array<{ key: string; same: boolean }> };

  assert.equal(settings.find((s) => s.key === "permissions")?.same, true);
});

test("a permission rule is moved in the file it is in, and a rule that is gone is not", async () => {
  const dir = fixture.at("work/perms");
  const file = fixture.json("work/perms/.claude/settings.json", {
    permissions: { allow: ["Bash(npm test:*)", "Read"] },
  });
  const edit = {
    dir,
    file,
    remove: { list: "allow", rule: "Bash(npm test:*)" },
    add: { list: "deny", rule: "Bash(npm test:*)" },
  };
  const { revision } = (await call("/api/permissions/preview", { method: "POST", body: edit }))
    .json as Preview;

  fixture.json("work/perms/.claude/settings.json", {
    permissions: { allow: ["Bash(npm test:*)", "Read", "Edit"] },
  });
  const stale = await call("/api/permissions/save", {
    method: "POST",
    body: { ...edit, revision },
  });
  // Refused, so the rule added meanwhile is not lost.
  assertRefused(stale, 409, /changed since you reviewed this edit/);

  const fresh = (await call("/api/permissions/preview", { method: "POST", body: edit }))
    .json as Preview;
  const saved = await call("/api/permissions/save", {
    method: "POST",
    body: { ...edit, revision: fresh.revision },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).permissions, {
    allow: ["Read", "Edit"],
    deny: ["Bash(npm test:*)"],
  });

  const again = await call("/api/permissions/preview", { method: "POST", body: edit });
  assertRefused(again, 409, /is no longer in allow in this file/);
});

test("an edit cannot name an inherited object key or a settings file Claude Code does not read", async () => {
  const dir = fixture.at("work/proto");
  fixture.json("work/proto/.claude/settings.json", {});
  const proto = await call("/api/settings/preview", {
    method: "POST",
    body: { dir, scope: "project", key: "__proto__", value: {} },
  });
  const elsewhere = await call("/api/permissions/preview", {
    method: "POST",
    body: { dir, file: fixture.at("home/.bashrc"), add: { list: "allow", rule: "Read" } },
  });

  assertRefused(proto, 409, /__proto__ is not in Claude Code's settings schema/);
  assertRefused(elsewhere, 409, /not a settings file Claude Code reads here/);
});

test("a settings file that links to the credentials file is never written", async () => {
  const credentials = fixture.write(freshCredentials(), '{"token":"x"}');
  fixture.link("work/sneaky/.claude/settings.json", credentials);

  const edit = { dir: fixture.at("work/sneaky"), scope: "project", key: "model", value: "opus" };
  const preview = await call("/api/settings/preview", { method: "POST", body: edit });
  const save = await call("/api/settings/save", {
    method: "POST",
    body: { ...edit, revision: revisionOf('{"token":"x"}') },
  });

  assertRefused(preview, 409, /does not read or change Claude Code's credentials/);
  assertRefused(save, 409, /does not read or change Claude Code's credentials/);
  assert.equal(readFileSync(credentials, "utf8"), '{"token":"x"}');
});

test("a settings file with another hard link is not saved, so the two names keep one text", async () => {
  const shared = fixture.json("dotfiles/settings.json", { model: "sonnet" });
  const settings = fixture.at("work/hardlink-settings/.claude/settings.json");
  fixture.write("work/hardlink-settings/.claude/.keep", "");
  linkSync(shared, settings);
  const untouched = readFileSync(shared, "utf8");

  const res = await saveSetting({
    dir: fixture.at("work/hardlink-settings"),
    scope: "project",
    key: "model",
    value: "opus",
  });

  assertRefused(res, 409, /hard links/);
  assert.equal(readFileSync(settings, "utf8"), untouched);
  assert.equal(lstatSync(settings).ino, lstatSync(shared).ino);
});

test("a settings file that links to ~/.claude.json is never written", async () => {
  const state = fixture.json("home/.claude.json", { projects: {} });
  fixture.link("work/state-link/.claude/settings.json", state);
  const edit = {
    dir: fixture.at("work/state-link"),
    scope: "project",
    key: "model",
    value: "opus",
  };

  const saved = await saveSetting(edit);

  assertRefused(saved, 409, /does not change ~\/\.claude\.json/);
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")), { projects: {} });
});

test("a MEMORY.md that links outside its memory folder is never rewritten", async () => {
  const notes = fixture.write("work/notes.md", "my own notes\n");
  const dir = memoryDirFor(fixture, "/work/escaping");
  fixture.link(`${dir}/MEMORY.md`, notes);
  const lost = fixture.write(`${dir}/lost.md`, memoryFile("lost", "project", "gone", "y"));

  const res = await changeMemory("add", lost);

  assertRefused(res, 409, /links outside its memory folder/);
  assert.equal(readFileSync(notes, "utf8"), "my own notes\n");
});

test("a memory change review hides env values like every other view", async () => {
  const dir = memoryDirFor(fixture, "/work/json-memory");
  fixture.write(`${dir}/MEMORY.md`, "");
  const odd = fixture.write(`${dir}/odd.md`, '{"env":{"API_KEY":"memory-secret"}}');

  const preview = await previewMemory("delete", odd);

  assert.equal(preview.status, 200);
  assert.doesNotMatch(JSON.stringify(preview.json), /memory-secret/);
});

test("adding a memory to MEMORY.md is refused when its description changed after review", async () => {
  const dir = memoryDirFor(fixture, "/work/renamed");
  fixture.write(`${dir}/MEMORY.md`, "");
  const lost = fixture.write(`${dir}/lost.md`, memoryFile("lost", "project", "first", "y"));
  const { revision } = (await previewMemory("add", lost)).json as { revision: string };

  fixture.write(lost, memoryFile("lost", "project", "second", "y"));
  const res = await call("/api/memory/change", {
    method: "POST",
    body: { action: "add", path: lost, revision },
  });

  assertRefused(res, 409, /changed since you reviewed this/);
  assert.equal(readFileSync(`${dir}/MEMORY.md`, "utf8"), "");
});

test("restoring a MEMORY.md backup never writes through a link out of its memory folder", async () => {
  const dir = memoryDirFor(fixture, "/work/restore-escape");
  fixture.write(`${dir}/MEMORY.md`, "");
  const lost = fixture.write(`${dir}/lost.md`, memoryFile("lost", "project", "gone", "y"));
  const { id } = (await changeMemory("add", lost)).json as Change;
  const notes = fixture.write("work/my-notes.md", "my own notes\n");
  rmSync(`${dir}/MEMORY.md`);
  fixture.link(`${dir}/MEMORY.md`, notes);

  const preview = await call("/api/backups/preview", { method: "POST", body: { id } });
  const restore = await call("/api/backups/restore", {
    method: "POST",
    body: { id, revision: revisionOf("my own notes\n") },
  });

  assertRefused(preview, 409, /links outside its memory folder/);
  assertRefused(restore, 409, /links outside its memory folder/);
  assert.equal(readFileSync(notes, "utf8"), "my own notes\n");
});

test("a settings link that ends at ~/.claude.json's real file is never written", async () => {
  // ~/.claude.json kept in a dotfiles folder, and a project's settings linked to that same file.
  const state = fixture.json("dotfiles/claude-state.json", { projects: {} });
  rmSync(fixture.env.claudeJson, { force: true });
  fixture.link(fixture.rel(fixture.env.claudeJson), state);
  fixture.link("work/state-alias/.claude/settings.json", state);
  const edit = { dir: fixture.at("work/state-alias"), scope: "project", key: "model", value: "x" };

  const saved = await saveSetting(edit);

  rmSync(fixture.env.claudeJson);
  assertRefused(saved, 409, /does not change ~\/\.claude\.json/);
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")), { projects: {} });
});

test("env values in settings linked from a file without .json never reach the page", async () => {
  const dir = fixture.at("work/dotlinked");
  const settings = fixture.write(
    "work/dotlinked/dotfiles/claude-settings",
    '{"env":{"API_KEY":"dot-secret"}}'
  );
  fixture.link("work/dotlinked/settings-link", settings);
  fixture.write("work/dotlinked/CLAUDE.md", "See @settings-link\n");

  const view = await call(`/api/directory?path=${encodeURIComponent(dir)}`);

  assert.equal(view.status, 200);
  assert.match(JSON.stringify(view.json), /API_KEY/);
  assert.doesNotMatch(JSON.stringify(view.json), /dot-secret/);
});

test("env values never reach the page through an import or a settings file that is not valid JSON", async () => {
  const dir = fixture.at("work/leaky");
  fixture.json("work/leaky/.claude/settings.json", { env: { API_KEY: "imported-secret" } });
  fixture.write("work/leaky/CLAUDE.md", "See @.claude/settings.json\n");
  fixture.write("work/leaky/.claude/settings.local.json", '{"env": {"TOKEN": broken-secret}}');

  const view = await call(`/api/directory?path=${encodeURIComponent(dir)}`);
  const preview = await call("/api/settings/preview", {
    method: "POST",
    body: { dir, scope: "local", key: "model", value: "opus" },
  });

  assert.equal(view.status, 200);
  assert.doesNotMatch(JSON.stringify(view.json), /imported-secret|broken-secret/);
  assert.doesNotMatch(JSON.stringify(preview.json), /broken-secret/);
});

test("a restore that would put back an env value changed since the backup is refused", async () => {
  const dir = fixture.at("work/rotated");
  const file = fixture.json("work/rotated/.claude/settings.json", {
    model: "opus",
    env: { API_KEY: "old" },
  });
  const saved = (await saveSetting({ dir, scope: "project", key: "model", value: "sonnet" }))
    .json as Change;
  fixture.json("work/rotated/.claude/settings.json", { model: "sonnet", env: { API_KEY: "new" } });

  const preview = (await call("/api/backups/preview", { method: "POST", body: { id: saved.id } }))
    .json as RestorePreview;
  const res = await call("/api/backups/restore", {
    method: "POST",
    body: { id: saved.id, revision: preview.revision },
  });

  assert.ok(preview.blocked);
  assertRefused(res, 409, /Hidden values in this file .* changed since the backup/);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).env.API_KEY, "new");
});

test("a settings file broken since its backup can be restored from it", async () => {
  const dir = fixture.at("work/broken");
  const file = fixture.json("work/broken/.claude/settings.json", { env: { API_KEY: "kept" } });
  const saved = (await saveSetting({ dir, scope: "project", key: "model", value: "opus" }))
    .json as Change;
  fixture.write("work/broken/.claude/settings.json", "{ not json");

  const preview = (await call("/api/backups/preview", { method: "POST", body: { id: saved.id } }))
    .json as RestorePreview;
  const res = await call("/api/backups/restore", {
    method: "POST",
    body: { id: saved.id, revision: preview.revision },
  });

  assert.equal(preview.blocked, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { env: { API_KEY: "kept" } });
});

test("adding a permission rule the file already has changes nothing", async () => {
  const dir = fixture.at("work/perms-same");
  const file = fixture.json("work/perms-same/.claude/settings.json", {
    permissions: { allow: ["Read"] },
  });
  const untouched = readFileSync(file, "utf8");

  const res = await call("/api/permissions/preview", {
    method: "POST",
    body: { dir, file, add: { list: "allow", rule: "Read" } },
  });

  assertRefused(res, 409, /already says that/);
  assert.equal(readFileSync(file, "utf8"), untouched);
});

test("undoing a memory delete is refused when MEMORY.md changed since", async () => {
  const { dir, old } = seedMemory();
  const deleted = (await deleteMemory(old)).json as Change;
  fixture.write(
    `${dir}/MEMORY.md`,
    "- [Keep](keep.md) — stays\n- [New](new.md) — added by Claude\n"
  );

  assertRefused(await undo(deleted), 409, /changed since you reviewed this restore/);
  assert.equal(existsSync(old), false);
});

test("backups are readable only by you, since settings can hold secrets", {
  skip: process.platform === "win32",
}, async () => {
  const dir = fixture.at("work/private");
  fixture.json("work/private/.claude/settings.json", { env: { API_KEY: "s" } });
  const saved = (await saveSetting({ dir, scope: "project", key: "model", value: "opus" }))
    .json as Change;

  const folder = join(fixture.env.claudeDir, "backups", "ccdesk", saved.id);
  assert.equal(lstatSync(folder).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(folder, "before")).mode & 0o777, 0o600);
});

test("a key in an MCP server's URL never reaches the page", async () => {
  const dir = fixture.at("work/remote-mcp");
  fixture.json("work/remote-mcp/.mcp.json", {
    mcpServers: {
      docs: {
        type: "http",
        url: "https://me:pass-secret@mcp.example.com/mcp?api_key=query-secret",
      },
    },
  });

  const view = await call(`/api/directory?path=${encodeURIComponent(dir)}`);

  assert.doesNotMatch(JSON.stringify(view.json), /pass-secret|query-secret/);
  assert.match(JSON.stringify(view.json), /mcp\.example\.com\/mcp/);
});

test("a key in a URL inside settings never reaches the page, its diffs or its restores", async () => {
  const dir = fixture.at("work/url-settings");
  fixture.json("work/url-settings/.claude/settings.json", {
    managedMcpServers: { docs: { type: "http", url: "https://mcp.example.com/mcp?key=s-secret" } },
  });

  const view = await call(`/api/directory?path=${encodeURIComponent(dir)}`);
  const saved = await saveSetting({ dir, scope: "project", key: "model", value: "opus" });
  const restore = await call("/api/backups/preview", {
    method: "POST",
    body: { id: (saved.json as Change).id },
  });

  assert.equal(saved.status, 200);
  for (const res of [view, restore]) assert.doesNotMatch(JSON.stringify(res.json), /s-secret/);
});

test("credentials that are themselves a link are never read through another link", async () => {
  fixture.write("home/.claude/tokens.json", '{"accessToken":"oauth-secret"}');
  const credentials = freshCredentials();
  fixture.link(credentials, join(fixture.env.claudeDir, "tokens.json"));
  fixture.link("work/linked-creds/CLAUDE.md", credentials);

  const view = await call(
    `/api/directory?path=${encodeURIComponent(fixture.at("work/linked-creds"))}`
  );

  assert.equal(view.status, 200);
  assert.doesNotMatch(JSON.stringify(view.json), /oauth-secret/);
});

test("credentials hard-linked under another name are never read, changed or removed", async () => {
  const token = '{"accessToken":"hardlinked-secret"}';
  const credentials = fixture.write(freshCredentials(), token);
  const claudeMd = fixture.at("work/hardlinked/CLAUDE.md");
  const settings = fixture.at("work/hardlinked/.claude/settings.json");
  const memory = join(memoryDirFor(fixture, fixture.at("work/hardlinked")), "notes.md");
  fixture.write(join(memoryDirFor(fixture, fixture.at("work/hardlinked")), "MEMORY.md"), "");
  fixture.write("work/hardlinked/.claude/.keep", "");
  for (const path of [claudeMd, settings, memory]) linkSync(credentials, path);

  const view = await call(
    `/api/directory?path=${encodeURIComponent(fixture.at("work/hardlinked"))}`
  );
  const edit = { dir: fixture.at("work/hardlinked"), scope: "project", key: "model", value: "x" };
  const save = await call("/api/settings/save", {
    method: "POST",
    body: { ...edit, revision: revisionOf(token) },
  });
  const removal = await call("/api/memory/change", {
    method: "POST",
    body: { action: "delete", path: memory, revision: revisionOf(token) },
  });
  const opening = await call("/api/open", { method: "POST", body: { path: claudeMd } });

  assert.equal(view.status, 200);
  assert.doesNotMatch(JSON.stringify(view.json), /hardlinked-secret/);
  assertRefused(save, 409, /does not read or change Claude Code's credentials/);
  assertRefused(removal, 409, /does not read or change Claude Code's credentials/);
  assertRefused(opening, 409, /does not open credentials/);
  for (const path of [credentials, claudeMd, settings, memory])
    assert.equal(readFileSync(path, "utf8"), token);
});

interface ScannedHook {
  event: string;
  matcher?: string;
  command: string;
  sourcePath: string;
  at: { group: number; index: number };
  definition: unknown;
}

async function hooksIn(dir: string): Promise<ScannedHook[]> {
  const view = await call(`/api/directory?path=${encodeURIComponent(dir)}`);
  return (view.json as { inventory: { hooks: ScannedHook[] } }).inventory.hooks;
}

/** Reviews a hook change, then saves it with the reviewed revision, as the page does. */
async function saveHook(edit: Record<string, unknown>) {
  const preview = await call("/api/hooks/preview", { method: "POST", body: edit });
  if (preview.status !== 200) return preview;
  const { revision } = preview.json as Preview;
  return call("/api/hooks/save", { method: "POST", body: { ...edit, revision } });
}

const command = (text: string) => ({ type: "command", command: text });

test("a new hook joins the group with its matcher, or starts one", async () => {
  const dir = fixture.at("work/hooks-add");
  const file = fixture.json("work/hooks-add/.claude/settings.json", {
    model: "opus",
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [command("lint")] }] },
  });

  for (const [matcher, text] of [
    ["Bash", "audit"],
    ["Edit", "fmt"],
  ] as const) {
    const saved = await saveHook({
      dir,
      file,
      add: { event: "PreToolUse", matcher, definition: command(text) },
    });
    assert.equal(saved.status, 200);
  }
  assert.equal(
    (await saveHook({ dir, file, add: { event: "Stop", definition: command("bell") } })).status,
    200
  );

  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    model: "opus",
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [command("lint"), command("audit")] },
        { matcher: "Edit", hooks: [command("fmt")] },
      ],
      Stop: [{ hooks: [command("bell")] }],
    },
  });
});

test("an edited hook stays in place, and one moved to another matcher leaves no empty group", async () => {
  const dir = fixture.at("work/hooks-edit");
  const file = fixture.json("work/hooks-edit/.claude/settings.json", {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [command("one"), command("two")] },
        { matcher: "Edit", hooks: [command("three")] },
      ],
    },
  });
  const find = async (text: string) => {
    const hook = (await hooksIn(dir)).find((h) => h.sourcePath === file && h.command === text);
    assert.ok(hook, text);
    return { event: hook.event, at: hook.at, definition: hook.definition };
  };

  const edited = await saveHook({
    dir,
    file,
    remove: await find("one"),
    add: { event: "PreToolUse", matcher: "Bash", definition: { ...command("one"), timeout: 5 } },
  });
  assert.equal(edited.status, 200);
  const moved = await saveHook({
    dir,
    file,
    remove: await find("three"),
    add: { event: "PreToolUse", matcher: "Bash", definition: command("three") },
  });
  assert.equal(moved.status, 200);

  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).hooks, {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ ...command("one"), timeout: 5 }, command("two"), command("three")],
      },
    ],
  });
  const removed = await saveHook({ dir, file, remove: await find("two") });
  assert.equal(removed.status, 200);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).hooks.PreToolUse[0].hooks.length, 2);
});

test("a hook that changed in the file since the scan is not removed", async () => {
  const dir = fixture.at("work/hooks-stale");
  const file = fixture.json("work/hooks-stale/.claude/settings.json", {
    hooks: { Stop: [{ hooks: [command("bell")] }] },
  });
  const [hook] = await hooksIn(dir);
  assert.ok(hook);
  fixture.json("work/hooks-stale/.claude/settings.json", {
    hooks: { Stop: [{ hooks: [command("rm -rf build")] }] },
  });

  const res = await saveHook({
    dir,
    file,
    remove: { event: hook.event, at: hook.at, definition: hook.definition },
  });
  assertRefused(res, 409, /This hook changed in the file since ccdesk read it/);
  assert.match(readFileSync(file, "utf8"), /rm -rf build/);
});

test("a hook Claude Code's schema rejects, or an unknown event, is not saved", async () => {
  const dir = fixture.at("work/hooks-invalid");
  const file = fixture.json("work/hooks-invalid/.claude/settings.json", {});

  const preview = await call("/api/hooks/preview", {
    method: "POST",
    body: { dir, file, add: { event: "Stop", definition: { type: "command" } } },
  });
  assert.equal(preview.status, 200);
  assert.ok(
    (preview.json as Preview).errors.includes(
      "hooks.Stop.0.hooks.0 must have required property 'command'"
    ),
    "a command hook needs its command"
  );
  const unknown = await call("/api/hooks/preview", {
    method: "POST",
    body: { dir, file, add: { event: "BeforeLunch", definition: command("x") } },
  });
  assertRefused(unknown, 400, /BeforeLunch is not a hook event Claude Code knows/);
  assert.equal(readFileSync(file, "utf8"), "{}");
});

test("a hook that sends hidden header values is never rewritten, but others in its file can change", async () => {
  const dir = fixture.at("work/hooks-headers");
  const file = fixture.json("work/hooks-headers/.claude/settings.json", {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "http",
              url: "https://hooks.example/stop",
              headers: { Authorization: "s3cret" },
            },
          ],
        },
      ],
    },
  });

  const added = await saveHook({ dir, file, add: { event: "Stop", definition: command("bell") } });
  assert.equal(added.status, 200);
  assert.match(readFileSync(file, "utf8"), /s3cret/);

  const [http] = await hooksIn(dir);
  assert.ok(http);
  assert.equal((http.definition as { type?: string }).type, "http");
  const changed = await saveHook({
    dir,
    file,
    remove: { event: http.event, at: http.at, definition: http.definition },
    add: { event: "Stop", definition: { ...(http.definition as object), timeout: 5 } },
  });
  assertRefused(changed, 409, /sends header values ccdesk does not show/);
  assert.match(readFileSync(file, "utf8"), /s3cret/);
  assert.doesNotMatch(readFileSync(file, "utf8"), /•••/);
});

test("a hook is not replaced by one that sends header values ccdesk would hide", async () => {
  const dir = fixture.at("work/hooks-replace-secret");
  const file = fixture.json("work/hooks-replace-secret/.claude/settings.json", {
    hooks: { Stop: [{ hooks: [command("bell")] }] },
  });
  const untouched = readFileSync(file, "utf8");
  const [hook] = await hooksIn(dir);
  assert.ok(hook);

  const replaced = await saveHook({
    dir,
    file,
    remove: { event: hook.event, at: hook.at, definition: hook.definition },
    add: {
      event: "Stop",
      definition: {
        type: "http",
        url: "https://hooks.example/stop",
        headers: { Authorization: "s3cret" },
      },
    },
  });
  assertRefused(replaced, 409, /does not write header values it would then hide/);
  assert.equal(readFileSync(file, "utf8"), untouched);
});

test("changing the matcher of a hook alone in its group keeps the group where it is", async () => {
  const dir = fixture.at("work/hooks-matcher");
  const file = fixture.json("work/hooks-matcher/.claude/settings.json", {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [command("lint")] },
        { matcher: "Edit", hooks: [command("fmt")] },
      ],
      Stop: [{ hooks: [command("bell")] }],
    },
  });
  const [hook] = await hooksIn(dir);
  assert.equal(hook?.command, "lint");

  const saved = await saveHook({
    dir,
    file,
    remove: { event: hook.event, at: hook.at, definition: hook.definition },
    add: { event: "PreToolUse", matcher: "Bash|Monitor", definition: command("lint") },
  });
  assert.equal(saved.status, 200);
  const { hooks } = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(hooks), ["PreToolUse", "Stop"]);
  assert.deepEqual(
    hooks.PreToolUse.map((g: { matcher: string }) => g.matcher),
    ["Bash|Monitor", "Edit"]
  );
});

/** Reviews an MCP server change, then saves it with the reviewed revision, as the page does. */
async function saveMcp(edit: Record<string, unknown>) {
  const preview = await call("/api/mcp/preview", { method: "POST", body: edit });
  if (preview.status !== 200) return preview;
  const { revision } = preview.json as Preview;
  return call("/api/mcp/save", { method: "POST", body: { ...edit, revision } });
}

interface ScannedServer {
  name: string;
  scope: string;
  status: string;
  target: string;
  definition: unknown;
}

async function serversIn(dir: string): Promise<ScannedServer[]> {
  const view = await call(`/api/directory?path=${encodeURIComponent(dir)}`);
  return (view.json as { inventory: { mcpServers: ScannedServer[] } }).inventory.mcpServers;
}

test("a request body that is not well formed is answered 400, naming what is wrong", async () => {
  // Catches a route passing a malformed body on to the core, which then fails with a 500 or
  // counts and changes the wrong thing.
  const post = async (path: string, body: unknown) => {
    const res = await call(path, { method: "POST", body });
    return [res.status, (res.json as { error: string }).error];
  };

  assert.deepEqual(
    await post("/api/usage", {
      path: fixture.at("work"),
      rules: [{ list: "maybe", rule: "Bash" }],
    }),
    [400, "rules.0.list must be equal to one of the allowed values: allow, ask, deny"]
  );
  assert.deepEqual(await post("/api/usage", { path: fixture.at("work"), rules: "Bash" }), [
    400,
    "rules must be array",
  ]);
  assert.deepEqual(await post("/api/backups/restore", { id: "x" }), [
    400,
    "must have required property 'revision'",
  ]);
  assert.deepEqual(await post("/api/memory/preview", { action: "delete" }), [
    400,
    "must have required property 'path'",
  ]);
  assert.deepEqual(await post("/api/open", { path: "CLAUDE.md" }), [
    400,
    "path must be an absolute path",
  ]);
});

test("paths in the address must be absolute", async () => {
  // Catches a relative directory being read from wherever the server was started.
  const error = async (path: string) => {
    const res = await call(path);
    return [res.status, (res.json as { error: string }).error];
  };
  assert.deepEqual(await error("/api/directory?path=work"), [400, "path must be an absolute path"]);
  assert.deepEqual(await error(`/api/path-test?dir=work&file=CLAUDE.md`), [
    400,
    "dir must be an absolute path",
  ]);
});

test("the directory route describes the session profile it is asked for", async () => {
  const dir = fixture.at("work/profile");
  fixture.json("work/profile/.mcp.json", { mcpServers: { docs: { command: "docs-mcp" } } });
  const status = async (query: string) => {
    const view = await call(`/api/directory?path=${encodeURIComponent(dir)}${query}`);
    return view.status === 200
      ? (view.json as { inventory: { mcpServers: ScannedServer[] } }).inventory.mcpServers[0]
          ?.status
      : view.status;
  };

  assert.equal(await status(""), "pending");
  assert.equal(await status("&profile=print"), "active");
  assert.equal(await status("&profile=headless"), 400);
});

test("a project server is added to .mcp.json, replaced in place, and the change can be undone", async () => {
  const dir = fixture.at("work/mcp-project");
  const file = fixture.json("work/mcp-project/.mcp.json", {
    mcpServers: { docs: { command: "docs-mcp" }, files: { command: "files-mcp" } },
  });

  const added = await saveMcp({
    dir,
    scope: "project",
    add: { name: "sentry", definition: { type: "http", url: "https://mcp.sentry.dev/mcp" } },
  });
  assert.equal(added.status, 200);
  const docs = (await serversIn(dir)).find((s) => s.name === "docs");
  assert.ok(docs);
  const replaced = await saveMcp({
    dir,
    scope: "project",
    remove: { name: "docs", definition: docs.definition },
    add: { name: "docs", definition: { command: "docs-mcp", args: ["--fast"] } },
  });
  assert.equal(replaced.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).mcpServers, {
    docs: { command: "docs-mcp", args: ["--fast"] },
    files: { command: "files-mcp" },
    sentry: { type: "http", url: "https://mcp.sentry.dev/mcp" },
  });

  assert.equal((await undo(replaced.json as Change)).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).mcpServers.docs, { command: "docs-mcp" });
});

test("a server that cannot start is not saved, and no name is taken twice", async () => {
  const dir = fixture.at("work/mcp-invalid");
  fixture.json("work/mcp-invalid/.mcp.json", { mcpServers: { docs: { command: "docs-mcp" } } });

  const noType = await call("/api/mcp/preview", {
    method: "POST",
    body: { dir, scope: "project", add: { name: "api", definition: { url: "https://x.example" } } },
  });
  assert.match((noType.json as Preview).errors.join(), /needs a "type"/);
  const taken = await saveMcp({
    dir,
    scope: "project",
    add: { name: "docs", definition: { command: "other" } },
  });
  assertRefused(taken, 409, /already a server named docs/);
});

test("a server with hidden env values is not rewritten, but can be removed", async () => {
  const dir = fixture.at("work/mcp-secret");
  const file = fixture.json("work/mcp-secret/.mcp.json", {
    mcpServers: {
      db: { command: "db-mcp", env: { DB_PASSWORD: "s3cret" } },
      keep: { command: "k" },
    },
  });
  const db = (await serversIn(dir)).find((s) => s.name === "db");
  assert.ok(db);
  assert.doesNotMatch(JSON.stringify(db.definition), /s3cret/);

  const rewritten = await saveMcp({
    dir,
    scope: "project",
    remove: { name: "db", definition: db.definition },
    add: { name: "db", definition: db.definition },
  });
  assertRefused(rewritten, 409, /db has values ccdesk does not show/);
  assert.match(readFileSync(file, "utf8"), /s3cret/, "the password is never replaced by its mask");

  const removed = await saveMcp({
    dir,
    scope: "project",
    remove: { name: "db", definition: db.definition },
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).mcpServers, { keep: { command: "k" } });
});

test("keys in a server's args are hidden, and such a server is not rewritten", async () => {
  const dir = fixture.at("work/mcp-args");
  const args = [
    "-y",
    "some-mcp",
    "--api-key",
    "plain-flag-secret",
    "--token=equals-secret",
    "ghp_prefixsecret123",
    "--access-token",
    "access-secret",
    "--client-secret=client-value-secret",
    // mcp-remote's way to reach a remote server: the header's name stays, its value is hidden.
    "--header",
    "Authorization: Bearer header-secret",
    "--port",
    "8080",
  ];
  const file = fixture.json("work/mcp-args/.mcp.json", {
    mcpServers: { api: { command: "npx", args } },
  });
  const untouched = readFileSync(file, "utf8");
  // The values, not the flag names: --client-secret is shown.
  const SECRET_VALUES =
    /plain-flag-secret|equals-secret|prefixsecret|access-secret|client-value-secret|header-secret/;

  const view = await call(`/api/directory?path=${encodeURIComponent(dir)}`);
  const api = (await serversIn(dir)).find((s) => s.name === "api");
  assert.ok(api);
  const rewritten = await saveMcp({
    dir,
    scope: "project",
    remove: { name: "api", definition: api.definition },
    add: { name: "api", definition: api.definition },
  });
  const userAdd = await call("/api/mcp/preview", {
    method: "POST",
    body: { dir, scope: "user", add: { name: "new", definition: { command: "npx", args } } },
  });

  assert.doesNotMatch(JSON.stringify(view.json), SECRET_VALUES);
  assert.equal(
    api.target,
    "npx -y some-mcp --api-key ••• --token=••• ••• --access-token ••• --client-secret=••• --header Authorization: Bearer ••• --port 8080"
  );
  assertRefused(rewritten, 409, /api has values ccdesk does not show/);
  assert.equal(readFileSync(file, "utf8"), untouched);
  assert.equal(userAdd.status, 200);
  assert.doesNotMatch(JSON.stringify(userAdd.json), SECRET_VALUES);
});

test("a restore that would bring back a different key in a server's args is refused", async () => {
  const forms = {
    flag: (key: string) => ["some-mcp", "--api-key", key],
    header: (key: string) => [
      "mcp-remote",
      "https://x/mcp",
      "--header",
      `Authorization: Bearer ${key}`,
    ],
  };
  for (const [form, args] of Object.entries(forms)) {
    const dir = fixture.at(`work/mcp-args-restore-${form}`);
    const servers = (key: string) => ({ mcpServers: { api: { command: "npx", args: args(key) } } });
    const file = fixture.json(`work/mcp-args-restore-${form}/.mcp.json`, servers("old-key"));
    const added = await saveMcp({
      dir,
      scope: "project",
      add: { name: "docs", definition: { command: "docs-mcp" } },
    });
    assert.equal(added.status, 200);
    fixture.json(`work/mcp-args-restore-${form}/.mcp.json`, servers("rotated-key"));

    const { preview, res } = await restoreReviewed((added.json as Change).id);

    assert.doesNotMatch(JSON.stringify(preview), /old-key|rotated-key/);
    assert.match(preview.blocked ?? "", /Hidden values/);
    assertRefused(res, 409, /Hidden values in this file .* changed since the backup/);
    assert.match(readFileSync(file, "utf8"), /rotated-key/);
  }
});

test("user and local servers are changed through claude mcp, never by writing ~/.claude.json", async () => {
  const dir = fixture.at("work/mcp-local");
  fixture.write("work/mcp-local/README.md", "x");
  fixture.write(
    fixture.env.claudeJson,
    JSON.stringify({
      mcpServers: { notes: { command: "notes-mcp" } },
      projects: { [dir]: { mcpServers: { db: { command: "db-mcp" } } } },
    })
  );
  const untouched = readFileSync(fixture.env.claudeJson, "utf8");

  const replaced = await saveMcp({
    dir,
    scope: "local",
    remove: { name: "db", definition: { command: "db-mcp" } },
    add: { name: "db", definition: { command: "db-mcp", args: ["--ro"] } },
  });
  assert.equal(replaced.status, 200);
  assert.equal(
    (replaced.json as Partial<Change>).id,
    undefined,
    "a change made through claude mcp has no undo in ccdesk"
  );
  const added = await saveMcp({
    dir,
    scope: "user",
    // Names go after "--", so claude reads one like --help as a name and not as an option.
    add: { name: "--help", definition: { type: "http", url: "https://web.example/mcp" } },
  });
  assert.equal(added.status, 200);

  assert.deepEqual(claudeRuns, [
    { args: ["mcp", "remove", "--scope", "local", "--", "db"], cwd: dir },
    {
      args: [
        "mcp",
        "add-json",
        "--scope",
        "local",
        "--",
        "db",
        '{"command":"db-mcp","args":["--ro"]}',
      ],
      cwd: dir,
    },
    {
      args: [
        "mcp",
        "add-json",
        "--scope",
        "user",
        "--",
        "--help",
        '{"type":"http","url":"https://web.example/mcp"}',
      ],
      cwd: fixture.env.home,
    },
  ]);
  assert.equal(readFileSync(fixture.env.claudeJson, "utf8"), untouched);
});

/** Every file in a backup folder, read as text. */
function backupFiles(id: string): string {
  const dir = join(fixture.env.claudeDir, "backups", "ccdesk", id);
  return readdirSync(dir)
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

test("claude mcp edits are listed in recent changes with values hidden, and are not undone by ccdesk", async () => {
  const dir = fixture.at("work/mcp-recorded");
  fixture.write("work/mcp-recorded/README.md", "x");
  fixture.write(
    fixture.env.claudeJson,
    JSON.stringify({
      mcpServers: { api: { command: "api-mcp", env: { TOKEN: "user-env-secret" } } },
    })
  );
  const removed = await saveMcp({
    dir,
    scope: "user",
    remove: { name: "api", definition: { command: "api-mcp", env: { TOKEN: "•••" } } },
  });
  const added = await saveMcp({
    dir,
    scope: "local",
    add: {
      name: "db",
      definition: { command: "db-mcp", args: ["--token", "local-arg-secret"] },
    },
  });
  assert.equal(removed.status, 200);
  assert.equal(added.status, 200);

  const recorded = (await backups()).filter((b) => b.kind === "mcp-claude").slice(0, 2);
  assert.equal(recorded.length, 2);
  const [addition, removal] = await Promise.all(
    recorded.map(
      async (b) =>
        (await call("/api/backups/preview", { method: "POST", body: { id: b.id } }))
          .json as RestorePreview
    )
  );
  assert.ok(addition && removal);
  assert.match(removal.before ?? "", /"api"[\s\S]*"TOKEN": "•••"/);
  assert.equal(removal.after, "{}\n");
  assert.deepEqual(removal.undoCommands, [
    `claude mcp add-json --scope user -- 'api' '{"command":"api-mcp","env":{"TOKEN":"•••"}}'`,
  ]);
  assert.equal(addition.before, "{}\n");
  assert.match(addition.after, /"db"[\s\S]*"•••"/);
  assert.deepEqual(addition.undoCommands, [
    `cd '${dir}' && claude mcp remove --scope local -- 'db'`,
  ]);
  for (const b of recorded) {
    assert.doesNotMatch(backupFiles(b.id), /user-env-secret|local-arg-secret/);
    const restore = await call("/api/backups/restore", {
      method: "POST",
      body: { id: b.id, revision: "any" },
    });
    assertRefused(restore, 409, /through claude mcp, so ccdesk cannot undo it/);
  }
});

test("a local server added from a repository subdirectory is added from the repository root", async () => {
  const root = fixture.at("work/mcp-monorepo");
  const dir = fixture.at("work/mcp-monorepo/apps/web");
  fixture.write("work/mcp-monorepo/apps/web/README.md", "x");
  fixture.git("work/mcp-monorepo", "init", "-q");
  fixture.write(
    fixture.env.claudeJson,
    JSON.stringify({ projects: { [dir]: { mcpServers: { stale: { command: "stale" } } } } })
  );

  const added = await saveMcp({
    dir,
    scope: "local",
    add: { name: "db", definition: { command: "db" } },
  });

  assert.equal(added.status, 200);
  assert.deepEqual(
    claudeRuns.map((r) => r.cwd),
    [root]
  );
  const recorded = (await backups()).find((b) => b.kind === "mcp-claude");
  assert.ok(recorded);
  const preview = (
    await call("/api/backups/preview", { method: "POST", body: { id: recorded.id } })
  ).json as RestorePreview;
  assert.deepEqual(preview.undoCommands, [
    `cd '${root}' && claude mcp remove --scope local -- 'db'`,
  ]);
});

test("removing a user server is refused when its hidden values changed after the review", async () => {
  const dir = fixture.at("work/mcp-rotated");
  const servers = (token: string) =>
    JSON.stringify({ mcpServers: { api: { command: "api-mcp", env: { TOKEN: token } } } });
  fixture.write(fixture.env.claudeJson, servers("old-token"));
  const edit = {
    dir,
    scope: "user",
    remove: { name: "api", definition: { command: "api-mcp", env: { TOKEN: "•••" } } },
  };
  const preview = await call("/api/mcp/preview", { method: "POST", body: edit });
  assert.equal(preview.status, 200);

  // Another program rotates the token; the page shows the same server either way.
  fixture.write(fixture.env.claudeJson, servers("rotated-token"));
  const saved = await call("/api/mcp/save", {
    method: "POST",
    body: { ...edit, revision: (preview.json as Preview).revision },
  });
  assertRefused(saved, 409, /servers changed since you reviewed this edit/);
  assert.deepEqual(claudeRuns, [], "claude mcp remove did not run");
});

test("a replaced server goes back as it was when claude refuses the new one", async () => {
  const dir = fixture.at("work/mcp-rollback");
  fixture.write(
    fixture.env.claudeJson,
    JSON.stringify({ mcpServers: { notes: { command: "notes-mcp" } } })
  );
  failing.push("add-json");

  const refused = await saveMcp({
    dir,
    scope: "user",
    remove: { name: "notes", definition: { command: "notes-mcp" } },
    add: { name: "notes", definition: { command: "notes-mcp", args: ["--v2"] } },
  });
  assertRefused(refused, 409, /claude add-json failed/);
  assert.deepEqual(
    claudeRuns.map((r) =>
      r.args.slice(1).filter((a) => a !== "--scope" && a !== "user" && a !== "--")
    ),
    [
      ["remove", "notes"],
      ["add-json", "notes", '{"command":"notes-mcp","args":["--v2"]}'],
      ["add-json", "notes", '{"command":"notes-mcp"}'],
    ]
  );
});

// The command is run by sh, with a fake claude that prints where it ran and what it was given.
test("a replaced server that cannot be put back comes with a command that restores it exactly", {
  skip: process.platform === "win32",
}, async () => {
  const dir = fixture.at("work/mcp-lost");
  fixture.write("work/mcp-lost/README.md", "x");
  const original = { command: "node", args: ["-e", "console.log('hi')"] };
  fixture.write(
    fixture.env.claudeJson,
    JSON.stringify({ projects: { [dir]: { mcpServers: { notes: original } } } })
  );
  failing.push("add-json", "add-json");

  const refused = await saveMcp({
    dir,
    scope: "local",
    remove: { name: "notes", definition: original },
    add: { name: "notes", definition: { command: "node", args: ["--v2"] } },
  });
  assertRefused(refused, 409, /could not add it back/);
  const putBack = /put it back with: (.*) \(/.exec((refused.json as { error: string }).error)?.[1];
  assert.ok(putBack);

  chmodSync(fixture.write("bin/claude", '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n'), 0o755);
  const printed = execFileSync("sh", ["-c", putBack], {
    cwd: fixture.env.home,
    env: { ...process.env, PATH: `${fixture.at("bin")}:${process.env.PATH}` },
    encoding: "utf8",
  }).split("\n");
  // A local server belongs to its folder, so the command runs claude there.
  assert.equal(printed[0], dir);
  assert.deepEqual(printed.slice(1, 7), ["mcp", "add-json", "--scope", "local", "--", "notes"]);
  assert.deepEqual(JSON.parse(printed[7] ?? ""), original);
});

test("a server named __proto__ is kept when another server in .mcp.json changes", async () => {
  const dir = fixture.at("work/mcp-proto");
  // Written as text: an object literal with a __proto__ key would set its prototype instead.
  const file = fixture.write(
    "work/mcp-proto/.mcp.json",
    '{\n  "mcpServers": {\n    "__proto__": {\n      "command": "proto-mcp"\n    }\n  }\n}\n'
  );

  const preview = await call("/api/mcp/preview", {
    method: "POST",
    body: { dir, scope: "project", add: { name: "docs", definition: { command: "docs-mcp" } } },
  });
  assert.match((preview.json as Preview).after, /"__proto__"/);
  const saved = await saveMcp({
    dir,
    scope: "project",
    add: { name: "docs", definition: { command: "docs-mcp" } },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8")).mcpServers), [
    "__proto__",
    "docs",
  ]);
});

/** Reviews an agent change, then saves it with the reviewed revision, as the page does. */
async function saveAgent(edit: Record<string, unknown>) {
  const preview = await call("/api/agents/preview", { method: "POST", body: edit });
  if (preview.status !== 200) return preview;
  const { revision, errors } = preview.json as Preview;
  if (errors.length > 0) return preview;
  return call("/api/agents/save", { method: "POST", body: { ...edit, revision } });
}

const agentText = (name: string, prompt: string) =>
  `---\nname: ${name}\ndescription: Reviews diffs\n---\n\n${prompt}\n`;

test("a new agent goes in the project's agents folder, and a deleted one can be restored", async () => {
  const dir = fixture.at("work/agents");
  fixture.write("work/agents/README.md", "x");
  const created = await saveAgent({
    dir,
    create: { scope: "project", file: "reviewer" },
    text: agentText("reviewer", "Be strict."),
  });
  assert.equal(created.status, 200);
  const path = join(dir, ".claude", "agents", "reviewer.md");
  assert.equal(readFileSync(path, "utf8"), agentText("reviewer", "Be strict."));

  const edited = await saveAgent({ dir, path, text: agentText("reviewer", "Be kind.") });
  assert.equal(edited.status, 200);
  const deleted = await saveAgent({ dir, path, text: null });
  assert.equal(deleted.status, 200);
  assert.equal(existsSync(path), false);

  const { id } = deleted.json as Change;
  const preview = (await call("/api/backups/preview", { method: "POST", body: { id } }))
    .json as RestorePreview;
  const restored = await call("/api/backups/restore", {
    method: "POST",
    body: { id, revision: preview.revision },
  });
  assert.equal(restored.status, 200);
  assert.equal(readFileSync(path, "utf8"), agentText("reviewer", "Be kind."));
});

test("a project agent for a folder that no longer exists is refused, and the folder stays gone", async () => {
  const dir = fixture.at("work/agents-gone");
  const res = await saveAgent({
    dir,
    create: { scope: "project", file: "reviewer" },
    text: agentText("reviewer", "Be strict."),
  });
  assertRefused(res, 409, /is not a directory on this machine/);
  assert.equal(existsSync(dir), false);
});

test("a new agent's file name may be typed with .md, and gets only one", async () => {
  const dir = fixture.at("work/agents-md");
  fixture.write("work/agents-md/README.md", "x");
  const created = await saveAgent({
    dir,
    create: { scope: "project", file: "linter.md" },
    text: agentText("linter", "Check style."),
  });
  assert.equal(created.status, 200);
  assert.ok(existsSync(join(dir, ".claude", "agents", "linter.md")));
});

test("an agent file Claude Code would skip is not saved", async () => {
  const dir = fixture.at("work/agents-invalid");
  const skipped: [string, string][] = [
    ["---\ndescription: no name\n---\nx\n", "The frontmatter needs a name."],
    [
      "---\nname: plain\n---\nno description\n",
      "The frontmatter needs a description: when Claude should use this agent.",
    ],
    [
      agentText("my-plugin:reviewer", "a plugin-scoped name"),
      "A name has at most 256 characters, no ':' and does not start with '-'.",
    ],
  ];
  for (const [text, error] of skipped) {
    const res = await saveAgent({ dir, create: { scope: "user", file: "bad" }, text });
    assert.deepEqual((res.json as Preview).errors, [error], text);
  }
  assert.equal(existsSync(join(fixture.env.claudeDir, "agents", "bad.md")), false);
});

test("an agent is not saved with header values its review would hide", async () => {
  const dir = fixture.at("work/agents-secret");
  const text =
    "---\nname: api\ndescription: Calls the API\nmcpServers:\n  - api:\n      type: http\n      url: https://mcp.example.com\n      headers:\n        Authorization: s3cret\n---\n\nUse the API.\n";

  const res = await saveAgent({ dir, create: { scope: "user", file: "api" }, text });

  assert.equal(existsSync(join(fixture.env.claudeDir, "agents", "api.md")), false);
  assert.deepEqual((res.json as Preview).errors, [
    "ccdesk does not write env, header or URL values it would then hide; add them in your editor instead.",
  ]);
  assert.doesNotMatch(JSON.stringify(res.json), /s3cret/);
});

test("only agents shown here can be changed, and a new one cannot leave its agents folder", async () => {
  const dir = fixture.at("work/agents-confined");
  const other = fixture.write("work/elsewhere/notes.md", "keep me\n");

  const outside = await saveAgent({ dir, path: other, text: agentText("x", "y") });
  assertRefused(outside, 409, /That agent is no longer here/);
  const escaping = await saveAgent({
    dir,
    create: { scope: "user", file: "../../work/elsewhere/notes" },
    text: agentText("x", "y"),
  });
  assertRefused(escaping, 409, /A file name has letters, digits/);
  assert.equal(readFileSync(other, "utf8"), "keep me\n");
});

test("a directory whose folder is gone is forgotten through the API, but never the launch directory", async () => {
  const dir = "/work/forgotten-worktree";
  fixture.write(`${memoryDirFor(fixture, dir)}/note.md`, memoryFile("note", "user", "d", "x"));
  fixture.write(
    join(fixture.env.claudeDir, "projects", storeDirName(dir), "one.jsonl"),
    `${JSON.stringify({ type: "user", cwd: dir })}\n`
  );
  const listed = async () =>
    ((await call("/api/overview")).json as Overview).projects.map((p) => p.path);
  const launch = await call("/api/forget/preview", {
    method: "POST",
    body: { path: fixture.at("home") },
  });

  const preview = (await call("/api/forget/preview", { method: "POST", body: { path: dir } }))
    .json as ForgetPreview;
  const listedBefore = await listed();
  const forgot = await call("/api/forget/change", {
    method: "POST",
    body: { path: dir, revision: preview.revision },
  });
  const listedAfter = await listed();

  assertRefused(launch, 409, /started in this directory/);
  assert.equal(forgot.status, 200);
  assert.deepEqual([listedBefore.includes(dir), listedAfter.includes(dir)], [true, false]);
  const { res } = await restoreReviewed((forgot.json as Change).id);
  assert.equal(res.status, 200);
  assert.ok((await listed()).includes(dir));
});
