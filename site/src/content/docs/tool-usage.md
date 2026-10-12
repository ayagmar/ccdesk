---
title: Tool usage counts
description: How ccdesk counts tool calls and your answers to permission prompts from Claude Code's transcripts, and what reaches the page.
---

ccdesk reads Claude Code's transcripts for the open directory to fill three things: the **Used** column in [Built-in tools](../permissions/#built-in-tools), the **covered no call here** flag on allow rules, and [suggested rules](../permissions/#suggested-rules).

## Which sessions count

Transcripts live in `~/.claude/projects/` (or the `projects` folder in `$CLAUDE_CONFIG_DIR`), one folder per directory Claude Code was started in.

- **In a git repository**: every session started anywhere in the repository or in one of its worktrees, because rules at the repository root apply there too.
- **Outside git**, or when the repository is your home folder: sessions started in the directory or one of its subfolders.

Calls made by subagents in those sessions are counted too. The details for a tool say how many calls there were since when; Claude Code deletes old transcripts after a while (`cleanupPeriodDays`), so the counts cover only what is still on disk.

## What is read

From each transcript line ccdesk takes the tool name and time of each call, the command of a Bash call, the host of a WebFetch URL, and whether you allowed or refused the call when Claude Code asked. It keeps this in memory while it runs, to avoid rereading files, and forgets it when you stop ccdesk.

## What reaches the page

Only counts and rule patterns: per tool, how many calls, how many you allowed and refused; per rule, how many calls it covers; and suggested rules such as `Bash(gh pr view *)` with their counts and the time of the last one. Commands, file contents, prompts and Claude's answers never leave the ccdesk server process.

## When counting takes long

Large transcript folders take a while to read the first time. The page shows the rest of the directory meanwhile. A count stops after a minute; ccdesk keeps what it has read so far and carries on the next time the page refreshes.
