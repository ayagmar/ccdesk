import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { type AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { revisionOf } from "../src/server/scan/files.ts";
import { createCcdeskServer } from "../src/server/server.ts";
import { RefusedError } from "../src/server/write.ts";
import { type Fixture, makeFixture, memoryDirFor, memoryFile } from "./helpers/fixture.ts";

const TOKEN = "test-token";
interface Preview {
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
}
interface RestorePreview {
  before: string | null;
  after: string;
  revision: string;
  blocked?: string;
  indexLines?: string[];
}
let fixture: Fixture;
let server: ReturnType<typeof createCcdeskServer>;
let base: string;
const opened: string[] = [];
/** The claude commands ccdesk ran; each entry in failing makes the next such command fail once. */
const claudeRuns: Array<{ args: string[]; cwd: string }> = [];
const failing: string[] = [];

before(async () => {
  fixture = makeFixture();
  server = createCcdeskServer({
    env: fixture.env,
    launchDir: fixture.at("home"),
    token: TOKEN,
    uiDir: null,
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

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

/** Reviews a memory action, then makes it with the reviewed revision, as the page does. */
async function changeMemory(action: string, path: string) {
  const preview = await previewMemory(action, path);
  if (preview.status !== 200) return preview;
  const { revision } = preview.json as { revision: string };
  return call("/api/memory/change", { method: "POST", body: { action, path, revision } });
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
  assert.equal(res.status, 401);
});

test("requests addressed to another host name are refused (DNS rebinding)", async () => {
  const res = await call("/api/overview", { headers: { host: "evil.example:80" } });
  assert.equal(res.status, 421);
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

  assert.equal(res.status, 409);
  assert.match(readFileSync(old, "utf8"), /rewritten by Claude/);
});

test("only memory topic files can be deleted", async () => {
  const { dir } = seedMemory();
  const outside = fixture.write("home/.claude/settings.json", "{}");

  for (const path of [`${dir}/MEMORY.md`, outside, `${dir}/../../../settings.json`]) {
    const res = await deleteMemory(path);
    assert.equal(res.status, 409, path);
  }
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
  assert.equal(res.status, 403);
  assert.equal(existsSync(old), true);
});

test("a settings edit is previewed as a file change, then saved with a backup", async () => {
  const dir = fixture.at("work/site");
  const file = fixture.json("work/site/.claude/settings.json", { model: "sonnet" });
  const edit = { dir, scope: "project", key: "effortLevel", value: "high" };

  const preview = await call("/api/settings/preview", { method: "POST", body: edit });
  assert.equal(preview.status, 200);
  const { before, after, revision, errors } = preview.json as Preview;
  assert.deepEqual(errors, []);
  assert.deepEqual(JSON.parse(after), { model: "sonnet", effortLevel: "high" });
  assert.deepEqual(
    JSON.parse(readFileSync(file, "utf8")),
    JSON.parse(before ?? ""),
    "preview writes nothing"
  );

  const saved = await call("/api/settings/save", { method: "POST", body: { ...edit, revision } });
  assert.equal(saved.status, 200);
  assert.equal(readFileSync(file, "utf8"), after);
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
  assert.equal(saved.status, 409);
  assert.equal(readFileSync(file, "utf8"), "{}");
});

test("saving refuses when the file changed after it was reviewed", async () => {
  const dir = fixture.at("work/raced");
  const file = fixture.json("work/raced/.claude/settings.json", { model: "opus" });
  const edit = { dir, scope: "project", key: "model", value: "sonnet" };
  const preview = await call("/api/settings/preview", { method: "POST", body: edit });
  const { revision } = preview.json as Preview;

  fixture.json("work/raced/.claude/settings.json", { model: "haiku" });
  const saved = await call("/api/settings/save", { method: "POST", body: { ...edit, revision } });
  assert.equal(saved.status, 409);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { model: "haiku" });
});

test("settings ccdesk cannot see or may not change are refused", async () => {
  const dir = fixture.at("work/guarded");
  fixture.json("work/guarded/.claude/settings.json", { env: { TOKEN: "secret" } });
  const refused = [
    { scope: "project", key: "env", value: {} },
    { scope: "managed", key: "model", value: "opus" },
    { scope: "project", key: "notARealSetting", value: 1 },
    { scope: "local", key: "model", value: "opus", dir: fixture.at("work/missing") },
  ];
  for (const edit of refused) {
    const res = await call("/api/settings/preview", { method: "POST", body: { dir, ...edit } });
    assert.equal(res.status, 409, edit.key);
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

  const stale = await call("/api/memory/change", { method: "POST", body });
  assert.equal(stale.status, 409);
});

test("index changes are refused outside a memory folder's MEMORY.md", async () => {
  const target = fixture.write("home/.claude/CLAUDE.md", "keep me\n");

  const res = await changeMemory("remove-dead", target);

  assert.equal(res.status, 409);
  assert.equal(readFileSync(target, "utf8"), "keep me\n");
});

test("a file opens in the editor, but credentials and missing files do not", async () => {
  const file = fixture.write("home/.claude/CLAUDE.md", "x\n");
  const credentials = fixture.write("home/.claude/.credentials.json", "{}");

  const ok = await call("/api/open", { method: "POST", body: { path: file } });
  const secret = await call("/api/open", { method: "POST", body: { path: credentials } });
  const missing = await call("/api/open", {
    method: "POST",
    body: { path: fixture.at("home/nope.md") },
  });

  const folder = await call("/api/open", { method: "POST", body: { path: fixture.at("home") } });

  assert.equal(ok.status, 200);
  assert.equal(secret.status, 409);
  assert.equal(missing.status, 409);
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

  assert.equal(res.status, 409);
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

  assert.equal((await undo(added)).status, 409);
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
  const credentials = fixture.write("home/.claude/.credentials.json", "{}");
  fixture.link("home/notes.md", credentials);

  const res = await call("/api/open", {
    method: "POST",
    body: { path: fixture.at("home/notes.md") },
  });

  assert.equal(res.status, 409);
  assert.equal(opened.includes(fixture.at("home/notes.md")), false);
});

test("credentials kept under another name are never opened by that name", async () => {
  const tokens = fixture.write("home/.claude/token-store.json", '{"accessToken":"x"}');
  rmSync(join(fixture.env.claudeDir, ".credentials.json"), { force: true });
  fixture.link("home/.claude/.credentials.json", tokens);

  const res = await call("/api/open", { method: "POST", body: { path: tokens } });

  assert.equal(res.status, 409);
  assert.equal(opened.includes(tokens), false);
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

  assert.equal(res.status, 409);
  assert.equal(readFileSync(claudeMd, "utf8"), "mine\n");
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

  assert.equal(restored.status, 409);
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
  assert.equal(res.status, 409);
});

test("a setting saved into a new file is listed as created, with nothing earlier to restore", async () => {
  const dir = fixture.at("work/fresh");
  fixture.write("work/fresh/README.md", "x");

  const saved = await saveSetting({ dir, scope: "project", key: "model", value: "opus" });
  const { id, created } = saved.json as Change;

  // The save says so too, so the page offers no undo that the restore would refuse.
  assert.equal(created, true);
  assert.equal((await backups()).find((b) => b.id === id)?.created, true);
  const preview = (await call("/api/backups/preview", { method: "POST", body: { id } }))
    .json as RestorePreview;
  assert.ok(preview.blocked);
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
  assert.equal(stale.status, 409, "a rule added meanwhile is not lost");

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
  assert.equal(again.status, 409);
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

  assert.equal(proto.status, 409);
  assert.equal(elsewhere.status, 409);
});

test("a settings file that links to the credentials file is never written", async () => {
  const credentials = fixture.write("home/.claude/.credentials.json", '{"token":"x"}');
  fixture.link("work/sneaky/.claude/settings.json", credentials);

  const edit = { dir: fixture.at("work/sneaky"), scope: "project", key: "model", value: "opus" };
  const preview = await call("/api/settings/preview", { method: "POST", body: edit });
  const save = await call("/api/settings/save", {
    method: "POST",
    body: { ...edit, revision: revisionOf('{"token":"x"}') },
  });

  assert.equal(preview.status, 409);
  assert.equal(save.status, 409);
  assert.equal(readFileSync(credentials, "utf8"), '{"token":"x"}');
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

  assert.equal(saved.status, 409);
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")), { projects: {} });
});

test("a MEMORY.md that links outside its memory folder is never rewritten", async () => {
  const notes = fixture.write("work/notes.md", "my own notes\n");
  const dir = memoryDirFor(fixture, "/work/escaping");
  fixture.link(`${dir}/MEMORY.md`, notes);
  const lost = fixture.write(`${dir}/lost.md`, memoryFile("lost", "project", "gone", "y"));

  const res = await changeMemory("add", lost);

  assert.equal(res.status, 409);
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

  assert.equal(res.status, 409);
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

  assert.equal(preview.status, 409);
  assert.equal(restore.status, 409);
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
  assert.equal(saved.status, 409);
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
  assert.equal(res.status, 409);
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
  const before = readFileSync(file, "utf8");

  const res = await call("/api/permissions/preview", {
    method: "POST",
    body: { dir, file, add: { list: "allow", rule: "Read" } },
  });

  assert.equal(res.status, 409);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("undoing a memory delete is refused when MEMORY.md changed since", async () => {
  const { dir, old } = seedMemory();
  const deleted = (await deleteMemory(old)).json as Change;
  fixture.write(
    `${dir}/MEMORY.md`,
    "- [Keep](keep.md) — stays\n- [New](new.md) — added by Claude\n"
  );

  assert.equal((await undo(deleted)).status, 409);
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
  rmSync(join(fixture.env.claudeDir, ".credentials.json"), { force: true });
  fixture.link("home/.claude/.credentials.json", join(fixture.env.claudeDir, "tokens.json"));
  fixture.link("work/linked-creds/CLAUDE.md", join(fixture.env.claudeDir, ".credentials.json"));

  const view = await call(
    `/api/directory?path=${encodeURIComponent(fixture.at("work/linked-creds"))}`
  );

  assert.equal(view.status, 200);
  assert.doesNotMatch(JSON.stringify(view.json), /oauth-secret/);
});

test("credentials hard-linked under another name are never read, changed or removed", async () => {
  const token = '{"accessToken":"hardlinked-secret"}';
  rmSync(join(fixture.env.claudeDir, ".credentials.json"), { force: true });
  const credentials = fixture.write("home/.claude/.credentials.json", token);
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
  for (const res of [save, removal, opening]) assert.equal(res.status, 409);
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
  assert.equal(res.status, 409);
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
  assert.ok((preview.json as Preview).errors.length > 0, "a command hook needs its command");
  const unknown = await call("/api/hooks/preview", {
    method: "POST",
    body: { dir, file, add: { event: "BeforeLunch", definition: command("x") } },
  });
  assert.equal(unknown.status, 400);
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
  assert.equal(changed.status, 409);
  assert.match(readFileSync(file, "utf8"), /s3cret/);
  assert.doesNotMatch(readFileSync(file, "utf8"), /•••/);
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
  definition: unknown;
}

async function serversIn(dir: string): Promise<ScannedServer[]> {
  const view = await call(`/api/directory?path=${encodeURIComponent(dir)}`);
  return (view.json as { inventory: { mcpServers: ScannedServer[] } }).inventory.mcpServers;
}

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
  assert.equal(taken.status, 409);
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
  assert.equal(rewritten.status, 409);
  assert.match(readFileSync(file, "utf8"), /s3cret/, "the password is never replaced by its mask");

  const removed = await saveMcp({
    dir,
    scope: "project",
    remove: { name: "db", definition: db.definition },
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).mcpServers, { keep: { command: "k" } });
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
  const before = readFileSync(fixture.env.claudeJson, "utf8");
  claudeRuns.length = 0;

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
  assert.equal(readFileSync(fixture.env.claudeJson, "utf8"), before);
});

test("removing a user server is refused when its hidden values changed after the review", async () => {
  const dir = fixture.at("work/mcp-rotated");
  const servers = (token: string) =>
    JSON.stringify({ mcpServers: { api: { command: "api-mcp", env: { TOKEN: token } } } });
  fixture.write(fixture.env.claudeJson, servers("old-token"));
  claudeRuns.length = 0;
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
  assert.equal(saved.status, 409);
  assert.deepEqual(claudeRuns, [], "claude mcp remove did not run");
});

test("a replaced server goes back as it was when claude refuses the new one", async () => {
  const dir = fixture.at("work/mcp-rollback");
  fixture.write(
    fixture.env.claudeJson,
    JSON.stringify({ mcpServers: { notes: { command: "notes-mcp" } } })
  );
  claudeRuns.length = 0;
  failing.push("add-json");

  const refused = await saveMcp({
    dir,
    scope: "user",
    remove: { name: "notes", definition: { command: "notes-mcp" } },
    add: { name: "notes", definition: { command: "notes-mcp", args: ["--v2"] } },
  });
  assert.equal(refused.status, 409);
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
  assert.equal(refused.status, 409);
  const command = /put it back with: (.*) \(/.exec((refused.json as { error: string }).error)?.[1];
  assert.ok(command);

  chmodSync(fixture.write("bin/claude", '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n'), 0o755);
  const printed = execFileSync("sh", ["-c", command], {
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
  for (const text of [
    "---\ndescription: no name\n---\nx\n",
    "---\nname: plain\n---\nno description\n",
    agentText("my-plugin:reviewer", "a plugin-scoped name"),
  ]) {
    const res = await saveAgent({ dir, create: { scope: "user", file: "bad" }, text });
    assert.ok((res.json as Preview).errors.length > 0, text);
  }
  assert.equal(existsSync(join(fixture.env.claudeDir, "agents", "bad.md")), false);
});

test("only agents shown here can be changed, and a new one cannot leave its agents folder", async () => {
  const dir = fixture.at("work/agents-confined");
  const other = fixture.write("work/elsewhere/notes.md", "keep me\n");

  const outside = await saveAgent({ dir, path: other, text: agentText("x", "y") });
  assert.equal(outside.status, 409);
  const escaping = await saveAgent({
    dir,
    create: { scope: "user", file: "../../work/elsewhere/notes" },
    text: agentText("x", "y"),
  });
  assert.equal(escaping.status, 409);
  assert.equal(readFileSync(other, "utf8"), "keep me\n");
});
