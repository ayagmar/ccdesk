<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/assets/brand/banner-dark.webp" />
  <img alt="Murmeli the marmot, ccdesk's station master, waving from a station desk beside a line of five coloured stops" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/assets/brand/banner-light.webp" />
</picture>

# ccdesk

[![npm](https://img.shields.io/npm/v/ccdesk?style=flat-square&color=141414)](https://www.npmjs.com/package/ccdesk)
[![CI](https://img.shields.io/github/actions/workflow/status/ayagmar/ccdesk/ci.yml?branch=master&style=flat-square&label=ci)](https://github.com/ayagmar/ccdesk/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/ccdesk?style=flat-square&color=141414)](https://github.com/ayagmar/ccdesk/blob/master/package.json)
[![license](https://img.shields.io/github/license/ayagmar/ccdesk?style=flat-square&color=141414)](https://github.com/ayagmar/ccdesk/blob/master/LICENSE)

See and change everything Claude Code loads on your machine: instruction files, settings, permissions, hooks, MCP servers, subagents, skills, plugins and auto memory.

```sh
npx ccdesk
```

Each piece lives in its own file, at one of six scopes: managed, user, project, local, auto memory or a plugin. ccdesk opens in your browser on the directory you ran it from, lists everything that applies there in the order Claude Code loads it, and names the file behind each piece. When something is wrong, change it on the same page: you review the diff first, and every edit has a backup and an undo. It is not a session viewer or a usage dashboard.

**Docs:** [ayagmar.github.io/ccdesk](https://ayagmar.github.io/ccdesk/)

<a href="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/directory-dark.webp"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/directory-dark.webp" /><img alt="ccdesk on a made-up project: the load order across the top, then instruction files and settings, each marked with the scope it comes from" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/directory-light.webp" /></picture></a>

## Questions it answers

- Why does Claude ask me before every `git push` here? ([Permissions](https://ayagmar.github.io/ccdesk/permissions/))
- Which model does this repository use, and which file set it? ([Settings](https://ayagmar.github.io/ccdesk/settings/))
- Is my `AGENTS.md` loaded at all? ([Instructions](https://ayagmar.github.io/ccdesk/instructions/))
- How much context does my config take before I type anything? ([What Claude sees](https://ayagmar.github.io/ccdesk/what-claude-sees/))
- What do I keep approving by hand, and which allow rules have I stopped needing? ([Permissions](https://ayagmar.github.io/ccdesk/permissions/#suggested-rules))
- Which project MCP servers still wait for approval? ([MCP servers](https://ayagmar.github.io/ccdesk/mcp-servers/))

## What it covers

| | What you see | What you can change | Docs |
| --- | --- | --- | --- |
| **Instructions** | Every `CLAUDE.md`, `AGENTS.md` and `.claude/rules/*.md` that applies, in load order, with why a file is skipped and who else sees it | Open it in your editor | [Instructions](https://ayagmar.github.io/ccdesk/instructions/) |
| **Settings** | The value Claude Code ends up using for each key, the file it comes from, and the values it overrides | Set or remove any documented key in user, project or local settings, picked from the schema | [Settings](https://ayagmar.github.io/ccdesk/settings/) |
| **Permissions** | Every allow, ask and deny rule, which ones never take effect, and allow rules that covered no call | Add, move or remove rules; accept allow rules suggested from the calls you approved | [Permissions](https://ayagmar.github.io/ccdesk/permissions/) |
| **Built-in tools** | What happens when Claude reaches for each tool here, and how often it did | Turn a tool off with a deny rule, or back on | [Tool usage](https://ayagmar.github.io/ccdesk/tool-usage/) |
| **Hooks** | Every hook with its scope, and the ones that are turned off | Add, change or remove hooks in user, project or local settings | [Hooks](https://ayagmar.github.io/ccdesk/hooks/) |
| **MCP servers** | Every server, and the ones waiting for approval, off, rejected or overridden | Add, change or remove servers in `.mcp.json`, or through `claude mcp` for user and local ones | [MCP servers](https://ayagmar.github.io/ccdesk/mcp-servers/) |
| **Subagents** | Every agent from managed, project, user and plugin folders, and which definition wins | Create, change or delete agent files | [Subagents](https://ayagmar.github.io/ccdesk/subagents/) |
| **Skills and plugins** | Skills, commands, output styles and plugins, by scope | Open them in your editor | [Skills and plugins](https://ayagmar.github.io/ccdesk/skills-and-plugins/) |
| **Memory** | Auto memory for the directory, with memories missing from `MEMORY.md`, broken links and duplicates flagged | Delete a memory and its index line, fix the index | [Memory](https://ayagmar.github.io/ccdesk/memory/) |
| **What Claude sees** | What your config puts in context when a session starts, with sizes and estimated tokens | | [What Claude sees](https://ayagmar.github.io/ccdesk/what-claude-sees/) |

<table>
  <tr>
    <td width="50%"><a href="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/permissions-dark.webp"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/permissions-dark.webp" /><img alt="The permissions table with rules from user, project and local settings, and three suggested allow rules" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/permissions-light.webp" /></picture></a></td>
    <td width="50%"><a href="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/context-dark.webp"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/context-dark.webp" /><img alt="What Claude sees: instruction files, memory and skill listing in load order, with sizes and token estimates" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/context-light.webp" /></picture></a></td>
  </tr>
  <tr>
    <td>Permissions, with allow rules suggested from the calls you approved</td>
    <td>What Claude sees when a session starts here</td>
  </tr>
  <tr>
    <td><a href="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/memory-dark.webp"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/memory-dark.webp" /><img alt="Auto memory for a directory, with checks on the MEMORY.md index" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/memory-light.webp" /></picture></a></td>
    <td><a href="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/changes-dark.webp"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/changes-dark.webp" /><img alt="Recent changes: every edit ccdesk made, each one restorable" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/changes-light.webp" /></picture></a></td>
  </tr>
  <tr>
    <td>Auto memory and its index</td>
    <td>Every change ccdesk made, ready to restore</td>
  </tr>
</table>

## How changes are made

<a href="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/review-dark.webp"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/review-dark.webp" /><img align="right" width="300" alt="Changing the model setting: the files that set it, the value Claude Code uses, and the diff to project settings before saving" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/review-light.webp" /></picture></a>

- You see the exact diff before anything is written, and Save writes exactly that diff. If the file changed in the meantime, ccdesk asks you to review again.
- Settings and hooks are checked against Claude Code's settings schema. Other keys in the file stay as they are.
- The old file is backed up to `~/.claude/backups/ccdesk/` first. Undo is one click, and **Recent changes** can restore any earlier edit.
- A settings file that is a symlink, such as one in a dotfiles repository, is written through and stays a link.
- A file with other hard links is not saved: replacing it would split it from its other names. Edit it in your editor.
- ccdesk never writes `~/.claude.json`. User and local MCP server changes go through Claude Code's own `claude mcp` command, so they need `claude` on your PATH.

Details: [Recent changes, backups and undo](https://ayagmar.github.io/ccdesk/recent-changes/)

<br clear="right" />

## Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous row |
| `1` to `9` | Jump to a section |
| `/` | Filter rows |
| `Ctrl K` / `⌘ K` | Jump to any directory, file, setting, rule or memory |
| `Esc` | Close details |

More in [Reading the interface](https://ayagmar.github.io/ccdesk/interface/).

## Options

```
npx ccdesk [options]

  --port <n>   Port to listen on (default: a free port)
  --no-open    Print the URL instead of opening a browser
  -h, --help   Show this help
```

ccdesk reads `~/.claude` and `~/.claude.json`, or `$CLAUDE_CONFIG_DIR` when it is set, as Claude Code does. Edits made in another editor or by Claude show up within a second. Requires Node.js 22.19 or newer. See [Platform notes](https://ayagmar.github.io/ccdesk/platforms/) for Windows, macOS and WSL.

## Privacy and safety

- The server listens on `127.0.0.1` only, and every API call needs a token generated for that run. Nothing leaves your machine.
- Values under `env` and `headers`, and keys in an MCP server's `args` (after flags such as `--token` or `--api-key`, or starting like `sk-` or `ghp_`), are hidden everywhere in the UI, diffs included, and ccdesk refuses any edit that would change them.
- ccdesk never reads `~/.claude/.credentials.json`.
- From your transcripts, only counts and rule patterns (a command's program and subcommand, a fetch's domain) reach the page, never commands or file contents.
- Backups are readable only by you on Linux and macOS.

The full list is in [Safety and privacy](https://ayagmar.github.io/ccdesk/safety-and-privacy/).

## Development

```sh
pnpm install
pnpm dev        # API on 127.0.0.1:4319
pnpm dev:ui     # UI with hot reload on localhost:4320
pnpm check      # typecheck, lint, format, tests, build
```

Tests never touch your real `~/.claude`; each one builds a throwaway home directory. The settings schema, scopes and built-in tools are generated from [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and Claude Code's docs, and a daily workflow opens a pull request when they change. [Contributing](https://ayagmar.github.io/ccdesk/contributing/) covers the generators, the docs site and releases.

## License

MIT
