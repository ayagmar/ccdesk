<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/assets/brand/banner-dark.webp" />
  <img alt="Murmeli the marmot, ccdesk's station master, waving from a station desk beside a line of five coloured stops" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/assets/brand/banner-light.webp" />
</picture>

# ccdesk

[![npm](https://img.shields.io/npm/v/ccdesk?style=flat-square&color=141414)](https://www.npmjs.com/package/ccdesk)
[![CI](https://img.shields.io/github/actions/workflow/status/ayagmar/ccdesk/ci.yml?branch=master&style=flat-square&label=ci)](https://github.com/ayagmar/ccdesk/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/ccdesk?style=flat-square&color=141414)](https://github.com/ayagmar/ccdesk/blob/master/package.json)
[![Ask DeepWiki](https://img.shields.io/badge/Ask-DeepWiki-blue)](https://deepwiki.com/ayagmar/ccdesk)
[![license](https://img.shields.io/github/license/ayagmar/ccdesk?style=flat-square&color=141414)](https://github.com/ayagmar/ccdesk/blob/master/LICENSE)

See and change everything Claude Code loads on your machine: instruction files, settings, permissions, hooks, MCP servers, subagents, skills, plugins and auto memory.

```sh
npx ccdesk
```

Each piece lives in its own file, at one of six scopes: managed, user, project, local, auto memory or a plugin. ccdesk opens in your browser on the directory you ran it from, lists everything that applies there in the order Claude Code loads it, and names the file behind each piece. When something is wrong, change it on the same page: you review the diff first, and every file ccdesk writes is backed up and can be undone. It is not a session viewer or a usage dashboard.

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
| **Memory** | Auto memory for the directory, how often Claude read each memory, and memories missing from `MEMORY.md`, broken links and duplicates flagged | Delete a memory and its index line, fix the index | [Memory](https://ayagmar.github.io/ccdesk/memory/) |
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
    <td><a href="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/memory-dark.webp"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/memory-dark.webp" /><img alt="Auto memory for a directory, with how often Claude read each memory and checks on the MEMORY.md index" src="https://raw.githubusercontent.com/ayagmar/ccdesk/master/site/src/assets/screenshots/memory-light.webp" /></picture></a></td>
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
- The old file is backed up to `~/.claude/backups/ccdesk/` first. Undo is one click, and **Recent changes** can restore any earlier edit.
- ccdesk never writes `~/.claude.json`. User and local MCP server changes go through Claude Code's own `claude mcp` command, and **Recent changes** lists the commands that reverse each one.

Details: [Recent changes, backups and undo](https://ayagmar.github.io/ccdesk/recent-changes/)

<br clear="right" />

## Commands

```
npx ccdesk                    Open the page in your browser
npx ccdesk scan [dir] --json  Print what Claude Code loads in dir, as JSON
npx ccdesk explain <file>     Print what loads once Claude reads or edits file
npx ccdesk check [dir]        Exit 1 when a session started in dir reads a file
                              Claude Code cannot read or parse, or a setting it ignores, for CI
npx ccdesk compare <a> <b>    Print the settings that differ between two directories
npx ccdesk rules --suggest    Print the allow rules that would have covered calls you approved
npx ccdesk forget <dir>       Forget a directory whose folder is gone (--all-gone: all of them)
npx ccdesk hook --install     Warn at the start of each session when what it loads has problems
```

Requires Node.js 22.19 or newer. Options, the `check` command in CI, the [session check](https://ayagmar.github.io/ccdesk/getting-started/#session-check), and what ccdesk reads and writes are in [Getting started](https://ayagmar.github.io/ccdesk/getting-started/); keyboard shortcuts are in [Reading the interface](https://ayagmar.github.io/ccdesk/interface/#keyboard-shortcuts), and Windows, macOS and WSL in [Platform notes](https://ayagmar.github.io/ccdesk/platforms/).

## Privacy and safety

- The server listens on `127.0.0.1` only, and every API call needs the token in the printed link. A restart within 15 minutes keeps it, so an open page keeps working; after that it is new. Nothing leaves your machine.
- Values under `env` and `headers`, a URL's user name, password and query string, and secrets in MCP server arguments are hidden everywhere in the UI, diffs included, and ccdesk refuses any edit that would change them.
- ccdesk never reads `~/.claude/.credentials.json`. From your transcripts, only counts and rule patterns reach the page.

The full list is in [Safety and privacy](https://ayagmar.github.io/ccdesk/safety-and-privacy/).

## Development

```sh
pnpm install
pnpm dev        # API on 127.0.0.1:4319
pnpm dev:ui     # UI with hot reload on localhost:4320
pnpm check      # typecheck, lint, format, tests, build
```

[Contributing](https://ayagmar.github.io/ccdesk/contributing/) covers the tests, the data generated from Claude Code, the docs site and releases. [ARCHITECTURE.md](ARCHITECTURE.md) explains how the code fits together.

## License

MIT
