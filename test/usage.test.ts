import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { storeDirName } from "../src/server/scan/memory.ts";
import { readUsage } from "../src/server/scan/usage.ts";
import { type PermissionList } from "../src/shared/types.ts";
import { type Fixture, makeFixture } from "./helpers/fixture.ts";

let next = 0;

/** Transcript lines for one tool call, and for its result when Claude Code asked you about it. */
function call(
  tool: string,
  input: Record<string, unknown>,
  answer?: "accept" | "reject" | "mode",
  cwd?: string
): string {
  const id = `toolu_${++next}`;
  const at = new Date(Date.UTC(2026, 9, 1, 0, next)).toISOString();
  const lines: unknown[] = [
    {
      type: "assistant",
      timestamp: at,
      ...(cwd ? { cwd } : {}),
      message: { role: "assistant", content: [{ type: "tool_use", id, name: tool, input }] },
    },
  ];
  if (answer)
    lines.push({
      type: "user",
      timestamp: at,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: "secret output" }],
      },
      permissionDecision:
        answer === "mode"
          ? { decision: "accept", source: "config", reasonType: "mode" }
          : { decision: answer, source: answer === "accept" ? "user_temporary" : "user_reject" },
    });
  return lines.map((l) => `${JSON.stringify(l)}\n`).join("");
}

const bash = (command: string, answer?: "accept" | "reject" | "mode", cwd?: string) =>
  call("Bash", { command }, answer, cwd);

function storeOf(f: Fixture, dir: string): string {
  return join(f.env.claudeDir, "projects", storeDirName(dir));
}

function rules(list: PermissionList, ...texts: string[]) {
  return texts.map((rule) => ({ list, rule }));
}

async function suggested(f: Fixture, dir: string, inEffect = rules("allow")) {
  return (await readUsage(f.env, dir, inEffect)).approvals.map((a) => a.rule);
}

test("calls you allowed by hand are grouped into the allow rule that would cover them", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  f.write(
    join(storeOf(f, dir), "one.jsonl"),
    bash("git commit -m one", "accept") +
      bash("git commit", "accept") +
      bash("timeout 30 pnpm test --watch", "accept") +
      bash("ls -la", "accept") +
      // Compound commands, risky programs and file tools get no rule.
      bash("cd sub && make", "accept") +
      bash("rm -rf build", "accept") +
      call("Edit", { file_path: "/x" }, "accept") +
      call("WebFetch", { url: "https://Docs.Example.com/page" }, "accept") +
      call("mcp__github__create_issue", {}, "accept") +
      // Refused, or allowed by your mode rather than by you: not suggestions.
      bash("git reset --hard", "reject") +
      bash("git status", "mode")
  );
  f.write(
    join(storeOf(f, dir), "one", "subagents", "agent-a.jsonl"),
    bash("git commit --amend", "accept")
  );

  const usage = await readUsage(f.env, dir, []);

  assert.deepEqual(
    usage.approvals.map((a) => [a.rule, a.approved]),
    [
      ["Bash(git commit *)", 3],
      ["Bash(pnpm test *)", 1],
      ["Bash(ls *)", 1],
      ["WebFetch(domain:docs.example.com)", 1],
      ["mcp__github__create_issue", 1],
    ]
  );
  assert.equal(usage.sessions, 1);
  const bashUsage = usage.tools.find((t) => t.tool === "Bash");
  assert.deepEqual(
    bashUsage && [bashUsage.calls, bashUsage.approved, bashUsage.refused],
    [9, 7, 1]
  );
});

test("no rule is suggested that would allow more than you approved", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  f.write(
    join(storeOf(f, dir), "one.jsonl"),
    // Options before the subcommand, runners and exec wrappers would allow any command.
    bash("git -c core.fsmonitor=x status", "accept") +
      bash("docker exec web sh", "accept") +
      bash("uv run script.py", "accept") +
      bash("flock /tmp/l make", "accept") +
      bash("echo $(whoami)", "accept") +
      bash("git rebase main", "accept") +
      bash("go run example.com/x@latest", "accept") +
      bash("pkexec ls", "accept") +
      // A word Cargo does not know may be an argument, such as a token.
      bash("cargo ghp_x", "accept") +
      // An allow rule does not match past most variable assignments.
      bash("FOO=1 git commit", "accept") +
      // Flags of these run commands (sed's e, make --eval, go test -exec, git fetch
      // --upload-pack, cargo --config), and installs run the package's scripts.
      bash("sed -i s/a/b/ x.ts", "accept") +
      bash("make build", "accept") +
      bash("go test ./...", "accept") +
      bash("git fetch origin", "accept") +
      bash("cargo build", "accept") +
      bash("npm install left-pad", "accept") +
      // These write a file you did not name (--output, --compile --outfile, audit fixes), and
      // gh repo also deletes repositories and adds deploy keys.
      bash("git stash", "accept") +
      bash("git blame a.ts", "accept") +
      bash("bun build b.ts", "accept") +
      bash("npm audit fix", "accept") +
      bash("gh repo delete o/r --yes", "accept") +
      // Every pnpm command loads a pnpmfile, podman takes --runtime after the subcommand, and
      // file -C writes a compiled magic file.
      bash("pnpm why react", "accept") +
      bash("podman ps", "accept") +
      bash("file -C -m m", "accept") +
      // The project's own scripts are fine, and so is reading a pull request.
      bash("pnpm run build", "accept") +
      bash("gh pr view 12", "accept")
  );

  assert.deepEqual(await suggested(f, dir), ["Bash(pnpm run *)", "Bash(gh pr view *)"]);
});

test("a rule that would also cover a call you refused is not suggested", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  f.write(
    join(storeOf(f, dir), "one.jsonl"),
    bash("git commit -m feat", "accept") +
      bash("git commit --amend --no-edit", "reject") +
      bash("git status", "accept")
  );

  assert.deepEqual(await suggested(f, dir), ["Bash(git status *)"]);
});

test("a rule is not suggested when rules in effect already decide its calls", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  f.write(
    join(storeOf(f, dir), "one.jsonl"),
    bash("git commit -m x", "accept") +
      bash("npm run build", "accept") +
      bash("pnpm test", "accept") +
      bash("ls src", "accept")
  );

  assert.deepEqual(
    await suggested(f, dir, [
      ...rules("allow", "Bash(git:*)"),
      ...rules("ask", "Bash(npm run build *)"),
      ...rules("deny", "Bash(pnpm *)"),
    ]),
    ["Bash(ls *)"]
  );
});

test("a rule is counted as covering a call the way Claude Code matches it", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  f.write(
    join(storeOf(f, dir), "one.jsonl"),
    bash("ls") +
      bash("lsof -i") +
      bash("cd sub && git push origin main") +
      bash("NODE_ENV=test timeout 5 npm test") +
      // Deny and ask rules reach commands in substitutions, subshells and loop bodies.
      bash('echo "$(git clean -fdx)"') +
      bash("(git clean -f)") +
      bash("for f in a b; do git clean -f $f; done") +
      // Claude Code checks a redirection apart from the rule.
      bash("npm test 2>&1") +
      bash("npm test > out.txt") +
      bash("npm test > 'my out.txt'") +
      call("Monitor", { command: "tail -f log" }) +
      call("WebFetch", { url: "https://api.github.com/repos" }) +
      call("mcp__github__list_issues", {})
  );

  const { matches } = await readUsage(f.env, dir, [
    ...rules(
      "allow",
      "Bash(ls *)",
      "Bash(ls:*)",
      "Bash(git push *)",
      "Bash(npm test *)",
      "Bash(docker *)",
      "WebFetch(domain:*.github.com)",
      "mcp__github",
      "Read(./src/**)",
      "Bash(run_in_background:true)",
      "Bash(npm test)"
    ),
    ...rules("ask", "Bash(git clean *)", "Bash"),
  ]);

  assert.deepEqual(matches, {
    "Bash(ls *)": 1,
    "Bash(ls:*)": 1,
    "Bash(git push *)": 1,
    "Bash(npm test *)": 4,
    "Bash(npm test)": 4,
    "Bash(docker *)": 0,
    "WebFetch(domain:*.github.com)": 1,
    mcp__github: 1,
    // Kinds ccdesk does not match are not reported as unused.
    "Read(./src/**)": null,
    "Bash(run_in_background:true)": null,
    "Bash(git clean *)": 3,
    // Monitor runs commands under the Bash rules.
    Bash: 11,
  });
});

test("in a repository, sessions started in its subfolders count and a sibling's do not", async () => {
  const f = makeFixture();
  const repo = f.at("work", "app");
  f.write("work/app/README.md", "x\n");
  f.git(repo, "init", "-q");
  f.write(join(storeOf(f, repo), "root.jsonl"), bash("make", undefined, repo));
  const sub = join(repo, "packages", "api");
  f.write(join(storeOf(f, sub), "sub.jsonl"), bash("make", undefined, sub));
  // "app-old" shares the store name prefix but is another folder.
  const sibling = f.at("work", "app-old");
  f.write(join(storeOf(f, sibling), "old.jsonl"), bash("make", undefined, sibling));

  const usage = await readUsage(f.env, repo, []);

  assert.equal(usage.repository, true);
  assert.equal(usage.sessions, 2);
  assert.equal(usage.tools[0]?.calls, 2);
});

test("a worktree inside the repository is counted once", async () => {
  const f = makeFixture();
  const repo = f.at("work", "app");
  f.write("work/app/README.md", "x\n");
  f.git(repo, "init", "-q");
  f.git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-qm", "x");
  const tree = join(repo, ".claude", "worktrees", "feat");
  f.git(repo, "worktree", "add", "-q", tree);
  f.write(join(storeOf(f, tree), "feat.jsonl"), bash("make", undefined, tree));

  const usage = await readUsage(f.env, repo, []);

  assert.deepEqual([usage.sessions, usage.tools[0]?.calls], [1, 1]);
});

test("a session started here counts in full, wherever Claude worked during it", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  f.write(
    join(storeOf(f, dir), "one.jsonl"),
    bash("make", undefined, dir) + bash("make", undefined, f.at("work", "shared"))
  );

  assert.equal((await readUsage(f.env, dir, [])).tools[0]?.calls, 2);
});

test("a home directory kept in git does not hide a project's own sessions", async () => {
  const f = makeFixture();
  f.git(f.env.home, "init", "-q");
  const dir = join(f.env.home, "projects", "foo");
  // The folder must exist for git to find the home repository around it.
  f.write(join(dir, "x"), "");
  f.write(join(storeOf(f, dir), "one.jsonl"), bash("make", undefined, dir));
  f.write(join(storeOf(f, f.env.home), "home.jsonl"), bash("ls", undefined, f.env.home));

  const usage = await readUsage(f.env, dir, []);

  assert.equal(usage.repository, false);
  assert.deepEqual(
    usage.tools.map((t) => [t.tool, t.calls]),
    [["Bash", 1]]
  );
  assert.equal(usage.sessions, 1);
});

test("opening the home directory counts only sessions started there", async () => {
  const f = makeFixture();
  const project = join(f.env.home, "projects", "foo");
  f.write(join(storeOf(f, project), "one.jsonl"), bash("make", undefined, project));
  f.write(join(storeOf(f, f.env.home), "home.jsonl"), bash("ls", undefined, f.env.home));

  const usage = await readUsage(f.env, f.env.home, []);

  assert.deepEqual([usage.sessions, usage.tools[0]?.calls], [1, 1]);
});

test("a subagent whose session file is gone counts by where it started", async () => {
  const f = makeFixture();
  const repo = f.at("work", "app");
  f.write("work/app/README.md", "x\n");
  f.git(repo, "init", "-q");
  const sub = join(repo, "pkg");
  f.write(join(storeOf(f, sub), "gone", "subagents", "agent-a.jsonl"), bash("ls", undefined, sub));

  assert.equal((await readUsage(f.env, repo, [])).tools[0]?.calls, 1);
});

test("a home directory written with a trailing slash is still recognised", async () => {
  const f = makeFixture();
  f.git(f.env.home, "init", "-q");
  const dir = join(f.env.home, "projects", "foo");
  f.write(join(dir, "x"), "");
  f.write(join(storeOf(f, dir), "one.jsonl"), bash("ls", undefined, dir));
  const other = join(f.env.home, "projects", "foo", "deeper");
  f.write(join(storeOf(f, f.env.home), "home.jsonl"), bash("ls", undefined, other));

  const usage = await readUsage({ ...f.env, home: `${f.env.home}/` }, dir, []);

  assert.deepEqual([usage.repository, usage.sessions], [false, 1]);
});

test("a transcript that grows is counted again, including a line that was half written", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  const file = f.write(join(storeOf(f, dir), "one.jsonl"), bash("ls"));
  assert.equal((await readUsage(f.env, dir, [])).tools[0]?.calls, 1);

  const more = bash("make");
  appendFileSync(file, more.slice(0, 40));
  assert.equal((await readUsage(f.env, dir, [])).tools[0]?.calls, 1);
  appendFileSync(file, more.slice(40));
  assert.equal((await readUsage(f.env, dir, [])).tools[0]?.calls, 2);
});

test("counts asked for at the same time are each counted once", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  const file = f.write(join(storeOf(f, dir), "one.jsonl"), bash("ls").repeat(200));

  const both = await Promise.all([readUsage(f.env, dir, []), readUsage(f.env, dir, [])]);
  assert.deepEqual(
    both.map((u) => u.tools[0]?.calls),
    [200, 200]
  );
  appendFileSync(file, bash("ls").repeat(500));
  assert.equal((await readUsage(f.env, dir, [])).tools[0]?.calls, 700);
});

test("a line longer than one read is counted whole", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  const long = call("Bash", { command: "ls", description: "x".repeat(9 * 1024 * 1024) });
  f.write(join(storeOf(f, dir), "one.jsonl"), bash("make") + long + bash("ls"));

  assert.equal((await readUsage(f.env, dir, [])).tools[0]?.calls, 3);
});

test("only counts and rule patterns are returned, never commands or results", async () => {
  const f = makeFixture();
  const dir = f.at("work", "app");
  f.write(
    join(storeOf(f, dir), "one.jsonl"),
    bash("curl -H 'token: hunter2' https://x.test", "accept") +
      bash("deploy --password hunter2", "accept") +
      bash("echo hunter2", "accept") +
      call("WebFetch", { url: "https://x.test/?key=hunter2" }, "accept")
  );

  const usage = await readUsage(f.env, dir, rules("allow", "Bash(deploy *)"));

  assert.doesNotMatch(JSON.stringify(usage), /hunter2|secret output/);
  assert.deepEqual(
    usage.approvals.map((a) => a.rule),
    ["Bash(echo *)", "WebFetch(domain:x.test)"]
  );
});
