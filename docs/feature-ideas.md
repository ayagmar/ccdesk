# Feature ideas

Ideas, not commitments: each one is something the code is already close to supporting. Sizes are rough. S is a day or less, M a few days, L a week or more. Most of the CLI ideas assume steps 1 and 2 of the [split plan](split-plan.md).

## On the command line

`ccdesk scan [dir] --json` and `ccdesk explain <file>` are done (step 6 of the split plan), and so is `ccdesk check [dir]`, which exits 1 when a session started in a folder reads a file of its repository that Claude Code cannot read or parse (see [Getting started](../site/src/content/docs/getting-started.mdx)). These would sit beside them.

**`ccdesk compare <a> <b>`** (S). The page's compare view as text: each setting's value in two directories and the files it comes from, from `compareSettings`.

**`ccdesk changes` and `ccdesk undo <id>`** (M). Lists Recent changes and restores one, through a core's `listBackups`, `previewRestore` and `restoreBackup`. Restoring needs a review step in the terminal: print the diff, ask, then pass the reviewed revision, as the page does.

**`ccdesk rules --suggest [dir]`** (M). Lists the allow rules that would cover calls you approved by hand, with how many calls each covers. The counting is a core's `readUsage`; the suggestions are built by `suggestedRules` in `src/view/usage.ts`.

## On the page

**Push changes instead of long polling** (M). The page now holds a request open on `/api/watch` and asks again after each answer. With `Watcher.subscribe`, the server could push a message over server-sent events when a watched file changes. A TUI would subscribe the same way.

**Watch `~/.claude.json`** (M). Trust decisions and user MCP servers show up only when you return to the tab, because Claude Code rewrites the file constantly. Watching it and rescanning only when the parts ccdesk shows change would make those updates live too.

## In a terminal UI

**`ccdesk tui`** (L). The directory page in a terminal, built on the core and on `src/view` (split plan step 4) for the rows, labels and sort order, with the same review-then-save steps as the page. It depends on every step of the split plan except the CLI.
