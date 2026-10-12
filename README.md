<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/assets/brand/banner-dark.webp" />
  <img alt="Murmeli the marmot, ccdesk's station master, waving from a station desk beside a line of five coloured stops" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/assets/brand/banner-light.webp" />
</picture>

# ccdesk

[![npm](https://img.shields.io/npm/v/ccdesk?style=flat-square&color=141414)](https://www.npmjs.com/package/ccdesk)
[![CI](https://img.shields.io/github/actions/workflow/status/ayagmar/ccdesk/ci.yml?branch=master&style=flat-square&label=ci)](https://github.com/ayagmar/ccdesk/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/ccdesk?style=flat-square&color=141414)](package.json)
[![license](https://img.shields.io/github/license/ayagmar/ccdesk?style=flat-square&color=141414)](LICENSE)

See and change everything that shapes Claude Code on your machine: instruction files, settings, hooks, MCP servers, subagents, skills, plugins and auto memory.

```sh
npx ccdesk
```

ccdesk opens in your browser on the directory you ran it from and answers one question: **what is Claude told here, and where does each piece come from?**

It is not a session viewer or a usage dashboard. It reads your config, shows it in the order Claude Code loads it, and lets you fix it.

Full documentation: [ayagmar.github.io/ccdesk](https://ayagmar.github.io/ccdesk/)

## What you see

For any directory Claude Code has been used in:

- **Instructions.** Every `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/AGENTS.md` and `.claude/rules/*.md` that applies, in load order. Each file shows whether it is loaded, skipped (and why), or loaded only for matching paths. It also lists the `@imports` it pulls in, who sees it (tracked in git, untracked, git-ignored, only you, or your organisation), and whether it is a link into `~/.agents` that other coding agents read too.
- **Settings.** Every key with the value Claude Code ends up using and the file it comes from: managed (including `managed-settings.d/`), user, project or local. Local settings are read from the repository root, as Claude Code does. Values overridden by a higher file are struck through, lists that merge across files are marked as merged, and a key set in a file Claude Code does not read it from is marked ignored.
- **Permissions.** Every `allow`, `ask` and `deny` rule from every settings file, plus `defaultMode` and extra folders. Claude Code checks deny, then ask, then allow across all files, so an allow rule that the same rule in deny or ask overrides is flagged. Rules that wait for you to trust the folder, or that managed settings switch off, are marked as not in effect. An allow rule that covered no call in those sessions is marked, and calls Claude Code asked you about and you allowed show up as **suggested** allow rules, such as `Bash(pnpm test *)` or `WebFetch(domain:nodejs.org)`, with how many times you allowed them. A rule is not suggested when it would also cover a call you refused, or when your rules already decide those calls. Bash rules are suggested only for read-only commands such as `ls` or `jq`, for subcommands such as `git status` or `gh pr view` whose flags cannot run another command or write a file you did not name, and for script runners such as `pnpm test` or `git commit`, the same rule Claude Code's own prompt offers. A script runner runs your project's scripts or hooks, and npm and pnpm flags such as `--node-options` can make it run other code. A rule for `sed`, `make`, `go test`, `gh repo`, `git stash` or an install could allow far more than you approved.
- **Built-in tools.** Every tool Claude Code ships with, what it does, and what happens when Claude reaches for it here: removed by a deny rule, asks first, or runs without asking. Rules that cover only some uses, such as `Bash(git push *)` or an `Edit` path, and `PreToolUse` hooks that match the tool are listed with it. Outcomes are as in Manual mode; the header says which mode sessions here start in. **Used** counts how often Claude called each tool in the sessions started here, or anywhere in the repository and its worktrees, since rules at a repository's root apply there too.
- **Memory.** Auto memory for the directory, with filters by type (user, feedback, project, reference). Checks flag memories missing from `MEMORY.md`, broken `[[links]]`, a `MEMORY.md` too long to load in full, and memories saved in more than one directory. `autoMemoryEnabled`, `autoMemoryDirectory` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY` are taken into account.
- **Hooks, MCP servers, subagents, skills, commands, output styles and plugins**, each marked with the scope it comes from. Hooks turned off by `disableAllHooks` or `allowManagedHooksOnly`, MCP servers that wait for approval, are turned off, rejected or overridden by a closer definition, and plugins that are off are marked. Project skills come from the start directory and every parent up to the repository root. Subagents, skills and plugins can be filtered by kind.
- **All settings.** Every key in the settings reference, set or not, grouped by area: what it does, which files Claude Code reads it from, its documented values and default, and the value it has here. Pick one to set it in the file you choose.

Instruction files are also flagged when they are longer than the 200 lines the docs suggest, repeat a paragraph from another file, or import a file that does not exist.

The header says when you have not yet accepted Claude Code's trust dialog for the folder, which is read from `~/.claude.json`. Settings files and `.mcp.json` files that are not valid JSON are listed at the top.

If the directory is in a git repository, a strip under the line shows which of these files are tracked in git (everyone who clones gets them), not tracked yet, or git-ignored.

**What Claude sees** switches to what your config puts in context when a session starts here, in load order: a custom output style, instruction files and their imports (without frontmatter and HTML comments, which Claude Code strips), the part of `MEMORY.md` that loads, the skill listing and your subagents' descriptions. Each shows its size and an estimated token count. Claude Code's system prompt and the tool names of MCP servers are listed but not counted. ccdesk does not show the text of an import outside the project and your Claude folders, and imports that wait for your approval are not counted.

Below it, **When Claude touches a file** takes a path and lists what joins the session once Claude reads or edits it: path rules, skills with matching `paths`, and the `CLAUDE.md` files of the folders on the way.

The line across the top is the load order: **M**anaged, **U**ser, **P**roject, **L**ocal, **A**uto memory and plugins (**X**). Click a stop to show only that scope.

The page follows your system's light or dark theme; the button in the rail switches it and remembers your choice.

Every table can be filtered with `/`, narrowed with the chips above it, and sorted by clicking a column. Long tables show 50 rows at a time. Filters and sorting are kept in the URL, so a reload or a shared link opens the same view.

**All directories** lists every directory Claude Code has sessions or memory for, and memories that exist in more than one of them.

## What you can change

- **Settings.** Pick a key from the schema, which comes with autocomplete and descriptions, or open an existing one. Choose which file to write: user, project or local; files Claude Code does not read the key from are shown but cannot be picked. Each value gets the control that fits its type: a checkbox, a choice list, a number field, a text field with the documented values one click away, one entry per line, or JSON. Before anything is written you see the exact diff, and Save writes exactly that diff: if the file changed in the meantime, ccdesk asks you to review again. Values are checked against Claude Code's settings schema, other keys are left as they are, and the old file is backed up first. A file that is a symlink, such as one in a dotfiles repository, is written through and stays a link. Undo is one click.
- **Permission rules.** Move a rule to another list, remove it, or add a new one to the file you choose, with the same diff review and backup. A suggested rule goes into local settings by default, as Claude Code's "don't ask again" does.
- **Built-in tools.** Turn a tool off for Claude with a deny rule in the file you choose, and turn it back on by removing the rules that remove it. A rule from managed settings cannot be removed, so the tool stays off.
- **Hooks.** Add a hook to user, project or local settings: pick the event from Claude Code's list, give a matcher if the event takes one, and write the hook as JSON. A hook can be changed in place or removed. Hooks are checked against Claude Code's settings schema and get the same diff review, backup and undo as settings. Plugin and managed hooks are read-only. A file whose hooks send header values, or call a URL with a user name, password or query, is left for you to edit by hand.
- **MCP servers.** Add, change or remove a server as JSON. Project servers are written to `.mcp.json` with a diff, a backup and undo. User and local servers live in `~/.claude.json`, so ccdesk runs Claude Code's own `claude mcp add-json` and `claude mcp remove` instead; the review shows the command, and these changes are not listed in Recent changes. This needs `claude` on your PATH. A server with hidden `env` or `headers` values, or a `url` with a user name, password or query, can be removed but not changed. ccdesk checks that a stdio server has a `command` and other servers have a `url`; Claude Code checks the rest when it starts the server.
- **Subagents.** Create an agent in the repository's `.claude/agents` or in `~/.claude/agents`, change its file, or delete it. The file needs a `name` and a `description` in its frontmatter, and the name cannot contain `:` or start with `-`, as Claude Code requires. Each change is backed up, so a deleted agent can be restored from Recent changes.
- **Memory.** Delete a memory you no longer want. ccdesk also removes its line from `MEMORY.md`, warns you if other memories link to it, keeps a backup, and offers undo. A memory missing from `MEMORY.md` can be added to it, and lines pointing at deleted files can be removed. Each of these shows the exact change to `MEMORY.md` first and is refused if the memory or the index changed after you reviewed it.
- **Open in your editor.** Every file path has an open button. ccdesk uses `$CCDESK_EDITOR`, then `$VISUAL` or `$EDITOR` when they name a graphical editor, then the first of VS Code, Cursor, Zed, VSCodium, Sublime Text, Kate, GNOME Text Editor or gedit found on your PATH, and otherwise your system's default app.

Backups go to `~/.claude/backups/ccdesk/` (or `backups/ccdesk/` in `$CLAUDE_CONFIG_DIR`). **Recent changes** lists every change ccdesk made. Each one can be restored after you review the diff, and the current file is backed up before it is replaced.

ccdesk never deletes sessions and never writes `~/.claude.json` itself; user and local MCP server changes go through `claude mcp`, which does.

## Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous row |
| `1`–`9` | Jump to a section |
| `/` | Filter rows |
| `Ctrl K` / `⌘ K` | Jump to any directory, file, setting or rule, or a memory saved for any directory |
| `Esc` | Close details |

## Options

```
npx ccdesk [options]

  --port <n>   Port to listen on (default: a free port)
  --no-open    Print the URL instead of opening a browser
  -h, --help   Show this help
```

ccdesk reads `~/.claude` and `~/.claude.json`. When `$CLAUDE_CONFIG_DIR` is set, it reads that folder and the `.claude.json` inside it instead, as Claude Code does. It watches the config files for the open directory, so edits made in another editor or by Claude show up within a second. `~/.claude.json` is not watched, because Claude Code rewrites it during every session; changes to it show up when you return to ccdesk's tab. Requires Node.js 22.19 or newer.

## Privacy and safety

- The server listens on `127.0.0.1` only. Every API call needs a token generated for that run, which the browser receives in the URL fragment. Requests from other hosts or origins are refused.
- Nothing leaves your machine.
- Values under `env` and `headers` (in settings and MCP servers) are hidden in the UI, including in diffs and in a settings file reached through an import or a link. ccdesk never changes them: an edit that touches them is refused, and so is a restore that would put back older values. The user name, password and query string of a `url` (such as an MCP server's) are hidden too, wherever ccdesk shows it, and errors about a broken JSON file give only the line and column.
- ccdesk never reads `~/.claude/.credentials.json`, even through a link or an import, and never writes `~/.claude.json`, even through a settings file that links to it. A `MEMORY.md` that links outside its memory folder is left alone.
- To count tool calls and your answers to permission prompts, ccdesk reads the open directory's transcripts in `~/.claude/projects/`. Only counts and rule patterns (a command's program and subcommand, a fetch's domain) reach the page, never commands, file contents or anything else from a session. Your answers come from a transcript field Claude Code does not document, so older transcripts may not have them.
- Backups can hold settings with secrets, so on Linux and macOS their folders and files are readable only by you. On Windows they keep the permissions of your user profile.
- Markdown is rendered without raw HTML, so an `AGENTS.md` from a cloned repo cannot run script in the page.

## Settings schema

The settings schema is generated from the `Settings` type in [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which is published with each Claude Code release. Which files each key is read from comes from the Scope column of the [settings reference](https://code.claude.com/docs/en/settings-reference). The built-in tools come from the [tools reference](https://code.claude.com/docs/en/tools-reference). The settings catalog comes from the same reference. A daily workflow regenerates all of them and opens a pull request when any of them changed. Some of Claude Code's behaviour, such as how rules match commands, is only described in the docs, so ccdesk follows it by hand and cites the docs section in the code; the workflow also fingerprints every cited section and lists the ones that changed in the pull request.

## Development

```sh
pnpm install
pnpm dev        # API on 127.0.0.1:4319
pnpm dev:ui     # UI with hot reload on localhost:4320
pnpm check      # typecheck, lint, format, tests, build
pnpm schema     # regenerate src/shared/settings.schema.json and hook-events.json
pnpm scopes     # regenerate settings-scopes.json and settings-catalog.json from the settings reference
pnpm tools      # regenerate src/shared/builtin-tools.json from the tools reference
pnpm docs:fingerprints  # fingerprint the docs sections the code cites; prints the ones that changed
```

Tests never touch your real `~/.claude`. Each one builds a throwaway home directory.

The documentation site is in `site/`, built with Astro and Starlight. `pnpm --dir site dev` previews it, `pnpm --dir site build` builds it and checks every internal link, and `pnpm --dir site screenshots` retakes its screenshots from a made-up home folder after `pnpm build`.

## License

MIT
