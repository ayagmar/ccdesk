---
title: Tool usage counts
description: How ccdesk counts tool calls and your answers to permission prompts from Claude Code's transcripts, and what reaches the page.
---

ccdesk reads Claude Code's transcripts for the open directory to fill four things: the **Used** column in [Built-in tools](../permissions/#built-in-tools), the **covered no call here** flag on allow rules, [suggested rules](../permissions/#suggested-rules), and the [Reads](../memory/#reads) of each memory.

## Which sessions count

Transcripts live in `~/.claude/projects/` (or the `projects` folder in `$CLAUDE_CONFIG_DIR`), one folder per directory Claude Code was started in.

With `CLAUDE_CODE_PROJECT_DIR_NAME` set beside `CLAUDE_CONFIG_DIR`, Claude Code keeps every project's transcripts in the one folder it names, so ccdesk also reads that folder and counts each session by the directory it started in. Sessions from before the name was set stay in their own folders and still count.

- **In a git repository**: every session started anywhere in the repository or in one of its worktrees, because rules at the repository root apply there too.
- **Outside git**, or when the repository is your home folder: sessions started in the directory or one of its subfolders.

Calls made by subagents in those sessions are counted too. A call that Claude Code copied into the transcript of a resumed or forked session counts once. The details for a tool say how many calls there were since when; Claude Code deletes old transcripts after a while (`cleanupPeriodDays`), so the counts cover only what is still on disk.

## What is read

From each transcript line ccdesk takes the tool name, id and time of each call, whether it failed, the command of a Bash call, the host of a WebFetch URL, the file of a Read call, and whether you allowed or refused the call when Claude Code asked. It keeps this in memory while it runs, to avoid rereading files, and forgets it when you stop ccdesk.

## What reaches the page

Only counts and rule patterns: per tool, how many calls, how many you allowed and refused; per rule, how many calls it covers; and suggested rules such as `Bash(gh pr view *)` with their counts and the time of the last one; per file in the directory's memory folder, how many reads and when the last one was. Commands, the paths of other files read, file contents, prompts and Claude's answers never leave the ccdesk server process.

## When counting takes long

Large transcript folders take a while to read the first time. The page shows the rest of the directory meanwhile. A count stops after a minute; ccdesk keeps what it has read so far and carries on the next time the page refreshes.
