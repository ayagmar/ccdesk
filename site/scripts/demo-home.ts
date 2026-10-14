// Builds a disposable, made-up Claude Code setup for the docs screenshots: two repositories and a
// notes folder with instructions, settings at every scope, permission rules, hooks, MCP servers,
// subagents, skills, a plugin, auto memory and transcripts. Nothing here is real.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DemoHome {
  home: string;
  /** The directory ccdesk is started in. */
  start: string;
}

const DAY = 24 * 60 * 60 * 1000;

/** `~/.claude/projects/<name>` for a project path, as Claude Code names it. */
function storeName(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

function memory(name: string, type: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;
}

/**
 * Transcript lines for tool calls, a minute apart from `daysAgo`; `answer` marks a call Claude Code
 * asked about.
 */
function transcript(
  cwd: string,
  calls: [tool: string, input: object, answer?: string][],
  daysAgo = 3
) {
  const start = Date.now() - daysAgo * DAY;
  return calls
    .flatMap(([name, input, answer], i) => {
      const id = `toolu_demo_${i}`;
      const timestamp = new Date(start + i * 60_000).toISOString();
      const use = {
        type: "assistant",
        timestamp,
        cwd,
        message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
      };
      if (!answer) return [use];
      const result = {
        type: "user",
        timestamp,
        cwd,
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "" }] },
        permissionDecision:
          answer === "accept"
            ? { decision: "accept", source: "user_temporary" }
            : { decision: "reject", source: "user_reject" },
      };
      return [use, result];
    })
    .map((line) => `${JSON.stringify(line)}\n`)
    .join("");
}

/** The folders of the made-up setup, and how to write into it. */
interface Demo {
  home: string;
  claude: string;
  api: string;
  web: string;
  notes: string;
  write: (path: string, content: string) => void;
  json: (path: string, value: unknown) => void;
  git: (dir: string, ...args: string[]) => void;
}

export function makeDemoHome(root: string): DemoHome {
  const home = join(root, "home");
  const claude = join(home, ".claude");
  const api = join(home, "code", "acme-api");
  const web = join(home, "code", "acme-web");
  const notes = join(home, "notes");

  const write = (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  const json = (path: string, value: unknown) => write(path, `${JSON.stringify(value, null, 2)}\n`);
  const git = (dir: string, ...args: string[]) => {
    execFileSync("git", ["-C", dir, ...args], {
      stdio: "ignore",
      env: {
        PATH: process.env.PATH,
        HOME: home,
        GIT_AUTHOR_NAME: "Demo",
        GIT_AUTHOR_EMAIL: "demo@example.com",
        GIT_COMMITTER_NAME: "Demo",
        GIT_COMMITTER_EMAIL: "demo@example.com",
      },
    });
  };
  const demo: Demo = { home, claude, api, web, notes, write, json, git };
  writeUserScope(demo);
  writePlugin(demo);
  writeApi(demo);
  writeWeb(demo);
  writeClaudeJson(demo);
  writeMemory(demo);
  writeTranscripts(demo);
  return { home, start: api };
}

/** Your user files: CLAUDE.md, settings, hooks, subagents, skills, a command and an output style. */
function writeUserScope({ claude, write, json }: Demo): void {
  write(
    join(claude, "CLAUDE.md"),
    `# How I work

- Run the formatter and the tests before saying a change is done.
- Prefer small, reviewable commits with Conventional Commit messages.
- Ask before adding a dependency.

@~/.claude/style.md
`
  );
  write(
    join(claude, "style.md"),
    "# Writing style\n\nShort sentences. No marketing words in docs or commit messages.\n"
  );
  json(join(claude, "settings.json"), {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    model: "opus",
    theme: "dark",
    includeCoAuthoredBy: false,
    cleanupPeriodDays: 60,
    env: { DEMO_REGION: "eu-west-1" },
    permissions: {
      allow: ["Bash(git status)", "Bash(git diff *)", "Bash(ls *)", "WebFetch(domain:nodejs.org)"],
      ask: ["Bash(git push *)"],
      deny: ["Read(./.env)", "Read(./.env.*)", "Bash(curl *)"],
      defaultMode: "default",
    },
    hooks: {
      PostToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: "~/.claude/hooks/format.sh" }],
        },
      ],
      Notification: [
        { hooks: [{ type: "command", command: "notify-send 'Claude Code' 'Needs you'" }] },
      ],
    },
    enabledPlugins: { "release-notes@demo-market": true },
  });
  write(join(claude, "hooks", "format.sh"), "#!/bin/sh\nexit 0\n");
  write(
    join(claude, "agents", "reviewer.md"),
    `---
name: reviewer
description: Reviews a diff for correctness and missing tests before you commit.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You review the staged diff. List real defects first, then risky changes, then nits.
`
  );
  write(
    join(claude, "agents", "doc-writer.md"),
    `---
name: doc-writer
description: Updates README and docs pages after a change to commands or flags.
tools: Read, Edit, Grep
---

Keep the existing tone of the docs. Never invent flags.
`
  );
  write(
    join(claude, "skills", "changelog", "SKILL.md"),
    `---
name: changelog
description: Write a changelog entry from the commits since the last tag.
---

Read \`git log\` since the last tag and group entries by type.
`
  );
  write(
    join(claude, "skills", "sql-review", "SKILL.md"),
    `---
name: sql-review
description: Check a migration for locks, missing indexes and irreversible steps.
paths: ["**/migrations/**"]
---

Look for table rewrites and long locks first.
`
  );
  write(
    join(claude, "commands", "standup.md"),
    "---\ndescription: Summarise yesterday's commits for a standup.\n---\n\nList commits by repository.\n"
  );
  write(
    join(claude, "output-styles", "terse.md"),
    "---\nname: terse\ndescription: Short answers, code first.\n---\n\nAnswer in as few words as the question allows.\n"
  );
}

/** A plugin from a made-up marketplace. */
function writePlugin({ claude, write, json }: Demo): void {
  const plugin = join(claude, "plugins", "cache", "demo-market", "release-notes", "1.4.0");
  json(join(plugin, ".claude-plugin", "plugin.json"), {
    name: "release-notes",
    version: "1.4.0",
    description: "Drafts release notes from merged pull requests.",
  });
  write(
    join(plugin, "skills", "draft-notes", "SKILL.md"),
    "---\nname: draft-notes\ndescription: Draft release notes from merged pull requests.\n---\n\nGroup by area.\n"
  );
  json(join(claude, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "release-notes@demo-market": [
        {
          scope: "user",
          installPath: plugin,
          version: "1.4.0",
          lastUpdated: new Date(Date.now() - 9 * DAY).toISOString(),
        },
      ],
    },
  });
}

/** acme-api: the directory the screenshots open on. */
function writeApi({ api, write, json, git }: Demo): void {
  write(
    join(api, "CLAUDE.md"),
    `# acme-api

Node 22 service behind the Acme storefront. See @AGENTS.md for the shared agent notes.

## Commands

- \`pnpm test\` runs the unit tests; \`pnpm test:db\` needs Docker.
- \`pnpm db:migrate\` applies migrations to the local database.

## Rules

- Every endpoint has a request schema in \`src/schemas\`.
- Never log request bodies; they can hold card numbers.
`
  );
  write(
    join(api, "AGENTS.md"),
    "# Agent notes\n\nThe API is versioned under `/v2`. Keep `/v1` handlers frozen.\n"
  );
  write(join(api, "CLAUDE.local.md"), "# Local notes\n\nMy database runs on port 5433.\n");
  write(
    join(api, ".claude", "rules", "migrations.md"),
    `---
paths: ["db/migrations/**"]
---

# Migrations

Each migration must be reversible. Add the down step in the same file.
`
  );
  write(
    join(api, ".claude", "rules", "testing.md"),
    "# Testing\n\nTests use the in-memory store; do not reach the network.\n"
  );
  json(join(api, ".claude", "settings.json"), {
    permissions: {
      allow: ["Bash(pnpm test *)", "Bash(pnpm lint)", "Bash(git status)"],
      deny: ["Bash(pnpm publish *)"],
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "node scripts/guard-migrations.mjs" }],
        },
      ],
    },
    enabledMcpjsonServers: ["postgres"],
    model: "sonnet",
  });
  json(join(api, ".claude", "settings.local.json"), {
    permissions: { allow: ["Bash(docker compose *)"] },
    env: { DATABASE_URL: "postgres://demo:demo-password@localhost:5433/acme" },
  });
  write(
    join(api, ".claude", "agents", "migration-checker.md"),
    `---
name: migration-checker
description: Checks a new migration against the rules in .claude/rules/migrations.md.
tools: Read, Grep
---

Read the migration and the rule file, then report anything that is not reversible.
`
  );
  json(join(api, ".mcp.json"), {
    mcpServers: {
      postgres: {
        command: "npx",
        args: ["-y", "@demo/postgres-mcp"],
        env: { DATABASE_URL: "postgres://demo:demo-password@localhost:5433/acme" },
      },
      sentry: { type: "http", url: "https://mcp.sentry.example/mcp" },
    },
  });
  write(join(api, ".gitignore"), "node_modules/\n.claude/settings.local.json\nCLAUDE.local.md\n");
  write(join(api, "package.json"), '{ "name": "acme-api", "private": true }\n');
  write(join(api, "db", "migrations", "0001_init.sql"), "create table orders (id bigint);\n");
  git(api, "init", "-q", "-b", "main");
  git(
    api,
    "add",
    "CLAUDE.md",
    ".gitignore",
    "package.json",
    ".claude/settings.json",
    ".claude/rules"
  );
  git(api, "commit", "-q", "-m", "init");
}

/** acme-web: a second repository, and a notes folder outside git. */
function writeWeb({ web, notes, write, json, git }: Demo): void {
  write(
    join(web, "CLAUDE.md"),
    "# acme-web\n\nAstro storefront. Components live in `src/components`; keep them server-rendered.\n"
  );
  json(join(web, ".claude", "settings.json"), {
    permissions: { allow: ["Bash(pnpm build)", "Bash(pnpm dev)"] },
  });
  write(join(web, "package.json"), '{ "name": "acme-web", "private": true }\n');
  git(web, "init", "-q", "-b", "main");
  git(web, "add", ".");
  git(web, "commit", "-q", "-m", "init");
  write(join(notes, "todo.md"), "- renew the staging certificate\n");
}

/** ~/.claude.json: trust, user and local MCP servers. */
function writeClaudeJson({ home, api, web, notes, json }: Demo): void {
  json(join(home, ".claude.json"), {
    numStartups: 214,
    mcpServers: {
      github: {
        type: "http",
        url: "https://api.githubcopilot.example/mcp/",
        headers: { Authorization: "Bearer demo-token" },
      },
      linear: {
        command: "npx",
        args: ["-y", "@demo/linear-mcp"],
        env: { LINEAR_API_KEY: "demo-key" },
      },
    },
    projects: {
      [api]: {
        hasTrustDialogAccepted: true,
        mcpServers: { "local-redis": { command: "redis-mcp", args: ["--port", "6380"] } },
      },
      [web]: { hasTrustDialogAccepted: true },
      [notes]: { hasTrustDialogAccepted: false },
    },
  });
}

/** Auto memory for both repositories, with one memory saved in each. */
function writeMemory({ claude, api, web, write }: Demo): void {
  const apiMemory = join(claude, "projects", storeName(api), "memory");
  write(
    join(apiMemory, "MEMORY.md"),
    `- [Test database](test-database.md): integration tests need the Docker database on 5433
- [Review style](review-style.md): user wants findings ranked by severity
- [Release freeze](release-freeze.md): no deploys during the Friday freeze
`
  );
  write(
    join(apiMemory, "test-database.md"),
    memory(
      "test-database",
      "project",
      "Integration tests need the Docker database",
      "Run `docker compose up db` before `pnpm test:db`. It listens on 5433. See [[release-freeze]]."
    )
  );
  write(
    join(apiMemory, "review-style.md"),
    memory(
      "review-style",
      "feedback",
      "Rank review findings by severity",
      "List defects first, then risks, then nits.\n\n**Why:** the user reads the top of the list only."
    )
  );
  write(
    join(apiMemory, "release-freeze.md"),
    memory(
      "release-freeze",
      "project",
      "No deploys during the Friday freeze",
      "Deploys stop Friday 12:00 UTC until Monday."
    )
  );
  write(
    join(apiMemory, "staging-url.md"),
    memory(
      "staging-url",
      "reference",
      "Where staging lives",
      "Staging is at https://staging.acme.example."
    )
  );
  write(
    join(apiMemory, "user-role.md"),
    memory("user-role", "user", "Who the user is", "Backend developer; owns billing and orders.")
  );
  const webMemory = join(claude, "projects", storeName(web), "memory");
  write(
    join(webMemory, "MEMORY.md"),
    "- [Review style](review-style.md): rank findings by severity\n"
  );
  write(
    join(webMemory, "review-style.md"),
    memory(
      "review-style",
      "feedback",
      "Rank review findings by severity",
      "List defects first, then risks, then nits."
    )
  );
}

/** Transcripts, so tool counts, suggested rules and memory reads show up. */
function writeTranscripts({ claude, api, web, write }: Demo): void {
  const apiMemory = join(claude, "projects", storeName(api), "memory");
  write(
    join(claude, "projects", storeName(api), "demo-session-1.jsonl"),
    transcript(api, [
      ["Read", { file_path: join(api, "CLAUDE.md") }],
      ["Grep", { pattern: "orders" }],
      ["Bash", { command: "pnpm test" }],
      ["Bash", { command: "git status" }],
      ["Bash", { command: "pnpm db:migrate" }, "accept"],
      ["Bash", { command: "pnpm db:migrate" }, "accept"],
      ["Bash", { command: "pnpm db:migrate" }, "accept"],
      ["Bash", { command: "gh pr view 42" }, "accept"],
      ["Bash", { command: "gh pr view 57" }, "accept"],
      ["Bash", { command: "jq .version package.json" }, "accept"],
      ["Bash", { command: "rm -rf dist" }, "reject"],
      [
        "WebFetch",
        { url: "https://www.postgresql.org/docs/current/sql-altertable.html" },
        "accept",
      ],
      ["WebFetch", { url: "https://www.postgresql.org/docs/current/indexes.html" }, "accept"],
      ["Edit", { file_path: join(api, "src", "orders.ts") }],
      ["Edit", { file_path: join(api, "src", "orders.ts") }],
      ["Write", { file_path: join(api, "db", "migrations", "0002_status.sql") }],
      ["Glob", { pattern: "src/**/*.ts" }],
      ["Read", { file_path: join(api, "src", "orders.ts") }],
      ["Read", { file_path: join(api, "src", "schemas", "order.ts") }],
      ["TodoWrite", { todos: [] }],
      ["Read", { file_path: join(apiMemory, "test-database.md") }],
      ["Read", { file_path: join(apiMemory, "test-database.md") }],
      ["Read", { file_path: join(apiMemory, "review-style.md") }],
      ["Read", { file_path: join(apiMemory, "user-role.md") }],
    ])
  );
  // An older session, so one memory was last read more than 30 days ago.
  write(
    join(claude, "projects", storeName(api), "demo-session-0.jsonl"),
    transcript(
      api,
      [
        ["Read", { file_path: join(apiMemory, "release-freeze.md") }],
        ["Read", { file_path: join(apiMemory, "test-database.md") }],
      ],
      45
    )
  );
  write(
    join(claude, "projects", storeName(web), "demo-session-2.jsonl"),
    transcript(web, [
      ["Bash", { command: "pnpm build" }],
      ["Read", { file_path: join(web, "CLAUDE.md") }],
    ])
  );
}
