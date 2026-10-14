---
title: FAQ
description: Short answers to common questions about ccdesk.
---

## Is ccdesk made by Anthropic?

No. It is an independent open-source tool that reads the files Claude Code documents. It follows Claude Code's settings schema, which Anthropic publishes in `@anthropic-ai/claude-agent-sdk`, and its documentation. For the few documented keys that schema leaves out, it uses SchemaStore's community schema.

## Does it show my sessions or what Claude did?

No. ccdesk shows what Claude is told, not what it did. It reads transcripts only to count tool calls, reads of memory files and your answers to permission prompts, and those counts are all that reach the page. See [Tool usage counts](../tool-usage/).

## Does it need to stay running?

No. Start it when you want to look at or change your config, and stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>. Claude Code does not depend on it.

## Can I use it while Claude Code is running?

Yes. ccdesk watches the files and refreshes when Claude Code changes them. If Claude Code changes a file after you reviewed an edit to it, ccdesk refuses to save and asks you to review the edit again, so it never overwrites a change it did not show you.

## Why does a value I set not take effect?

Select the setting. The inspector lists every file that sets it and says which one wins and why: a higher file beats it, Claude Code does not read the key from that file, or the folder is not trusted yet.

## Why is my AGENTS.md skipped?

By default Claude Code loads `AGENTS.md` only when no `CLAUDE.md` or `CLAUDE.local.md` applies, and not when a `CLAUDE.md` already imports it. The **Why** column says which case it is. See [Instructions](../instructions/#status).

## Can I edit CLAUDE.md in ccdesk?

Not in the page. Every file has an open button that starts your editor; ccdesk picks up the change within a second. ccdesk edits settings, permission rules, hooks, MCP servers, subagent files and memory.

## Why can I not change an MCP server or an `env` setting?

Their values are hidden from the page, and ccdesk will not write values it does not show. Change them in the file or with `claude mcp`. You can still remove an MCP server.

## How do I undo a change?

Press **Undo** in the toast right after saving, or open **Recent changes** in the rail and restore the change from there. See [Recent changes](../recent-changes/).

## Where are the backups, and can I delete them?

In `~/.claude/backups/ccdesk/`, one folder per change. ccdesk never deletes them. Deleting old folders is safe; those changes just drop out of Recent changes.

## How do I use a different editor?

Set `CCDESK_EDITOR`, for example `CCDESK_EDITOR="code" npx ccdesk`. See [Reading the interface](../interface/#the-inspector).

## Can I run it on a server and open it from my laptop?

ccdesk listens on `127.0.0.1` only and refuses requests for any other host name. Forward the port over SSH (`ssh -L 4400:127.0.0.1:4400 host`, then `npx ccdesk --port 4400 --no-open` on the server) and open the printed address on your laptop.
