---
title: Safety and privacy
description: What ccdesk reads, what it never reads or writes, how secrets are hidden, and how the local server is protected.
---

ccdesk runs on your machine, reads your Claude Code config, and can change it. This page lists what it does to keep that safe.

## Nothing leaves your machine

ccdesk makes no network requests of its own. It does not connect to MCP servers, send telemetry or check for updates. The programs it starts are local: `git`, to see which files a repository tracks; your editor or browser when you ask; and Claude Code's `claude mcp` when you change a user or local MCP server. Everything it shows is read from local files and served to your browser by the local server.

## The local server

- It listens on `127.0.0.1` only, so other machines on your network cannot reach it.
- Each run generates a random token. The browser receives it in the address fragment (`#token=…`), which browsers do not send to servers or in referrers, and moves it into the tab's session storage. Every API call must carry it.
- Requests whose `Host` is not `127.0.0.1` or `localhost` on ccdesk's port are refused, which stops DNS rebinding. Requests that change something are also refused when they come from another origin.
- Pages are served with a content security policy that allows only ccdesk's own scripts.

## Secrets stay hidden

- Values under `env` and `headers`, in settings files, hooks and MCP servers, are shown as `•••`, in tables, in the inspector and in diffs. The keys stay visible.
- The user name, password and query string of a URL, such as an MCP server's `url`, are hidden wherever ccdesk shows it.
- In an MCP server's `args`, the value after a flag such as `--token` or `--api-key`, and a value that starts like a common key (`sk-`, `ghp_`, `xoxb-`), are shown as `•••`.
- A settings file reached through an `@import` or a link is shown with the same values hidden.
- An error about a JSON file that does not parse gives only the line and column, never the text around it.
- ccdesk never changes hidden values. An edit that would touch them is refused, and so is a restore that would bring back different ones. Removing an MCP server with hidden values is allowed.

## Files ccdesk never touches

- `~/.claude/.credentials.json`, where Claude Code keeps your login, is never read, opened or written: not by name, not through a link, not through an import.
- `~/.claude.json` is never written, even through a settings file that links to it. Claude Code rewrites it during every session. User and local MCP server changes go through Claude Code's `claude mcp` commands, which write it.
- A `MEMORY.md` that links outside its memory folder is left alone.
- Sessions and transcripts are never deleted or changed.

## Every write is reviewed and reversible

Nothing is written until you have seen the diff and pressed the button that saves it, and ccdesk saves exactly the change you reviewed: if the file changed in the meantime, it refuses and asks you to review again. The old file is copied to `~/.claude/backups/ccdesk/` first, and on Linux and macOS those copies are readable only by you. See [Recent changes](../recent-changes/).

Writes go to a temporary file that replaces the original in one step, so a crash cannot leave half a file. A file that is a link stays a link.

## Transcripts

To count tool calls and your answers to permission prompts, ccdesk reads the open directory's transcripts in `~/.claude/projects/`. Commands and URL hosts stay inside the ccdesk process; only counts and rule patterns such as `Bash(pnpm test *)` reach the page. Details are on [Tool usage counts](../tool-usage/).

## Markdown from other people

Instruction files, memories and skills are rendered without raw HTML. An `AGENTS.md` in a repository you cloned cannot run script in a page that can edit your settings.
