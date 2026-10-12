---
title: Platform notes
description: What differs on Linux, macOS and Windows.
---

ccdesk runs on Linux, macOS and Windows with Node.js 22.19 or newer. Its tests run on all three on every change.

## Linux

- Managed settings and instructions are read from `/etc/claude-code`.
- The browser is opened with `xdg-open`.
- The open button tries graphical editors on your `PATH` before `xdg-open`, which often picks a terminal editor or nothing for JSON and Markdown. Set `CCDESK_EDITOR` to choose one.

## macOS

- Managed settings and instructions are read from `/Library/Application Support/ClaudeCode`. ccdesk reads the files there, not configuration profiles.
- The browser and files are opened with `open`.

## Windows

- Managed settings and instructions are read from `C:\Program Files\ClaudeCode`. ccdesk does not read policies from the registry.
- Local settings (`.claude/settings.local.json`) are read from the directory you started in, not from the repository root.
- The browser is opened with `start`, and files with your editor or Explorer. An editor that is a `.cmd` or `.bat` file, such as VS Code's `code`, is started through `cmd.exe`; a path containing `"` or `%` cannot be passed to it safely, so ccdesk asks you to open that file yourself.
- Backups are not given special permissions. They keep the access rules of your user profile folder, which other users normally cannot read.
- For user and local MCP servers, ccdesk runs `claude.exe` directly, or the `claude.exe` inside the npm package when only `claude.cmd` is on your `PATH`, so the server's JSON never passes through `cmd.exe`. The commands shown in the review are quoted for a POSIX shell such as Git Bash.

## WSL

ccdesk reads the home folder of the system it runs on. Started inside WSL, it shows the Claude Code setup in WSL; started from Windows, the one in your Windows profile. Links that point into `\\wsl$` are followed.

## `CLAUDE_CONFIG_DIR`

When `CLAUDE_CONFIG_DIR` is set, ccdesk uses it on every platform in place of `~/.claude`: settings, agents, skills, memory, transcripts and backups all live there, and so does `.claude.json`.
